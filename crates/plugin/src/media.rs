//! Project media library under `.hardlyui/media/`.
//!
//! The inspector can upload a picture, list what is there, and insert it. Files
//! are stored inside the project so a build can ship them, and the dev-only
//! Svelte adapter serves them at `/__hardlyui/media/<file>` while editing.

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::config::VisualEditorConfig;
use crate::editing_storage::project_root;

const MEDIA_DIR: &str = "media";
/// 4 MiB is generous for a web picture and small enough to keep the project
/// and its git history sane.
pub const MAX_MEDIA_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_MEDIA_ITEMS: usize = 500;
pub const MEDIA_URL_PREFIX: &str = "/__hardlyui/media/";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct MediaItem {
    pub name: String,
    /// Address to put in an image element; served in dev and copied on publish.
    pub url: String,
    pub bytes: u64,
    /// `png`, `jpeg`, `webp`, `gif` or `svg`.
    pub kind: String,
}

fn media_directory(config: &VisualEditorConfig) -> Result<PathBuf, String> {
    let root = project_root(config)?;
    let directory = root.join(".hardlyui").join(MEDIA_DIR);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("HardlyUI media directory escapes projectRoot".into());
    }
    Ok(canonical)
}

/// A stored name is `<stem>-<content hash>.<ext>`: safe to serve, stable for the
/// same picture, and impossible to walk out of the directory.
fn sanitize_stem(hint: &str) -> String {
    // The extension is decided by the bytes, not by the uploaded name.
    let hint = hint.rsplit_once('.').map_or(hint, |(stem, _)| stem);
    let stem: String = hint
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let stem = stem.trim_matches('-').replace("--", "-");
    let stem: String = stem.chars().take(48).collect();
    if stem.is_empty() {
        "image".into()
    } else {
        stem
    }
}

fn content_hash(bytes: &[u8]) -> String {
    // FNV-1a is enough here: the hash only has to separate two uploads, not
    // resist an attacker.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}").chars().take(8).collect()
}

/// Detects the picture type from its own bytes, not from the file name.
pub fn detect_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpeg");
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if looks_like_svg(bytes) {
        return Some("svg");
    }
    None
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4_096)]);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg"))
}

fn extension(kind: &str) -> &'static str {
    match kind {
        "jpeg" => "jpg",
        other => match other {
            "png" => "png",
            "webp" => "webp",
            "gif" => "gif",
            _ => "svg",
        },
    }
}

/// SVG can carry script, and the dev server serves media from the app origin,
/// so a picture with active content is refused rather than sanitised.
fn svg_is_safe(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    !(text.contains("<script")
        || text.contains("javascript:")
        || text.contains("<foreignobject")
        || text.contains("<!entity")
        || text.contains("<iframe"))
        && !text.contains(" onload=")
        && !text.contains(" onclick=")
        && !text.contains(" onerror=")
}

fn item_for(name: &str, bytes: u64) -> MediaItem {
    let kind = name.rsplit_once('.').map(|(_, ext)| match ext {
        "jpg" | "jpeg" => "jpeg",
        "webp" => "webp",
        "gif" => "gif",
        "svg" => "svg",
        _ => "png",
    });
    MediaItem {
        name: name.into(),
        url: format!("{MEDIA_URL_PREFIX}{name}"),
        bytes,
        kind: kind.unwrap_or("png").into(),
    }
}

fn require_valid_name(name: &str) -> Result<(), String> {
    let valid = !name.is_empty()
        && name.len() <= 96
        && name.chars().all(|ch| {
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '-' | '_' | '.')
        })
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .rsplit_once('.')
            .is_some_and(|(_, ext)| matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"));
    if valid {
        Ok(())
    } else {
        Err("media file name is not a supported picture".into())
    }
}

/// Stores an uploaded picture and returns what the inspector should show.
pub fn save_media(
    config: &VisualEditorConfig,
    name_hint: &str,
    bytes: &[u8],
) -> Result<MediaItem, String> {
    if bytes.is_empty() {
        return Err("that file is empty".into());
    }
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err(format!(
            "pictures must be at most {} MiB",
            MAX_MEDIA_BYTES / (1024 * 1024)
        ));
    }
    let kind =
        detect_kind(bytes).ok_or("only PNG, JPEG, WebP, GIF and SVG pictures can be added")?;
    if kind == "svg" && !svg_is_safe(bytes) {
        return Err("that SVG contains script or remote content, so it was refused".into());
    }
    let directory = media_directory(config)?;
    if list_media(config)?.len() >= MAX_MEDIA_ITEMS {
        return Err(format!(
            "the media library holds at most {MAX_MEDIA_ITEMS} pictures"
        ));
    }
    let hash = content_hash(bytes);
    let extension = extension(kind);
    // Same picture uploaded twice under a different name: keep one copy.
    let existing_suffix = format!("-{hash}.{extension}");
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let existing = entry.file_name().to_string_lossy().to_string();
        if existing.ends_with(&existing_suffix) && require_valid_name(&existing).is_ok() {
            let bytes = entry
                .metadata()
                .map(|meta| meta.len())
                .map_err(|error| error.to_string())?;
            return Ok(item_for(&existing, bytes));
        }
    }
    let name = format!("{}-{hash}.{extension}", sanitize_stem(name_hint));
    let target = directory.join(&name);
    let temp = directory.join(format!(".{name}.{}.tmp", std::process::id()));
    fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temp, &target).map_err(|error| error.to_string())?;
    Ok(item_for(&name, bytes.len() as u64))
}

