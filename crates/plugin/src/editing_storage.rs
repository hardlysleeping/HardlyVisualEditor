//! Project-scoped persistence for HardlyUI's first style-edit milestone.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_visual_editor_core::editing::EditHistory;

use crate::config::VisualEditorConfig;

const HISTORY_DIR: &str = ".hardlyui";
const HISTORY_FILE: &str = "history.json";
const OVERRIDES_FILE: &str = "hardlyui-overrides.css";
const COMPONENTS_FILE: &str = "components.json";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const VERSIONS_DIR: &str = "versions";
const PUBLISHED_FILE: &str = "published.json";
const MAX_VERSIONS: usize = 100;
const MAX_VERSION_PREVIEW_BYTES: usize = 512 * 1024;
const MAX_COMPONENT_STYLES: usize = 40;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VersionSummary {
    pub id: String,
    pub label: String,
    pub created_at: u128,
    pub transaction_count: usize,
    pub cursor: usize,
    #[serde(default)]
    pub recent_transactions: Vec<String>,
    /// True when a captured thumbnail sits next to the snapshot. Filled in by
    /// `list_versions` from the filesystem, not stored in the snapshot itself.
    #[serde(default)]
    pub has_preview: bool,
    /// True when this checkpoint was published. Also filled in by
    /// `list_versions`, from `published.json`; a published checkpoint is a
    /// restore point, so delete and prune leave it alone.
    #[serde(default)]
    pub published: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct VersionSnapshot {
    summary: VersionSummary,
    history: EditHistory,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VersionComparison {
    pub version_css: String,
    pub current_css: String,
}

pub(crate) fn project_root(config: &VisualEditorConfig) -> Result<PathBuf, String> {
    let configured = config
        .project_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "HardlyUI editing requires projectRoot in plugin configuration".to_string()
        })?;
    let path = PathBuf::from(configured);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(path)
    };
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("cannot resolve HardlyUI projectRoot: {error}"))?;
    if !canonical.is_dir() {
        return Err("HardlyUI projectRoot must be a directory".into());
    }
    Ok(canonical)
}

fn history_path(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(HISTORY_DIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|error| format!("cannot resolve HardlyUI history directory: {error}"))?;
    if !canonical_dir.starts_with(root) {
        return Err("HardlyUI history directory escapes projectRoot".into());
    }
    Ok(canonical_dir.join(HISTORY_FILE))
}

pub fn load_edit_history(config: &VisualEditorConfig) -> Result<EditHistory, String> {
    let Some(root) = config
        .project_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(EditHistory::default());
    };
    let path = PathBuf::from(root);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(path)
    };
    let root = path
        .canonicalize()
        .map_err(|error| format!("cannot resolve HardlyUI projectRoot: {error}"))?;
    let file = root.join(HISTORY_DIR).join(HISTORY_FILE);
    match fs::read(&file) {
        Ok(bytes) => {
            let history: EditHistory = serde_json::from_slice(&bytes)
                .map_err(|error| format!("invalid HardlyUI history file: {error}"))?;
            history
                .validate()
                .map_err(|error| format!("invalid HardlyUI history state: {error}"))?;
            Ok(history)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(EditHistory::default()),
        Err(error) => Err(format!("cannot read HardlyUI history file: {error}")),
    }
}

/// Save history and the stylesheet using same-directory atomic renames. The
/// generated CSS is validated before either file is changed.
pub fn save_edit_history(config: &VisualEditorConfig, history: &EditHistory) -> Result<(), String> {
    let root = project_root(config)?;
    let history_file = history_path(&root)?;
    let css_file = root.join(OVERRIDES_FILE);
    let history_json = serde_json::to_vec_pretty(history).map_err(|error| error.to_string())?;
    let css = history.overrides_css().map_err(str::to_string)?;

    let old_history = fs::read(&history_file).ok();
    atomic_write(&history_file, &history_json)?;
    if let Err(error) = atomic_write(&css_file, css.as_bytes()) {
        match old_history {
            Some(bytes) => {
                let _ = atomic_write(&history_file, &bytes);
            }
            None => {
                let _ = fs::remove_file(&history_file);
            }
        }
        return Err(error);
    }
    Ok(())
}

