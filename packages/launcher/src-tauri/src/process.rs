use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const LOG_EVENT: &str = "launcher:log";
pub const STATUS_EVENT: &str = "launcher:status";
pub const URL_EVENT: &str = "launcher:url";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlEvent {
    pub project_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub project_id: String,
    pub stream: String,
    pub line: String,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub project_id: String,
    pub state: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
}

#[derive(Clone, Default)]
pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    running: HashMap<String, u32>,
    stopping: HashSet<u32>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_log(app: &AppHandle, project_id: &str, stream: &str, line: String) {
    let _ = app.emit(
        LOG_EVENT,
        LogEntry {
            project_id: project_id.to_string(),
            stream: stream.to_string(),
            line,
            at: now_millis(),
        },
    );
}

fn emit_url_if_new(
    app: &AppHandle,
    seen: &Arc<Mutex<HashSet<String>>>,
    project_id: &str,
    line: &str,
    open_web: bool,
) {
    let Some(url) = find_local_url(line) else {
        return;
    };
    let fresh = seen
        .lock()
        .map(|mut seen| seen.insert(url.clone()))
        .unwrap_or(false);
    if !fresh {
        return;
    }
    let _ = app.emit(
        URL_EVENT,
        UrlEvent {
            project_id: project_id.to_string(),
            url: url.clone(),
        },
    );
    if open_web {
        // The dev server printed its address, so it is listening: show the app
        // in the browser instead of leaving the owner with a silent server.
        let _ = open::that_detached(&url);
    }
}

fn emit_status(
    app: &AppHandle,
    project_id: &str,
    state: &str,
    pid: Option<u32>,
    exit_code: Option<i32>,
    message: Option<String>,
) {
    let _ = app.emit(
        STATUS_EVENT,
        RunStatus {
            project_id: project_id.to_string(),
            state: state.to_string(),
            pid,
            exit_code,
            message,
        },
    );
}

fn signal_group(pid: u32, signal: i32) {
    // The child is spawned as its own process-group leader, so a negative pid
    // reaches the dev server and everything it started (vite, cargo, tauri).
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

/// Extract the first local dev-server address from one output line, normalized
/// to `localhost` so `127.0.0.1` and `localhost` do not produce two events.
pub fn find_local_url(line: &str) -> Option<String> {
    let mut rest = line;
    while let Some(index) = rest.find("http://") {
        let candidate = &rest[index..];
        let bounded: String = candidate.chars().take(200).collect();
        if let Some(url) = normalize_local_url(&bounded) {
            return Some(url);
        }
        rest = &rest[index + "http://".len()..];
    }
    None
}

fn normalize_local_url(candidate: &str) -> Option<String> {
    let rest = candidate.strip_prefix("http://")?;
    let authority_end = rest
        .find(|character: char| {
            character.is_whitespace()
                || matches!(character, '/' | '"' | '\'' | ')' | ',' | ';' | '>')
        })
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return None;
    }
    let (host, port) = if authority.starts_with('[') {
        let close = authority.find(']')?;
        (
            &authority[..=close],
            authority[close + 1..].strip_prefix(':'),
        )
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        (host, Some(port))
    } else {
        (authority, None)
    };
    if !matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
        return None;
    }
    if let Some(port) = port {
        if port.is_empty() || port.parse::<u16>().is_err() {
            return None;
        }
        return Some(format!("http://localhost:{port}/"));
    }
    Some("http://localhost/".to_string())
}

