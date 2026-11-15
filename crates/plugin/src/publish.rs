//! Drafts, publishing and rollback.
//!
//! A draft is simply the edit history the project already keeps: every change is
//! written as it happens. Publishing turns the current draft into a named,
//! protected restore point, copies the pictures it uses into a folder the built
//! app can serve, and records both so "go back to what I published" is possible
//! later.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_visual_editor_core::editing::EditHistory;

use crate::config::VisualEditorConfig;
use crate::editing_storage::{self, project_root, record_published, VersionSummary};
use crate::media::{self, MEDIA_URL_PREFIX};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PublishResult {
    /// Restore point created by this publish.
    pub version: VersionSummary,
    pub published_at: u128,
    /// Pictures copied for this publish, by file name.
    pub media: Vec<String>,
    /// Folder the pictures landed in, relative to the project root.
    pub media_folder: String,
    /// False when the project has no folder the app serves, so the addresses
    /// will not resolve in a build until the pictures are moved somewhere real.
    pub media_url_works: bool,
}

/// Every stored picture the current draft points at, as the addresses the
/// draft uses. `media::publish_media` copies the ones it recognises.
pub fn referenced_media(history: &EditHistory) -> Vec<String> {
    let mut found = Vec::new();
    for transaction in history.transactions() {
        for operation in &transaction.operations {
            let mut consider = |value: &str| {
                if value.starts_with(MEDIA_URL_PREFIX)
                    && !found.iter().any(|seen: &String| seen == value)
                {
                    found.push(value.to_string());
                }
            };
            match operation {
                tauri_plugin_visual_editor_core::editing::StyleOperation::InsertElement {
                    image_url: Some(url),
                    ..
                } => consider(url),
                tauri_plugin_visual_editor_core::editing::StyleOperation::SetStyle {
                    property,
                    after: Some(value),
                    ..
                } if property == "background-image" || property == "background" => consider(value),
                _ => {}
            }
        }
    }
    found
}

/// Picks where copied pictures should go. A project with a `static/` or
/// `public/` folder already serves those files at the site root, so the same
/// `/__hardlyui/media/<file>` address keeps working; otherwise the files are
/// kept next to the draft and the caller is told they are not served yet.
fn media_destination(root: &Path) -> (PathBuf, bool) {
    for served in ["static", "public"] {
        let folder = root.join(served);
        if folder.is_dir() {
            return (folder.join("__hardlyui").join("media"), true);
        }
    }
    (root.join(".hardlyui").join("published-media"), false)
}

fn relative_to_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Publishes the current draft.
pub fn publish(
    config: &VisualEditorConfig,
    history: &EditHistory,
    label: &str,
) -> Result<PublishResult, String> {
    let root = project_root(config)?;
    // The generated stylesheet is rewritten on every commit; writing the
    // history again here means a publish always leaves a complete, matching
    // pair on disk even if a previous write was interrupted.
    editing_storage::save_edit_history(config, history)?;

    let label = label.trim();
    let label = if label.is_empty() { "Published" } else { label };
    let version = editing_storage::save_version(config, history, label)?;

    let references = referenced_media(history);
    let (destination, url_works) = media_destination(&root);
    let copied = media::publish_media(config, &references, &destination)?;

    let published_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    record_published(
        config,
        &version,
        published_at,
        &copied,
        &relative_to_root(&root, &destination),
        url_works,
    )?;

    Ok(PublishResult {
        version,
        published_at,
        media: copied,
        media_folder: relative_to_root(&root, &destination),
        media_url_works: url_works,
    })
}

/// Creates the folders publishing writes into. Kept separate so a test can
/// assert the layout without running the whole publish, which is why it only
/// exists for tests.
#[cfg(test)]
pub fn ensure_media_folder(root: &Path) -> Result<PathBuf, String> {
    let (destination, _) = media_destination(root);
    std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    Ok(destination)
}

#[cfg(test)]
mod publish_tests {
    use super::*;
    use std::fs;
    use tauri_plugin_visual_editor_core::editing::{ElementIdentity, StyleOperation, Transaction};

