use serde::{Deserialize, Serialize};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::detect;

const REGISTRY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub dev_command: String,
    pub adapter: String,
    /// Served web app: the launcher opens it in the browser instead of waiting
    /// for a desktop window.
    #[serde(default)]
    pub web_app: bool,
    #[serde(default)]
    pub web_url: Option<String>,
    /// Container the dev command must run in (a distrobox box with the WebKit
    /// dev packages, for example), or None to run it on the host.
    #[serde(default)]
    pub container: Option<String>,
    pub initialized: bool,
    pub overlay_config: bool,
    pub last_opened: Option<u64>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub dev_command: Option<String>,
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCandidate {
    pub path: String,
    pub name: String,
    pub adapter: String,
    pub dev_command: String,
    /// Served web app: the launcher opens it in the browser instead of waiting
    /// for a desktop window.
    #[serde(default)]
    pub web_app: bool,
    #[serde(default)]
    pub web_url: Option<String>,
    pub initialized: bool,
    pub registered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRoot {
    pub path: String,
    pub exists: bool,
    pub candidate_count: usize,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    projects: Vec<Project>,
}

fn default_version() -> u32 {
    REGISTRY_VERSION
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

pub fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HARDLYUI_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".config"))
        .join("hardlyui")
}

pub fn registry_path() -> PathBuf {
    config_dir().join("projects.json")
}

fn load_file() -> RegistryFile {
    let path = registry_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return RegistryFile {
            version: REGISTRY_VERSION,
            projects: Vec::new(),
        };
    };
    match serde_json::from_str::<RegistryFile>(&raw) {
        Ok(mut file) => {
            file.version = REGISTRY_VERSION;
            file
        }
        Err(error) => {
            // Never silently drop a user's project list: keep the unreadable
            // file next to the registry so it can be recovered by hand.
            let backup = path.with_extension(format!("json.corrupt-{}", now_seconds()));
            let _ = fs::rename(&path, &backup);
            eprintln!(
                "hardlyui-launcher: could not read {} ({error}); moved it to {} and started empty",
                path.display(),
                backup.display()
            );
            RegistryFile {
                version: REGISTRY_VERSION,
                projects: Vec::new(),
            }
        }
    }
}