/// Load project-scoped reusable component definitions.
pub fn load_components(config: &VisualEditorConfig) -> Result<serde_json::Value, String> {
    let root = project_root(config)?;
    let path = history_path(&root)?.join(COMPONENTS_FILE);
    match fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 512 * 1024 {
                return Err("HardlyUI component library exceeds 512 KiB".into());
            }
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("invalid HardlyUI component library: {error}"))?;
            validate_components(&value)?;
            Ok(value)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::Value::Array(Vec::new()))
        }
        Err(error) => Err(format!("cannot read HardlyUI component library: {error}")),
    }
}

/// Save a bounded array of portable component definitions under the project root.
pub fn save_components(
    config: &VisualEditorConfig,
    components: &serde_json::Value,
) -> Result<(), String> {
    validate_components(components)?;
    let bytes = serde_json::to_vec_pretty(components).map_err(|error| error.to_string())?;
    if bytes.len() > 512 * 1024 {
        return Err("HardlyUI component library exceeds 512 KiB".into());
    }
    let root = project_root(config)?;
    let path = history_path(&root)?.join(COMPONENTS_FILE);
    atomic_write(&path, &bytes)
}

pub fn save_version(
    config: &VisualEditorConfig,
    history: &EditHistory,
    label: &str,
) -> Result<VersionSummary, String> {
    history.validate().map_err(str::to_string)?;
    let label = label.trim();
    if label.is_empty() || label.len() > 80 || label.chars().any(char::is_control) {
        return Err("version label must be 1-80 printable characters".into());
    }
    let directory = versions_directory(config)?;
    let versions = list_versions(config)?;
    if versions.len() >= MAX_VERSIONS {
        return Err(format!("HardlyUI stores at most {MAX_VERSIONS} versions"));
    }
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let id = format!("{created_at}-{sequence}");
    let summary = VersionSummary {
        id: id.clone(),
        label: label.to_string(),
        created_at,
        transaction_count: history.transactions().len(),
        cursor: history.cursor(),
        recent_transactions: history
            .transactions()
            .iter()
            .rev()
            .take(8)
            .rev()
            .map(|transaction| {
                transaction
                    .label
                    .clone()
                    .filter(|label| !label.trim().is_empty())
                    .unwrap_or_else(|| "Edit".into())
            })
            .collect(),
        has_preview: false,
        published: false,
    };
    let snapshot = VersionSnapshot {
        summary: summary.clone(),
        history: history.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("version snapshot exceeds 2 MiB".into());
    }
    atomic_write(&directory.join(format!("{id}.json")), &bytes)?;
    Ok(summary)
}

pub fn list_versions(config: &VisualEditorConfig) -> Result<Vec<VersionSummary>, String> {
    let directory = versions_directory(config)?;
    let published_ids = published_index(config)?
        .entries
        .into_iter()
        .map(|entry| entry.id)
        .collect::<std::collections::HashSet<_>>();
    let mut versions = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(entry.path()).map_err(|error| error.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("version snapshot exceeds 2 MiB".into());
        }
        let snapshot: VersionSnapshot = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid HardlyUI version snapshot: {error}"))?;
        snapshot
            .history
            .validate()
            .map_err(|error| format!("invalid version history: {error}"))?;
        let mut summary = snapshot.summary;
        summary.has_preview = entry.path().with_extension("png").is_file();
        summary.published = published_ids.contains(&summary.id);
        versions.push(summary);
    }
    versions.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            // Sequence numbers are not zero-padded, so compare them as numbers:
            // string order puts "-20" before "-6".
            .then_with(|| id_sequence(&right.id).cmp(&id_sequence(&left.id)))
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(versions)
}