pub fn list_media(config: &VisualEditorConfig) -> Result<Vec<MediaItem>, String> {
    let directory = media_directory(config)?;
    let mut items = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if require_valid_name(&name).is_err() {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            continue;
        }
        items.push(item_for(&name, metadata.len()));
    }
    items.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(items)
}

pub fn read_media(config: &VisualEditorConfig, name: &str) -> Result<String, String> {
    require_valid_name(name)?;
    let directory = media_directory(config)?;
    let path = directory.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("media path is invalid".into());
    }
    if metadata.len() as usize > MAX_MEDIA_BYTES {
        return Err("that picture is larger than the media limit".into());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    Ok(STANDARD.encode(bytes))
}

pub fn delete_media(config: &VisualEditorConfig, name: &str) -> Result<(), String> {
    require_valid_name(name)?;
    let directory = media_directory(config)?;
    fs::remove_file(directory.join(name)).map_err(|error| format!("cannot delete picture: {error}"))
}

/// Copies every referenced picture into a host folder on publish and rewrites
/// nothing: the caller keeps the `/__hardlyui/media/<file>` address because the
/// copy lands where that path resolves. Returns how many files were copied.
pub fn publish_media(
    config: &VisualEditorConfig,
    references: &[String],
    destination: &Path,
) -> Result<Vec<String>, String> {
    let directory = media_directory(config)?;
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut copied = Vec::new();
    for url in references {
        let Some(name) = url.strip_prefix(MEDIA_URL_PREFIX) else {
            continue;
        };
        if require_valid_name(name).is_err() || copied.iter().any(|done: &String| done == name) {
            continue;
        }
        let source = directory.join(name);
        if !source.is_file() {
            continue;
        }
        fs::copy(&source, destination.join(name)).map_err(|error| error.to_string())?;
        copied.push(name.to_string());
    }
    Ok(copied)
}

#[cfg(test)]
mod media_tests {
    use super::*;
    use crate::config::VisualEditorConfig;

    fn temp_config(label: &str) -> (VisualEditorConfig, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "hardlyui-media-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let config = VisualEditorConfig {
            project_root: Some(root.to_string_lossy().to_string()),
            ..VisualEditorConfig::default()
        };
        (config, root)
    }

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

    #[test]
    fn detects_supported_picture_types_from_bytes() {
        assert_eq!(detect_kind(&PNG), Some("png"));
        assert_eq!(detect_kind(&[0xff, 0xd8, 0xff, 0xdb]), Some("jpeg"));
        assert_eq!(detect_kind(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(
            detect_kind(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
            Some("svg")
        );
        assert_eq!(detect_kind(b"not a picture"), None);
    }

    #[test]
    fn stores_lists_reads_and_deletes_a_picture() {
        let (config, root) = temp_config("roundtrip");
        let item = save_media(&config, "My Hero Image.png", &PNG).unwrap();
        assert!(item.name.starts_with("my-hero-image-"));
        assert!(item.name.ends_with(".png"));
        assert_eq!(item.url, format!("{MEDIA_URL_PREFIX}{}", item.name));

        let listed = list_media(&config).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].bytes, PNG.len() as u64);

        let encoded = read_media(&config, &item.name).unwrap();
        assert_eq!(STANDARD.decode(encoded).unwrap(), PNG.to_vec());

        // The same bytes uploaded twice keep one copy.
        assert_eq!(save_media(&config, "again", &PNG).unwrap().name, item.name);
        assert_eq!(list_media(&config).unwrap().len(), 1);

        delete_media(&config, &item.name).unwrap();
        assert!(list_media(&config).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_junk_oversized_scripted_svg_and_walking_names() {
        let (config, root) = temp_config("refusals");
        assert!(save_media(&config, "empty", b"").is_err());
        assert!(save_media(&config, "junk", b"hello").is_err());
        assert!(save_media(&config, "big", &vec![0u8; MAX_MEDIA_BYTES + 1]).is_err());
        assert!(save_media(
            &config,
            "script",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"
        )
        .is_err());

        assert!(read_media(&config, "../history.json").is_err());
        assert!(read_media(&config, "notes.txt").is_err());
        assert!(delete_media(&config, "a/../../x.png").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publish_copies_only_referenced_media() {
        let (config, root) = temp_config("publish");
        let kept = save_media(&config, "kept", &PNG).unwrap();
        let unused = save_media(&config, "unused", &[0xff, 0xd8, 0xff, 0x00]).unwrap();
        let destination = root.join("static").join("hardlyui-media");
        let copied = publish_media(
            &config,
            &[
                kept.url.clone(),
                kept.url.clone(),
                "https://example.com/x.png".into(),
            ],
            &destination,
        )
        .unwrap();
        assert_eq!(copied, vec![kept.name.clone()]);
        assert!(destination.join(&kept.name).is_file());
        assert!(!destination.join(&unused.name).is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
}
