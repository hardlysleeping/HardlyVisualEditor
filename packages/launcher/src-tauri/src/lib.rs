mod detect;
mod process;
mod registry;

use process::{RunStatus, Supervisor};
use registry::{DiscoverRoot, Project, ProjectCandidate, ProjectPatch};
use tauri::State;

#[tauri::command]
fn list_projects() -> Result<Vec<Project>, String> {
    registry::list()
}

#[tauri::command]
fn add_project(path: String, name: Option<String>) -> Result<Project, String> {
    registry::add(&path, name)
}

#[tauri::command]
fn update_project(id: String, patch: ProjectPatch) -> Result<Project, String> {
    registry::update(&id, patch)
}

#[tauri::command]
fn remove_project(id: String) -> Result<(), String> {
    registry::remove(&id)
}

#[tauri::command]
fn discover_projects(roots: Option<Vec<String>>) -> Result<Vec<ProjectCandidate>, String> {
    registry::discover(roots)
}

#[tauri::command]
fn discover_roots() -> Vec<DiscoverRoot> {
    registry::discover_roots()
}

#[tauri::command]
fn launch_project(
    app: tauri::AppHandle,
    supervisor: State<'_, Supervisor>,
    id: String,
) -> Result<RunStatus, String> {
    let project = registry::get(&id)?;
    let cwd = std::path::PathBuf::from(&project.path);
    let status = process::spawn(
        app,
        supervisor.inner().clone(),
        project.id.clone(),
        cwd,
        project.dev_command.clone(),
        project.web_app,
        project.container.clone(),
    )?;
    let _ = registry::mark_opened(&project.id);
    Ok(status)
}

#[tauri::command]
fn stop_project(
    app: tauri::AppHandle,
    supervisor: State<'_, Supervisor>,
    id: String,
) -> Result<(), String> {
    process::stop(app, supervisor.inner().clone(), &id)
}

#[tauri::command]
fn running_projects(supervisor: State<'_, Supervisor>) -> Vec<RunStatus> {
    process::list(supervisor.inner())
}

#[tauri::command]
fn open_project_folder(id: String) -> Result<(), String> {
    let project = registry::get(&id)?;
    open::that_detached(&project.path)
        .map_err(|error| format!("could not open {}: {error}", project.path))
}

#[tauri::command]
fn open_project_url(id: String, url: Option<String>) -> Result<String, String> {
    let project = registry::get(&id)?;
    let target = url
        .filter(|value| !value.trim().is_empty())
        .or(project.web_url.clone())
        .ok_or_else(|| {
            "this project has no web address yet; launch it once so the launcher can read one from its output"
                .to_string()
        })?;
    let validated = registry::clean_web_url(&target)?;
    if project.web_url.as_deref() != Some(validated.as_str()) {
        let _ = registry::set_web_url(&id, &validated);
    }
    open::that_detached(&validated)
        .map_err(|error| format!("could not open {validated}: {error}"))?;
    Ok(validated)
}

pub fn run() {
    tauri::Builder::default()
        .manage(Supervisor::default())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            update_project,
            remove_project,
            discover_projects,
            discover_roots,
            launch_project,
            stop_project,
            running_projects,
            open_project_folder,
            open_project_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the HardlyUI launcher");
}