fn id_sequence(id: &str) -> u64 {
    id.rsplit('-')
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or(0)
}

/// A restore point the user published, so "go back to what I published" works
/// even after the versions folder is pruned.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PublishedEntry {
    pub id: String,
    pub label: String,
    pub published_at: u128,
    /// Pictures copied for this publish, by file name.
    #[serde(default)]
    pub media: Vec<String>,
    /// Folder the pictures landed in, relative to the project root.
    #[serde(default)]
    pub media_folder: String,
    /// False when the project had no folder the built app serves.
    #[serde(default)]
    pub media_url_works: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PublishedIndex {
    #[serde(default)]
    pub entries: Vec<PublishedEntry>,
}

fn published_path(config: &VisualEditorConfig) -> Result<PathBuf, String> {
    let root = project_root(config)?;
    let base = history_path(&root)?
        .parent()
        .ok_or("HardlyUI state directory missing")?
        .to_path_buf();
    Ok(base.join(PUBLISHED_FILE))
}

fn published_index(config: &VisualEditorConfig) -> Result<PublishedIndex, String> {
    match fs::read(published_path(config)?) {
        Ok(bytes) => {
            if bytes.len() > 512 * 1024 {
                return Err("HardlyUI published index is too large".into());
            }
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("invalid HardlyUI published index: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PublishedIndex::default()),
        Err(error) => Err(format!("cannot read HardlyUI published index: {error}")),
    }
}

pub fn list_published(config: &VisualEditorConfig) -> Result<Vec<PublishedEntry>, String> {
    Ok(published_index(config)?.entries)
}

/// Records a publish. Newest first, one entry per restore point.
pub fn record_published(
    config: &VisualEditorConfig,
    version: &VersionSummary,
    published_at: u128,
    media: &[String],
    media_folder: &str,
    media_url_works: bool,
) -> Result<(), String> {
    let mut index = published_index(config)?;
    index.entries.retain(|entry| entry.id != version.id);
    index.entries.insert(
        0,
        PublishedEntry {
            id: version.id.clone(),
            label: version.label.clone(),
            published_at,
            media: media.to_vec(),
            media_folder: media_folder.to_string(),
            media_url_works,
        },
    );
    index.entries.truncate(MAX_VERSIONS);
    let bytes = serde_json::to_vec_pretty(&index).map_err(|error| error.to_string())?;
    atomic_write(&published_path(config)?, &bytes)
}

fn version_file(config: &VisualEditorConfig, id: &str) -> Result<(PathBuf, PathBuf), String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|ch| ch.is_ascii_digit() || ch == '-') {
        return Err("invalid version ID".into());
    }
    let directory = versions_directory(config)?;
    let filename = directory.join(format!("{id}.json"));
    let metadata = fs::symlink_metadata(&filename).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || !filename
            .canonicalize()
            .map_err(|error| error.to_string())?
            .starts_with(&directory)
    {
        return Err("version snapshot path is invalid".into());
    }
    Ok((directory, filename))
}

pub fn load_version(config: &VisualEditorConfig, id: &str) -> Result<EditHistory, String> {
    let (_, filename) = version_file(config, id)?;
    let bytes = fs::read(filename).map_err(|error| error.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("version snapshot exceeds 2 MiB".into());
    }
    let snapshot: VersionSnapshot = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid HardlyUI version snapshot: {error}"))?;
    snapshot
        .history
        .validate()
        .map_err(|error| format!("invalid version history: {error}"))?;
    Ok(snapshot.history)
}

pub fn delete_version(config: &VisualEditorConfig, id: &str) -> Result<(), String> {
    if published_index(config)?
        .entries
        .iter()
        .any(|entry| entry.id == id)
    {
        return Err(
            "published restore points cannot be deleted; publish again or restore it first".into(),
        );
    }
    let (directory, filename) = version_file(config, id)?;
    let preview = preview_path(&directory, id);
    fs::remove_file(filename)
        .map_err(|error| format!("cannot delete version snapshot: {error}"))?;
    match fs::remove_file(preview) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot delete version thumbnail: {error}")),
    }
}