pub fn list(supervisor: &Supervisor) -> Vec<RunStatus> {
    supervisor
        .inner
        .lock()
        .map(|inner| {
            inner
                .running
                .iter()
                .map(|(project_id, pid)| RunStatus {
                    project_id: project_id.clone(),
                    state: "running".to_string(),
                    pid: Some(*pid),
                    exit_code: None,
                    message: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Run the dev command inside a distrobox container, still from the project
/// directory. Tauri needs the WebKit/GTK headers at build time, which an
/// immutable host does not have, so the launcher's own container is the only
/// way those projects build here.
fn container_command(name: &str, cwd: &Path, command: &str) -> Result<String, String> {
    let name = crate::registry::clean_container(name)?;
    let available = Command::new("/bin/bash")
        .arg("-lc")
        .arg("command -v distrobox")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !available {
        return Err(format!(
            "this project is set to run in {name}, but distrobox is not installed"
        ));
    }
    // Quote the inner script exactly once. Interpolating an already-quoted
    // command would let an apostrophe in a project path (or in the command)
    // close the quote and reach the outer shell as a separate statement.
    let script = format!(
        "cd {} && {command}",
        shell_single_quote(&cwd.to_string_lossy())
    );
    Ok(format!(
        "distrobox enter {name} -- bash -lc {}",
        shell_single_quote(&script)
    ))
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn spawn(
    app: AppHandle,
    supervisor: Supervisor,
    project_id: String,
    cwd: PathBuf,
    command: String,
    open_web: bool,
    container: Option<String>,
) -> Result<RunStatus, String> {
    if !cwd.is_dir() {
        return Err(format!("{} is not a directory", cwd.display()));
    }

    {
        let inner = supervisor
            .inner
            .lock()
            .map_err(|_| "launcher supervisor is unavailable".to_string())?;
        if inner.running.contains_key(&project_id) {
            return Err("that project is already running".into());
        }
    }

    emit_log(&app, &project_id, "system", format!("$ {command}"));

    let command = match container.as_deref() {
        Some(name) => {
            let wrapped = container_command(name, &cwd, &command)?;
            emit_log(&app, &project_id, "system", format!("in {name}: {wrapped}"));
            wrapped
        }
        None => command,
    };

    let mut child = Command::new("/bin/bash")
        .arg("-lc")
        .arg(&command)
        .current_dir(&cwd)
        .env("HARDLYUI_LAUNCHER", "1")
        .env("FORCE_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|error| format!("could not start `{command}`: {error}"))?;

    let pid = child.id();
    emit_log(
        &app,
        &project_id,
        "system",
        format!("started `{command}` in {} (pid {pid})", cwd.display()),
    );

    let seen_urls: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    if let Some(stdout) = child.stdout.take() {
        let app_handle = app.clone();
        let project = project_id.clone();
        let urls = seen_urls.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                emit_url_if_new(&app_handle, &urls, &project, &line, open_web);
                emit_log(&app_handle, &project, "stdout", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_handle = app.clone();
        let project = project_id.clone();
        let urls = seen_urls.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                emit_url_if_new(&app_handle, &urls, &project, &line, open_web);
                emit_log(&app_handle, &project, "stderr", line);
            }
        });
    }

    {
        let mut inner = supervisor
            .inner
            .lock()
            .map_err(|_| "launcher supervisor is unavailable".to_string())?;
        inner.running.insert(project_id.clone(), pid);
    }

    let waiter = supervisor.clone();
    let app_handle = app.clone();
    let project = project_id.clone();
    thread::spawn(move || {
        let outcome = child.wait();
        let requested_stop = waiter
            .inner
            .lock()
            .map(|mut inner| {
                inner.running.remove(&project);
                inner.stopping.remove(&pid)
            })
            .unwrap_or(false);

        let exit_code = outcome.ok().and_then(|status| status.code());
        let state = if requested_stop || exit_code == Some(0) {
            "stopped"
        } else {
            "failed"
        };
        emit_log(
            &app_handle,
            &project,
            "system",
            match exit_code {
                Some(code) => format!("process exited with code {code}"),
                None => "process ended".to_string(),
            },
        );
        emit_status(
            &app_handle,
            &project,
            state,
            None,
            exit_code,
            if state == "failed" {
                Some("the dev server exited before the editor was ready".to_string())
            } else {
                None
            },
        );
    });

    emit_status(&app, &project_id, "starting", Some(pid), None, None);

    Ok(RunStatus {
        project_id,
        state: "starting".to_string(),
        pid: Some(pid),
        exit_code: None,
        message: None,
    })
}

pub fn stop(app: AppHandle, supervisor: Supervisor, project_id: &str) -> Result<(), String> {
    let pid = {
        let mut inner = supervisor
            .inner
            .lock()
            .map_err(|_| "launcher supervisor is unavailable".to_string())?;
        let Some(pid) = inner.running.get(project_id).copied() else {
            return Err("that project is not running".into());
        };
        inner.stopping.insert(pid);
        pid
    };

    emit_log(
        &app,
        project_id,
        "system",
        "stopping dev server…".to_string(),
    );
    signal_group(pid, libc::SIGTERM);

    // Escalate if the dev server ignores the polite signal.
    let supervisor_handle = supervisor.clone();
    let app_handle = app.clone();
    let project = project_id.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(5));
        let still_running = supervisor_handle
            .inner
            .lock()
            .map(|inner| inner.running.get(&project).copied() == Some(pid))
            .unwrap_or(false);
        if still_running {
            emit_log(
                &app_handle,
                &project,
                "system",
                "dev server ignored SIGTERM; sending SIGKILL".to_string(),
            );
            signal_group(pid, libc::SIGKILL);
        }
    });

    Ok(())
}
