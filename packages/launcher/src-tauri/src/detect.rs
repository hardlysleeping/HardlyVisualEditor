use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static HOST_CAN_BUILD_TAURI: OnceLock<bool> = OnceLock::new();
static DEFAULT_CONTAINER: OnceLock<Option<String>> = OnceLock::new();

const SKIP_DIRECTORIES: [&str; 12] = [
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".cache",
    ".venv",
    "venv",
    ".next",
    ".svelte-kit",
    "coverage",
    "vendor",
];

#[derive(Debug, Clone)]
pub struct Detection {
    pub name: String,
    pub adapter: String,
    /// False for a web app that a browser opens instead of a desktop window.
    pub is_web_app: bool,
    pub dev_command: String,
    pub web_url: Option<String>,
    /// Container the command must run in, when this host cannot build the
    /// project itself.
    pub container: Option<String>,
    pub initialized: bool,
    pub overlay_config: bool,
    pub is_tauri: bool,
}

/// Tauri needs the WebKit/GTK development packages at build time. An immutable
/// host usually lacks them, so its Tauri projects can only build in a container.
fn host_can_build_tauri() -> bool {
    *HOST_CAN_BUILD_TAURI.get_or_init(|| {
        std::process::Command::new("pkg-config")
            .args(["--exists", "webkit2gtk-4.1"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

fn container_exists(name: &str) -> bool {
    std::process::Command::new("distrobox")
        .arg("list")
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                line.split('|')
                    .nth(1)
                    .map(|field| field.trim() == name)
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// `HARDLYUI_CONTAINER` wins, otherwise the box built for this project. The
/// lookup runs once: `distrobox list` is not cheap enough for a folder scan.
fn default_container() -> Option<String> {
    DEFAULT_CONTAINER
        .get_or_init(|| {
            if let Ok(name) = std::env::var("HARDLYUI_CONTAINER") {
                let name = name.trim().to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
            if container_exists("huibuild") {
                return Some("huibuild".to_string());
            }
            None
        })
        .clone()
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn package_scripts(package: &serde_json::Value) -> Vec<(String, String)> {
    let Some(scripts) = package.get("scripts").and_then(|value| value.as_object()) else {
        return Vec::new();
    };
    scripts
        .iter()
        .filter_map(|(name, value)| {
            value
                .as_str()
                .map(|command| (name.clone(), command.to_string()))
        })
        .collect()
}

fn has_dependency(package: &serde_json::Value, name: &str) -> bool {
    ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .any(|section| {
            package
                .get(*section)
                .and_then(|value| value.as_object())
                .map(|deps| deps.contains_key(name))
                .unwrap_or(false)
        })
}

fn tauri_config_path(project_root: &Path) -> Option<PathBuf> {
    [
        project_root.join("src-tauri").join("tauri.conf.json"),
        project_root.join("tauri.conf.json"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn display_name(project_root: &Path, package: &Option<serde_json::Value>) -> String {
    if let Some(name) = package
        .as_ref()
        .and_then(|value| value.get("productName").or_else(|| value.get("name")))
        .and_then(|value| value.as_str())
    {
        let cleaned = name
            .trim_start_matches('@')
            .split('/')
            .next_back()
            .unwrap_or(name)
            .to_string();
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    project_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Project".to_string())
}

/// Port HardlyUI assigns to a served app so it does not collide with the copy
/// the owner already runs by hand.
const WEB_APP_PORT: &str = "8471";

fn web_app_command(project_root: &Path) -> Option<String> {
    let server = project_root.join("server.py");
    if server.is_file() {
        let accepts_port = fs::read_to_string(&server)
            .map(|source| source.contains("--port"))
            .unwrap_or(false);
        return Some(if accepts_port {
            format!("python3 server.py --port {WEB_APP_PORT}")
        } else {
            "python3 server.py".to_string()
        });
    }
    None
}

fn web_url_from_command(command: &str) -> Option<String> {
    if command.contains("tauri") {
        return None;
    }
    let marker = "--port";
    let index = command.find(marker)?;
    let rest = command[index + marker.len()..].trim_start_matches(['=', ' ']);
    let port: String = rest
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if port.is_empty() || port.parse::<u16>().is_err() {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}/"))
}

fn dev_command(
    project_root: &Path,
    scripts: &[(String, String)],
    package: &Option<serde_json::Value>,
) -> String {
    for preferred in [
        "tauri:hardlyui",
        "desktop:hardlyui",
        "hardlyui:dev",
        "hardlyui",
    ] {
        if scripts.iter().any(|(name, _)| name == preferred) {
            return format!("npm run {preferred}");
        }
    }
    if project_root.join("tools").join("hardlyui").is_dir() {
        return web_app_command(project_root)
            .unwrap_or_else(|| format!("python3 server.py --port {WEB_APP_PORT}"));
    }
    if package
        .as_ref()
        .map(|value| has_dependency(value, "@tauri-apps/cli"))
        .unwrap_or(false)
        || project_root
            .join("node_modules")
            .join(".bin")
            .join("tauri")
            .exists()
    {
        return "npx tauri dev --features hardlyui --config src-tauri/tauri.hardlyui.conf.json"
            .to_string();
    }
    if let Some(command) = web_app_command(project_root) {
        return command;
    }
    if scripts.iter().any(|(name, _)| name == "dev") {
        return "npm run dev".to_string();
    }
    "npm run tauri dev".to_string()
}

fn adapter_kind(project_root: &Path, package: &Option<serde_json::Value>) -> String {
    let svelte_dependency = package
        .as_ref()
        .map(|value| has_dependency(value, "svelte") || has_dependency(value, "@sveltejs/kit"))
        .unwrap_or(false);
    let has_svelte_sources = [
        "src/App.svelte",
        "src/main.ts",
        "src/main.js",
        "src/routes",
        "src/lib",
    ]
    .iter()
    .any(|relative| project_root.join(relative).exists())
        && fs::read_dir(project_root.join("src"))
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .path()
                        .extension()
                        .map(|extension| extension == "svelte")
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

    if svelte_dependency || has_svelte_sources {
        return "svelte".to_string();
    }
    if project_root.join("web").is_dir()
        || project_root.join("index.html").is_file()
        || project_root.join("server.py").is_file()
    {
        return "css-html".to_string();
    }
    "unknown".to_string()
}

fn is_web_project(project_root: &Path, is_tauri: bool) -> bool {
    // A Tauri app is always a desktop window, even when it ships a local server
    // script the dev command happens to start.
    !is_tauri
        && (project_root.join("server.py").is_file()
            || project_root.join("index.html").is_file()
            || project_root.join("web").join("index.html").is_file())
}

pub fn detect(project_root: &Path) -> Detection {
    let config_path = tauri_config_path(project_root);
    let config = config_path.as_ref().and_then(|path| read_json(path));
    let package = read_json(&project_root.join("package.json"));
    let scripts = package.as_ref().map(package_scripts).unwrap_or_default();

    let overlay_config = project_root
        .join("src-tauri")
        .join("tauri.hardlyui.conf.json")
        .is_file();
    let config_wired = config
        .as_ref()
        .and_then(|value| value.get("plugins"))
        .and_then(|plugins| plugins.get("visualEditor"))
        .is_some();
    let initialized = project_root.join(".hardlyui").is_dir() || config_wired;
    let is_tauri = config_path.is_some();
    let command = dev_command(project_root, &scripts, &package);

    Detection {
        name: display_name(project_root, &package),
        adapter: adapter_kind(project_root, &package),
        is_web_app: is_web_project(project_root, is_tauri),
        web_url: web_url_from_command(&command),
        container: if is_tauri && !host_can_build_tauri() {
            default_container()
        } else {
            None
        },
        dev_command: command,
        initialized,
        overlay_config,
        is_tauri,
    }
}

pub fn default_roots() -> Vec<PathBuf> {
    if let Ok(raw) = std::env::var("HARDLYUI_SCAN_ROOTS") {
        let roots: Vec<PathBuf> = raw
            .split(':')
            .filter(|entry| !entry.trim().is_empty())
            .map(PathBuf::from)
            .collect();
        if !roots.is_empty() {
            return roots;
        }
    }
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"));
    [
        home.join("apps"),
        home.join("projects"),
        home.join("dev"),
        home.join("Documents").join("Codex"),
        home.join("Documents").join("Code"),
    ]
    .into_iter()
    .filter(|root| root.is_dir())
    .collect()
}

/// Depth-limited scan for directories that hold a Tauri config or a served web
/// app. Skips build output and dependency trees so a large checkout stays cheap
/// to walk.
pub fn scan_for_projects(root: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth > 5 || !root.is_dir() {
        return;
    }
    if tauri_config_path(root).is_some() || root.join("server.py").is_file() {
        found.push(root.to_path_buf());
        // Neither a Tauri project nor a served app nests another one inside its
        // own tree.
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skipped = path
            .file_name()
            .map(|name| {
                let name = name.to_string_lossy();
                SKIP_DIRECTORIES.contains(&name.as_ref()) || name.starts_with('.')
            })
            .unwrap_or(false);
        if skipped {
            continue;
        }
        scan_for_projects(&path, depth + 1, found);
    }
}