fn preview_path(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{id}.png"))
}

/// Attach a captured thumbnail to an existing checkpoint. The picture is
/// best-effort: callers may ignore the error and keep the snapshot.
pub fn write_version_preview(
    config: &VisualEditorConfig,
    id: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if bytes.len() > MAX_VERSION_PREVIEW_BYTES {
        return Err("version thumbnail exceeds 512 KiB".into());
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("version thumbnail must be PNG data".into());
    }
    let (directory, _) = version_file(config, id)?;
    atomic_write(&preview_path(&directory, id), bytes)
}

pub fn read_version_preview(config: &VisualEditorConfig, id: &str) -> Result<Vec<u8>, String> {
    let (directory, _) = version_file(config, id)?;
    let path = preview_path(&directory, id);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("version thumbnail path is invalid".into());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_VERSION_PREVIEW_BYTES {
        return Err("version thumbnail exceeds 512 KiB".into());
    }
    Ok(bytes)
}

/// Keep the newest `keep` snapshots and delete the rest. Returns the removed
/// IDs. The caller supplies `keep` so retention stays an explicit action.
pub fn prune_versions(config: &VisualEditorConfig, keep: usize) -> Result<Vec<String>, String> {
    if keep == 0 || keep > MAX_VERSIONS {
        return Err(format!("keep must be between 1 and {MAX_VERSIONS}"));
    }
    // Published checkpoints are restore points, so pruning never touches them.
    // `keep` counts the ordinary checkpoints that survive.
    let mut removed = Vec::new();
    let mut kept = 0;
    for summary in list_versions(config)? {
        if summary.published {
            continue;
        }
        if kept < keep {
            kept += 1;
            continue;
        }
        delete_version(config, &summary.id)?;
        removed.push(summary.id);
    }
    Ok(removed)
}

/// Generated stylesheet for a snapshot next to the current one, so the
/// inspector can show what restoring that version would change.
pub fn compare_version(
    config: &VisualEditorConfig,
    current: &EditHistory,
    id: &str,
) -> Result<VersionComparison, String> {
    let version = load_version(config, id)?;
    Ok(VersionComparison {
        version_css: version.overrides_css().map_err(str::to_string)?,
        current_css: current.overrides_css().map_err(str::to_string)?,
    })
}

fn versions_directory(config: &VisualEditorConfig) -> Result<PathBuf, String> {
    let root = project_root(config)?;
    let base = history_path(&root)?
        .parent()
        .ok_or("HardlyUI state directory missing")?
        .to_path_buf();
    let directory = base.join(VERSIONS_DIR);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("HardlyUI versions directory escapes projectRoot".into());
    }
    Ok(canonical)
}

fn validate_components(components: &serde_json::Value) -> Result<(), String> {
    let Some(items) = components.as_array() else {
        return Err("HardlyUI component library must be a JSON array".into());
    };
    if items.len() > 100 {
        return Err("HardlyUI component library supports at most 100 items".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in items {
        let id = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or("component id is required")?;
        let name = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .ok_or("component name is required")?;
        let tag = item
            .get("tag")
            .and_then(serde_json::Value::as_str)
            .ok_or("component tag is required")?;
        let text = item
            .get("text")
            .and_then(serde_json::Value::as_str)
            .ok_or("component text is required")?;
        if id.is_empty()
            || id.len() > 128
            || !ids.insert(id)
            || name.trim().is_empty()
            || name.len() > 64
        {
            return Err("component IDs must be unique and names must be 1-64 characters".into());
        }
        let _ = (tag, text);
        let mut node_count = 0;
        validate_component_node(item, 0, &mut node_count)?;
        if let Some(bindings) = item.get("svelte_bindings").filter(|value| !value.is_null()) {
            let bindings = bindings
                .as_object()
                .ok_or("Svelte text bindings must be an object")?;
            if bindings.len() > 50 {
                return Err("component has too many Svelte text bindings".into());
            }
            for (path, expression) in bindings {
                let Some(expression) = expression.as_str() else {
                    return Err("Svelte text binding must be a string".into());
                };
                if !valid_component_text_path(path) || !valid_svelte_member_path(expression) {
                    return Err("Svelte text binding path or expression is invalid".into());
                }
            }
        }
    }
    Ok(())
}

fn valid_component_text_path(path: &str) -> bool {
    if path == "$" {
        return true;
    }
    let parts = path.split('.').collect::<Vec<_>>();
    !parts.is_empty()
        && parts.len() <= 8
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 2 && part.bytes().all(|ch| ch.is_ascii_digit())
        })
}