fn save_file(file: &RegistryFile) -> Result<(), String> {
    let path = registry_path();
    let dir = path
        .parent()
        .ok_or_else(|| "registry path has no parent directory".to_string())?;
    fs::create_dir_all(dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let serialized = serde_json::to_string_pretty(file)
        .map_err(|error| format!("cannot serialize project registry: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{serialized}\n"))
        .map_err(|error| format!("cannot write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("cannot replace {}: {error}", path.display()))
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
        if slug.len() >= 32 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

fn project_id(name: &str, canonical_path: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    canonical_path.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{}-{:06x}", slugify(name), hash & 0xff_ffff)
}

fn clean_name(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    candidate
        .chars()
        .filter(|character| !character.is_control())
        .take(64)
        .collect()
}

fn clean_command(raw: &str) -> Result<String, String> {
    let command = raw.trim();
    if command.is_empty() {
        return Err("a dev command is required".into());
    }
    if command.len() > 512 {
        return Err("the dev command is longer than 512 characters".into());
    }
    if command.chars().any(|character| character.is_control()) {
        return Err("the dev command cannot contain control characters".into());
    }
    Ok(command.to_string())
}

pub fn list() -> Result<Vec<Project>, String> {
    let mut projects = load_file().projects;
    for project in &mut projects {
        refresh_detection(project);
    }
    projects.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(projects)
}

pub fn get(id: &str) -> Result<Project, String> {
    load_file()
        .projects
        .into_iter()
        .find(|project| project.id == id)
        .ok_or_else(|| "project is not registered in the launcher".to_string())
}

pub fn add(path: &str, name: Option<String>) -> Result<Project, String> {
    let requested = Path::new(path);
    if !requested.is_dir() {
        return Err(format!("{} is not a directory", requested.display()));
    }
    let canonical = fs::canonicalize(requested)
        .map_err(|error| format!("cannot resolve {}: {error}", requested.display()))?;
    let detection = detect::detect(&canonical);
    if !detection.is_tauri && !detection.is_web_app {
        return Err(format!(
            "{} is neither a Tauri project (no src-tauri/tauri.conf.json) nor a served web app (no server.py or index.html)",
            canonical.display()
        ));
    }

    let mut file = load_file();
    if let Some(existing) = file.projects.iter().find(|project| {
        fs::canonicalize(&project.path)
            .map(|path| path == canonical)
            .unwrap_or(false)
    }) {
        return Err(format!(
            "{} is already registered as {}",
            canonical.display(),
            existing.name
        ));
    }

    let display_name = clean_name(name.as_deref().unwrap_or(&detection.name), &detection.name);
    let project = Project {
        id: project_id(&display_name, &canonical),
        name: display_name,
        path: canonical.to_string_lossy().to_string(),
        dev_command: detection.dev_command,
        adapter: detection.adapter,
        web_app: detection.is_web_app,
        web_url: detection.web_url,
        container: detection.container,
        initialized: detection.initialized,
        overlay_config: detection.overlay_config,
        last_opened: None,
        notes: String::new(),
    };
    file.projects.push(project.clone());
    save_file(&file)?;
    Ok(project)
}

pub fn update(id: &str, patch: ProjectPatch) -> Result<Project, String> {
    let mut file = load_file();
    let index = file
        .projects
        .iter()
        .position(|project| project.id == id)
        .ok_or_else(|| "project is not registered in the launcher".to_string())?;
    let current = file.projects[index].clone();

    let mut next = current.clone();
    if let Some(name) = patch.name {
        next.name = clean_name(&name, &current.name);
    }
    if let Some(command) = patch.dev_command {
        next.dev_command = clean_command(&command)?;
    }
    if let Some(adapter) = patch.adapter {
        if !matches!(adapter.as_str(), "svelte" | "css-html" | "unknown") {
            return Err("unknown adapter kind".into());
        }
        next.adapter = adapter;
    }
    if let Some(url) = patch.web_url {
        next.web_url = if url.trim().is_empty() {
            None
        } else {
            Some(clean_web_url(&url)?)
        };
    }
    if let Some(container) = patch.container {
        next.container = if container.trim().is_empty() {
            None
        } else {
            Some(clean_container(&container)?)
        };
    }
    if let Some(notes) = patch.notes {
        next.notes = notes.chars().take(400).collect();
    }
    file.projects[index] = next.clone();
    save_file(&file)?;
    Ok(next)
}

pub fn remove(id: &str) -> Result<(), String> {
    let mut file = load_file();
    let before = file.projects.len();
    file.projects.retain(|project| project.id != id);
    if file.projects.len() == before {
        return Err("project is not registered in the launcher".into());
    }
    save_file(&file)
}

pub fn mark_opened(id: &str) -> Result<(), String> {
    let mut file = load_file();
    let mut found = false;
    for project in &mut file.projects {
        if project.id == id {
            project.last_opened = Some(now_seconds());
            found = true;
        }
    }
    if !found {
        return Err("project is not registered in the launcher".into());
    }
    save_file(&file)
}

/// Refresh the cached readiness flags when a project is inspected again.
pub fn refresh_detection(project: &mut Project) {
    if let Ok(canonical) = fs::canonicalize(&project.path) {
        let detection = detect::detect(&canonical);
        project.initialized = detection.initialized;
        project.overlay_config = detection.overlay_config;
        project.web_app = detection.is_web_app;
        if project.web_url.is_none() {
            project.web_url = detection.web_url;
        }
        // `container` is deliberately left alone: add() seeds it from detection,
        // and after that it is the user's choice. Re-adopting a detected box here
        // would undo a project that was set back to running on the host.
        if project.adapter == "unknown" {
            project.adapter = detection.adapter;
        }
    }
}

/// A container name, not a command: distrobox/podman names are short and
/// alphanumeric, so anything that could carry shell syntax is refused.
pub fn clean_container(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    let valid = !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        });
    if !valid {
        return Err("a container name uses only letters, digits, dot, dash and underscore".into());
    }
    Ok(name.to_string())
}

/// Only local http(s) addresses are opened. A dev-server address is untrusted
/// output from the child process, so it must never point off this machine.
pub fn clean_web_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() || url.len() > 2_048 {
        return Err("a web address is required".into());
    }
    if url.chars().any(|character| {
        character.is_whitespace()
            || character.is_control()
            || matches!(character, '"' | '\'' | '<' | '>')
    }) {
        return Err("the web address contains unsupported characters".into());
    }
    let Some(rest) = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
    else {
        return Err("the web address must start with http:// or https://".into());
    };
    let authority = rest.split(['/', '#', '?']).next().unwrap_or(rest);
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    if !matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1") {
        return Err("only local addresses can be opened by the launcher".into());
    }
    Ok(url.to_string())
}

pub fn set_web_url(id: &str, url: &str) -> Result<(), String> {
    let mut file = load_file();
    let mut found = false;
    for project in &mut file.projects {
        if project.id == id {
            project.web_url = Some(clean_web_url(url)?);
            found = true;
        }
    }
    if !found {
        return Err("project is not registered in the launcher".into());
    }
    save_file(&file)
}

pub fn discover(roots: Option<Vec<String>>) -> Result<Vec<ProjectCandidate>, String> {
    let registered_paths: Vec<PathBuf> = load_file()
        .projects
        .iter()
        .filter_map(|project| fs::canonicalize(&project.path).ok())
        .collect();

    let scan_roots = match roots {
        Some(list) if !list.is_empty() => list.into_iter().map(PathBuf::from).collect(),
        _ => detect::default_roots(),
    };

    let mut found: Vec<PathBuf> = Vec::new();
    for root in scan_roots {
        detect::scan_for_projects(&root, 0, &mut found);
    }
    found.sort();
    found.dedup();

    let candidates = found
        .into_iter()
        .filter_map(|path| {
            let canonical = fs::canonicalize(&path).unwrap_or(path);
            let detection = detect::detect(&canonical);
            if !detection.is_tauri && !detection.is_web_app {
                return None;
            }
            let registered = registered_paths.iter().any(|entry| entry == &canonical);
            Some(ProjectCandidate {
                path: canonical.to_string_lossy().to_string(),
                name: detection.name,
                adapter: detection.adapter,
                dev_command: detection.dev_command,
                web_app: detection.is_web_app,
                web_url: detection.web_url,
                initialized: detection.initialized,
                registered,
            })
        })
        .collect::<Vec<_>>();
    Ok(candidates)
}

pub fn discover_roots() -> Vec<DiscoverRoot> {
    detect::default_roots()
        .into_iter()
        .map(|root| {
            let exists = root.is_dir();
            let mut found = Vec::new();
            if exists {
                detect::scan_for_projects(&root, 0, &mut found);
            }
            DiscoverRoot {
                path: root.to_string_lossy().to_string(),
                exists,
                candidate_count: found.len(),
            }
        })
        .collect()
}