    fn identity() -> ElementIdentity {
        ElementIdentity {
            webview_id: "main".into(),
            inspector_id: Some("hero".into()),
            html_id: None,
            semantic_selector: None,
            generated_id: Some("hardlyui-hero".into()),
        }
    }

    fn history_with_image(url: &str) -> EditHistory {
        let mut history = EditHistory::default();
        history
            .commit(Transaction {
                id: "insert".into(),
                label: Some("Insert picture".into()),
                operations: vec![StyleOperation::InsertElement {
                    identity: identity(),
                    parent: identity(),
                    tag: "img".into(),
                    text: "hero".into(),
                    class_names: vec![],
                    slot_name: None,
                    image_url: Some(url.into()),
                }],
            })
            .unwrap();
        history
    }

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hardlyui-publish-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn config_for(root: &Path) -> VisualEditorConfig {
        VisualEditorConfig {
            project_root: Some(root.to_string_lossy().to_string()),
            ..VisualEditorConfig::default()
        }
    }

    #[test]
    fn finds_the_pictures_a_draft_references() {
        let history = history_with_image("/__hardlyui/media/hero-1234.png");
        assert_eq!(
            referenced_media(&history),
            vec!["/__hardlyui/media/hero-1234.png".to_string()]
        );
        assert!(referenced_media(&EditHistory::default()).is_empty());
    }

    #[test]
    fn publishing_creates_a_protected_restore_point_and_copies_pictures() {
        let root = temp_root("static");
        fs::create_dir_all(root.join("static")).unwrap();
        let config = config_for(&root);
        let item = media::save_media(
            &config,
            "hero",
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        let history = history_with_image(&item.url);

        let first = publish(&config, &history, "First look").unwrap();
        assert!(first.media_url_works);
        assert_eq!(first.media, vec![item.name.clone()]);
        assert_eq!(first.media_folder, "static/__hardlyui/media");
        assert!(root
            .join("static/__hardlyui/media")
            .join(&item.name)
            .is_file());

        let listed = editing_storage::list_versions(&config).unwrap();
        assert!(listed[0].published, "the newest checkpoint is published");

        // Pruning counts ordinary checkpoints only: published restore points
        // survive, and an unpublished one beyond the limit goes.
        let second = publish(&config, &history, "Second look").unwrap();
        assert_ne!(first.version.id, second.version.id);
        let older = editing_storage::save_version(&config, &history, "Older draft").unwrap();
        let newer = editing_storage::save_version(&config, &history, "Newer draft").unwrap();
        assert!(!older.published && !newer.published);
        let removed = editing_storage::prune_versions(&config, 1).unwrap();
        assert!(
            removed.contains(&older.id) && !removed.contains(&newer.id),
            "only the older ordinary checkpoint is pruned, got {removed:?}"
        );
        let survivors = editing_storage::list_versions(&config).unwrap();
        assert!(survivors
            .iter()
            .all(|version| version.published || version.id == newer.id));
        assert!(survivors
            .iter()
            .any(|version| version.id == first.version.id));
        assert!(survivors
            .iter()
            .any(|version| version.id == second.version.id));

        // A published checkpoint cannot be deleted by hand either.
        assert!(editing_storage::delete_version(&config, &second.version.id).is_err());
        let published = editing_storage::list_published(&config).unwrap();
        assert_eq!(published.len(), 2);
        assert_eq!(published[0].id, second.version.id);
        assert_eq!(published[0].media, vec![item.name.clone()]);
        assert!(published[0].media_url_works);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_project_without_a_served_folder_says_so() {
        let root = temp_root("noserved");
        let config = config_for(&root);
        let item = media::save_media(
            &config,
            "hero",
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        let result = publish(&config, &history_with_image(&item.url), "Draft").unwrap();
        assert!(!result.media_url_works);
        assert_eq!(result.media_folder, ".hardlyui/published-media");
        assert!(root
            .join(".hardlyui/published-media")
            .join(&item.name)
            .is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
}