fn valid_svelte_member_path(expression: &str) -> bool {
    if expression.is_empty() || expression.len() > 256 {
        return false;
    }
    expression.split('.').all(|part| {
        let mut bytes = part.bytes();
        let Some(first) = bytes.next() else {
            return false;
        };
        (first.is_ascii_alphabetic() || first == b'_' || first == b'$')
            && bytes.all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'$')
    })
}

/// Mirror the guest/core artwork rules so a persisted component cannot smuggle
/// an unsafe scheme or control characters into inserted markup.
fn valid_artwork_url(url: &str) -> bool {
    !url.is_empty()
        && url.len() <= 2_048
        && !url
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control() || matches!(ch, '"' | '\'' | '<' | '>'))
        && (url.starts_with("https://")
            || url.starts_with("asset://")
            || url.starts_with("tauri://")
            || url.starts_with("http://localhost/")
            || url.starts_with("http://tauri.localhost/")
            || (!url.starts_with("//")
                && !url.contains(':')
                && !url.split('/').any(|segment| segment == "..")))
}

fn validate_component_node(
    node: &serde_json::Value,
    depth: usize,
    node_count: &mut usize,
) -> Result<(), String> {
    *node_count += 1;
    if depth > 8 || *node_count > 50 {
        return Err("reusable component nesting or node count exceeds the supported limit".into());
    }
    let tag = node
        .get("tag")
        .and_then(serde_json::Value::as_str)
        .ok_or("component tag is required")?;
    let text = node
        .get("text")
        .and_then(serde_json::Value::as_str)
        .ok_or("component text is required")?;
    if !matches!(tag, "div" | "p" | "span" | "button" | "img") || text.len() > 500 {
        return Err("component tag or text is outside the supported range".into());
    }
    let artwork = node.get("image_url").filter(|value| !value.is_null());
    if tag == "img" {
        let url = artwork
            .and_then(serde_json::Value::as_str)
            .ok_or("image components need an artwork URL")?;
        if !valid_artwork_url(url) {
            return Err("component artwork must use a secure URL or local app path".into());
        }
    }
    if let Some(slot) = node.get("slot_name").filter(|value| !value.is_null()) {
        let name = slot
            .as_str()
            .ok_or("component slot name must be a string")?;
        if name.is_empty()
            || name.len() > 32
            || !name
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
            || name
                .as_bytes()
                .first()
                .is_some_and(|ch| !ch.is_ascii_alphabetic())
        {
            return Err("component slot name is invalid".into());
        }
    }
    let classes = node
        .get("class_names")
        .and_then(serde_json::Value::as_array)
        .ok_or("component classes are required")?;
    if classes.len() > 32
        || classes.iter().any(|class| {
            class.as_str().is_none_or(|value| {
                value.is_empty()
                    || value.len() > 128
                    || !value.chars().all(|ch| {
                        ch.is_ascii_alphanumeric()
                            || matches!(ch, '_' | '-' | ':' | '/' | '[' | ']' | '.' | '#' | '%')
                    })
            })
        })
    {
        return Err("component class name is invalid".into());
    }
    let styles = node
        .get("styles")
        .and_then(serde_json::Value::as_array)
        .ok_or("component styles are required")?;
    if styles.len() > MAX_COMPONENT_STYLES
        || styles.iter().any(|style| {
            let Some(pair) = style.as_array() else {
                return true;
            };
            if pair.len() != 2 {
                return true;
            }
            let (Some(property), Some(value)) = (pair[0].as_str(), pair[1].as_str()) else {
                return true;
            };
            !matches!(
                property,
                "width"
                    | "height"
                    | "min-width"
                    | "max-width"
                    | "min-height"
                    | "max-height"
                    | "display"
                    | "flex-direction"
                    | "flex-wrap"
                    | "flex-grow"
                    | "flex-shrink"
                    | "flex-basis"
                    | "grid-template-columns"
                    | "order"
                    | "align-items"
                    | "align-self"
                    | "justify-content"
                    | "gap"
                    | "padding"
                    | "padding-top"
                    | "padding-right"
                    | "padding-bottom"
                    | "padding-left"
                    | "margin"
                    | "margin-top"
                    | "margin-right"
                    | "margin-bottom"
                    | "margin-left"
                    | "color"
                    | "background-color"
                    | "font-size"
                    | "font-weight"
                    | "line-height"
                    | "border-radius"
                    | "border-width"
                    | "border-color"
                    | "translate"
                    | "--hardlyui-locked"
            ) || value.is_empty()
                || value.len() > 256
                || value
                    .chars()
                    .any(|ch| ch.is_control() || matches!(ch, '{' | '}' | ';'))
        })
    {
        return Err("component style is invalid".into());
    }
    let children = node
        .get("children")
        .and_then(serde_json::Value::as_array)
        .ok_or("component children must be an array")?;
    if children.len() > 50 {
        return Err("component has too many children".into());
    }
    for child in children {
        validate_component_node(child, depth + 1, node_count)?;
    }
    Ok(())
}

#[cfg(test)]
mod component_tests {
    use super::validate_components;
    use serde_json::json;

    #[test]
    fn validates_portable_component_records() {
        let item = json!({
            "id": "sample-1", "name": "Play button", "tag": "button", "text": "Play",
            "class_names": ["btn", "btn-primary"], "styles": [["padding", "8px 12px"]],
            "children": [{ "tag": "span", "text": "icon", "class_names": [], "styles": [], "children": [] }]
        });
        assert!(validate_components(&json!([item])).is_ok());
        assert!(validate_components(&json!([{ "id": "bad" }])).is_err());
        assert!(validate_components(&json!([{
            "id": "bad", "name": "Bad", "tag": "button", "text": "x",
            "class_names": ["button; color:red"], "styles": []
        }]))
        .is_err());
    }
}

#[cfg(test)]
mod version_tests {
    use super::{
        compare_version, delete_version, list_versions, load_version, prune_versions,
        read_version_preview, save_version, write_version_preview, MAX_VERSIONS,
        MAX_VERSION_PREVIEW_BYTES,
    };
    use crate::config::VisualEditorConfig;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri_plugin_visual_editor_core::editing::EditHistory;

    #[test]
    fn saves_lists_and_loads_named_history_snapshot() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("hardlyui-versions-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let config = VisualEditorConfig {
            project_root: Some(root.to_string_lossy().into_owned()),
            ..VisualEditorConfig::default()
        };
        let history = EditHistory::default();
        let saved = save_version(&config, &history, "Before layout refactor").unwrap();
        let listed = list_versions(&config).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].label, "Before layout refactor");
        assert_eq!(load_version(&config, &saved.id).unwrap(), history);
        assert!(save_version(&config, &history, "\n").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    fn temp_config(tag: &str) -> (VisualEditorConfig, std::path::PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hardlyui-versions-{tag}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let config = VisualEditorConfig {
            project_root: Some(root.to_string_lossy().into_owned()),
            ..VisualEditorConfig::default()
        };
        (config, root)
    }

    #[test]
    fn deletes_a_single_version_and_rejects_bad_ids() {
        let (config, root) = temp_config("delete");
        let history = EditHistory::default();
        let keep = save_version(&config, &history, "Keep me").unwrap();
        let drop = save_version(&config, &history, "Drop me").unwrap();

        delete_version(&config, &drop.id).unwrap();
        let listed = list_versions(&config).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, keep.id);
        assert!(load_version(&config, &drop.id).is_err());
        assert!(delete_version(&config, &drop.id).is_err());

        for bad in ["", "../escape", "12/34", "abc", "&0"] {
            assert!(delete_version(&config, bad).is_err(), "accepted {bad:?}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prunes_to_the_newest_requested_count() {
        let (config, root) = temp_config("prune");
        let history = EditHistory::default();
        let mut ids = Vec::new();
        for index in 0..5 {
            ids.push(
                save_version(&config, &history, &format!("v{index}"))
                    .unwrap()
                    .id,
            );
        }

        let removed = prune_versions(&config, 2).unwrap();
        assert_eq!(removed.len(), 3);
        let remaining: Vec<String> = list_versions(&config)
            .unwrap()
            .into_iter()
            .map(|summary| summary.id)
            .collect();
        assert_eq!(remaining.len(), 2);
        for kept in &remaining {
            assert!(ids.contains(kept));
        }
        assert!(prune_versions(&config, 0).is_err());
        assert!(prune_versions(&config, MAX_VERSIONS + 1).is_err());
        assert!(prune_versions(&config, 2).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stores_and_removes_a_version_thumbnail() {
        let (config, root) = temp_config("preview");
        let history = EditHistory::default();
        let saved = save_version(&config, &history, "With picture").unwrap();
        assert!(!list_versions(&config).unwrap()[0].has_preview);

        let png = [0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        write_version_preview(&config, &saved.id, &png).unwrap();
        assert!(list_versions(&config).unwrap()[0].has_preview);
        assert_eq!(read_version_preview(&config, &saved.id).unwrap(), png);

        assert!(write_version_preview(&config, &saved.id, b"not a png").is_err());
        assert!(write_version_preview(
            &config,
            &saved.id,
            &vec![0x89; MAX_VERSION_PREVIEW_BYTES + 1]
        )
        .is_err());
        assert!(read_version_preview(&config, "999").is_err());

        delete_version(&config, &saved.id).unwrap();
        assert!(read_version_preview(&config, &saved.id).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prune_removes_thumbnails_with_their_snapshots() {
        let (config, root) = temp_config("prune-preview");
        let history = EditHistory::default();
        let png = [0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let older = save_version(&config, &history, "older").unwrap();
        write_version_preview(&config, &older.id, &png).unwrap();
        let newer = save_version(&config, &history, "newer").unwrap();

        let removed = prune_versions(&config, 1).unwrap();
        assert_eq!(removed, vec![older.id.clone()]);
        assert!(read_version_preview(&config, &older.id).is_err());
        assert!(load_version(&config, &newer.id).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compares_a_version_against_current_css() {
        let (config, root) = temp_config("compare");
        let history = EditHistory::default();
        let saved = save_version(&config, &history, "Checkpoint").unwrap();
        let comparison = compare_version(&config, &history, &saved.id).unwrap();
        assert_eq!(comparison.version_css, comparison.current_css);
        assert!(compare_version(&config, &history, "999").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "HardlyUI output file has no parent directory".to_string())?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let filename = path
        .file_name()
        .ok_or_else(|| "HardlyUI output file has no name".to_string())?
        .to_string_lossy();
    let temp_path = parent.join(format!(
        ".{filename}.{}.{}.tmp",
        std::process::id(),
        sequence
    ));
    let result = (|| {
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        temp.write_all(bytes).map_err(|error| error.to_string())?;
        temp.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}
