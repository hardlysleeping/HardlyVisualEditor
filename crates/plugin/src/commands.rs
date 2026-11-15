//! Tauri command handlers for the visual editor plugin.

use tauri::{command, AppHandle, LogicalSize, Manager, PhysicalPosition, Runtime, State};
use tauri_plugin_visual_editor_core::{
    editing::{validate_style_operation, EditHistory, StyleOperation, Transaction},
    types::ElementSnapshot,
};

use base64::Engine as _;

use crate::config::VisualEditorConfig;
use crate::hub::{InspectorHub, PreviewWindowState};
use crate::models::{CaptureOptions, HubSnapshot, OpenOptions};
use crate::security::{gate_error, RuntimeGates};
use crate::settings::PersistentSettingsPatch;

fn require_gates(gates: &RuntimeGates) -> Result<(), String> {
    gates.check().map_err(gate_error)
}

fn emit_after<R: Runtime>(app: &AppHandle<R>, hub: &InspectorHub) {
    hub.emit_state(app);
}

fn apply_transaction<R: Runtime>(
    app: &AppHandle<R>,
    transaction: &Transaction,
    reverse: bool,
) -> Result<(), String> {
    let mut operations: Vec<&StyleOperation> = transaction.operations.iter().collect();
    if reverse {
        operations.reverse();
    }
    let mut applied: Vec<&StyleOperation> = Vec::new();
    for operation in operations {
        let webview_id = match operation {
            StyleOperation::SetStyle { identity, .. }
            | StyleOperation::SetResponsiveStyle { identity, .. }
            | StyleOperation::SetText { identity, .. }
            | StyleOperation::SetAttribute { identity, .. }
            | StyleOperation::SetTextBinding { identity, .. }
            | StyleOperation::InsertElement { identity, .. }
            | StyleOperation::RemoveElement { identity, .. }
            | StyleOperation::MoveElement { identity, .. } => &identity.webview_id,
        };
        if let Err(error) =
            crate::webview::apply_style_operation(app, webview_id, operation, reverse)
        {
            for prior in applied.into_iter().rev() {
                let prior_webview_id = match prior {
                    StyleOperation::SetStyle { identity, .. }
                    | StyleOperation::SetResponsiveStyle { identity, .. }
                    | StyleOperation::SetText { identity, .. }
                    | StyleOperation::SetAttribute { identity, .. }
                    | StyleOperation::SetTextBinding { identity, .. }
                    | StyleOperation::InsertElement { identity, .. }
                    | StyleOperation::RemoveElement { identity, .. }
                    | StyleOperation::MoveElement { identity, .. } => &identity.webview_id,
                };
                let _ =
                    crate::webview::apply_style_operation(app, prior_webview_id, prior, !reverse);
            }
            return Err(error);
        }
        applied.push(operation);
    }
    Ok(())
}

#[command]
pub fn get_state(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<HubSnapshot, String> {
    require_gates(&gates)?;
    Ok(hub.snapshot())
}

#[command]
pub fn emit_state<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.emit_state(&app);
    Ok(())
}

#[command]
pub fn enable<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    // Activate first: if a host webview refuses the injection, the hub must not
    // advertise an enabled session the guest does not know about, or the
    // toolbar's next click would toggle the other way.
    crate::webview::set_guest_active_for_app(&app, &hub, true)?;
    hub.set_enabled(true);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn disable<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    crate::webview::set_guest_active_for_app(&app, &hub, false)?;
    hub.set_enabled(false);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn open<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    options: Option<OpenOptions>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let auto_enable = options.map(|o| o.auto_enable).unwrap_or(false);
    hub.open(auto_enable);
    if auto_enable {
        crate::webview::set_guest_active_for_app(&app, &hub, true)?;
    }
    if config.uses_window_overlay() {
        crate::inspector_window::open_inspector_window(&app)?;
    } else {
        crate::webview::show_embedded_toolbar_for_app(&app, &hub)?;
    }
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn close<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    if config.uses_window_overlay() {
        crate::inspector_window::close_inspector_window(&app)?;
    } else {
        crate::webview::hide_embedded_toolbar_for_app(&app, &hub)?;
    }
    hub.close();
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn toggle<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
) -> Result<bool, String> {
    require_gates(&gates)?;
    let visible = if config.uses_window_overlay() {
        let visible = crate::inspector_window::toggle_inspector_window(&app)?;
        if visible {
            hub.open(false);
        } else {
            hub.close();
        }
        visible
    } else {
        let visible = hub.toggle_window();
        if visible {
            crate::webview::show_embedded_toolbar_for_app(&app, &hub)?;
        } else {
            crate::webview::hide_embedded_toolbar_for_app(&app, &hub)?;
        }
        visible
    };
    emit_after(&app, &hub);
    Ok(visible)
}

#[command]
pub fn clear_session<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.clear_session();
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn set_target_webview<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    webview_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.set_target_webview(&webview_id)?;
    emit_after(&app, &hub);
    Ok(())
}

/// Temporarily resize the target app window to a responsive preview viewport.
/// Passing `None` restores the original window size and position.
#[command]
pub fn set_preview_viewport<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    webview_id: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let registration = hub
        .snapshot()
        .webviews
        .into_iter()
        .find(|webview| webview.id == webview_id)
        .ok_or_else(|| format!("Unknown target webview: {webview_id}"))?;
    let window = app
        .get_webview_window(&registration.window_label)
        .ok_or_else(|| {
            format!(
                "Target app window is unavailable: {}",
                registration.window_label
            )
        })?;

    match width {
        Some(width) => {
            if !(320..=1920).contains(&width) {
                return Err("Preview width must be between 320 and 1920 CSS pixels".into());
            }
            if let Some(height) = height {
                if !(320..=1920).contains(&height) {
                    return Err("Preview height must be between 320 and 1920 CSS pixels".into());
                }
            }
            let size = window.inner_size().map_err(|error| error.to_string())?;
            let position = window.outer_position().map_err(|error| error.to_string())?;
            let scale = window.scale_factor().map_err(|error| error.to_string())?;
            let state = PreviewWindowState {
                size,
                position,
                maximized: window.is_maximized().map_err(|error| error.to_string())?,
                fullscreen: window.is_fullscreen().map_err(|error| error.to_string())?,
            };
            hub.remember_preview_window_size(&registration.window_label, state);
            if state.fullscreen {
                window
                    .set_fullscreen(false)
                    .map_err(|error| error.to_string())?;
            }
            if state.maximized {
                window.unmaximize().map_err(|error| error.to_string())?;
            }
            window
                .set_size(LogicalSize::new(
                    width as f64,
                    height.map_or(size.height as f64 / scale, f64::from),
                ))
                .map_err(|error| format!("Could not resize the target window: {error}"))?;
            window
                .set_position(PhysicalPosition::new(position.x, position.y))
                .map_err(|error| format!("Could not keep the target window in place: {error}"))?;
        }
        None => {
            if let Some(state) = hub.take_preview_window_size(&registration.window_label) {
                window.set_size(state.size).map_err(|error| {
                    format!("Could not restore the target window size: {error}")
                })?;
                window.set_position(state.position).map_err(|error| {
                    format!("Could not restore the target window position: {error}")
                })?;
                if state.maximized {
                    window.maximize().map_err(|error| error.to_string())?;
                }
                if state.fullscreen {
                    window
                        .set_fullscreen(true)
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[command]
pub fn pin_target_webview<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    webview_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.pin_target(&webview_id)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn unpin_target_webview<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.unpin_target();
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn export_context(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<String, String> {
    require_gates(&gates)?;
    let captured_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into());
    Ok(hub.export_context(&captured_at))
}

#[command]
pub async fn capture<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    options: Option<CaptureOptions>,
) -> Result<String, String> {
    require_gates(&gates)?;
    let opts = options.unwrap_or_default();
    let capture = crate::screenshot::capture_with_timeout(app.clone(), &hub, opts).await?;
    let path = capture.path.clone();
    hub.record_capture(capture);
    hub.emit_state(&app);
    Ok(path)
}

#[command]
pub fn revalidate<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
) -> Result<usize, String> {
    require_gates(&gates)?;
    let updated = hub.revalidate();
    emit_after(&app, &hub);
    Ok(updated)
}

#[command]
pub fn notify_navigation<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    webview_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.mark_selections_stale_for_webview(&webview_id);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn report_selection<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    snapshot: ElementSnapshot,
    action: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.report_selection(snapshot, &action)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn select_element<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    webview_id: String,
    selector: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    if selector.is_empty() || selector.len() > 4096 || selector.chars().any(char::is_control) {
        return Err("Element selector is invalid".into());
    }
    let webview = app
        .get_webview_window(&webview_id)
        .ok_or_else(|| format!("Unknown target webview: {webview_id}"))?;
    crate::webview::bootstrap_guest(webview.as_ref())?;
    let selector = serde_json::to_string(&selector).map_err(|error| error.to_string())?;
    webview
        .eval(format!(
            "window.__VISUAL_EDITOR_GUEST__?.selectElement({selector});"
        ))
        .map_err(|error| format!("Could not select the structure item: {error}"))
}

#[command]
pub fn copy_context_bundle(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    full: Option<bool>,
    blocks: Option<Vec<tauri_plugin_visual_editor_core::types::ComposerBlock>>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let captured_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into());

    if full.unwrap_or(false) {
        let bundle = hub.export_context(&captured_at);
        return crate::clipboard::write_text(&bundle);
    }

    let composer = match blocks {
        Some(ref ordered) if !ordered.is_empty() => hub.export_composer_ordered(ordered),
        _ => hub.export_composer(),
    };
    if composer.trim().is_empty() {
        return Err("Nichts zu kopieren — Elemente, Screenshot oder Text hinzufügen".into());
    }

    let image_path = hub.primary_capture_path().map(std::path::PathBuf::from);
    crate::clipboard::write_composer(&composer, image_path.as_deref().filter(|p| p.exists()))
}

#[command]
pub fn copy_screenshot_image(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: Option<String>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let path = match capture_id {
        Some(id) => hub
            .capture_path(&id)
            .ok_or_else(|| format!("Unknown capture: {id}"))?,
        None => hub
            .primary_capture_path()
            .ok_or_else(|| "No primary screenshot in session".to_string())?,
    };
    crate::clipboard::write_png_file(std::path::Path::new(&path))
}

#[command]
pub fn copy_screenshot_path(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: Option<String>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let path = match capture_id {
        Some(id) => hub
            .capture_path(&id)
            .ok_or_else(|| format!("Unknown capture: {id}"))?,
        None => hub
            .primary_capture_path()
            .ok_or_else(|| "No primary screenshot in session".to_string())?,
    };
    crate::clipboard::write_path(std::path::Path::new(&path))
}

#[command]
pub fn open_screenshot_folder<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    config: State<'_, VisualEditorConfig>,
) -> Result<(), String> {
    require_gates(&gates)?;
    crate::paths::open_screenshots_folder(&app, &hub.settings(), &config)
}

#[command]
pub fn hard_reload<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    config: State<'_, VisualEditorConfig>,
    webview_id: Option<String>,
    clear_cache: Option<bool>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let target = webview_id.unwrap_or_else(|| {
        hub.snapshot()
            .active_target
            .map(|t| t.webview_id)
            .unwrap_or_else(|| "main".into())
    });
    crate::reload::hard_reload(&app, &hub, &config, &target, clear_cache.unwrap_or(true))
}

#[command]
pub fn toggle_devtools<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    webview_id: Option<String>,
) -> Result<bool, String> {
    require_gates(&gates)?;
    let target = webview_id.unwrap_or_else(|| {
        hub.snapshot()
            .active_target
            .map(|t| t.webview_id)
            .unwrap_or_else(|| "main".into())
    });
    crate::reload::toggle_devtools(&app, &target)
}

#[command]
pub fn set_issue_text<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    text: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.set_issue_text(Some(text));
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn remove_element<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    element_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.remove_element(&element_id)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn remove_capture<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.remove_capture(&capture_id)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn set_primary_capture<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.set_primary_capture(&capture_id)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn set_capture_included<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: String,
    include: bool,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.set_capture_included(&capture_id, include)?;
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn save_capture_image(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: String,
    png_bytes: Vec<u8>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let path = hub
        .capture_path(&capture_id)
        .ok_or_else(|| format!("Unknown capture: {capture_id}"))?;
    std::fs::write(&path, &png_bytes).map_err(|e| format!("Failed to save capture: {e}"))?;
    Ok(())
}

#[command]
pub fn read_capture_image(
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    capture_id: String,
) -> Result<Vec<u8>, String> {
    require_gates(&gates)?;
    let path = hub
        .capture_path(&capture_id)
        .ok_or_else(|| format!("Unknown capture: {capture_id}"))?;
    std::fs::read(&path).map_err(|e| format!("Failed to read capture: {e}"))
}

#[command]
pub fn update_settings<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    hub: State<'_, InspectorHub>,
    patch: PersistentSettingsPatch,
) -> Result<(), String> {
    require_gates(&gates)?;
    hub.update_settings(&patch)?;
    crate::settings::save_settings(&app, &hub.settings())?;
    if hub.is_enabled() {
        crate::webview::apply_guest_settings_for_app(&app, &hub)?;
    }
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn preview_style<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    operation: StyleOperation,
) -> Result<(), String> {
    require_gates(&gates)?;
    validate_style_operation(&operation).map_err(str::to_string)?;
    let webview_id = match &operation {
        StyleOperation::SetStyle { identity, .. }
        | StyleOperation::SetResponsiveStyle { identity, .. }
        | StyleOperation::SetText { identity, .. }
        | StyleOperation::SetAttribute { identity, .. }
        | StyleOperation::SetTextBinding { identity, .. }
        | StyleOperation::InsertElement { identity, .. }
        | StyleOperation::RemoveElement { identity, .. }
        | StyleOperation::MoveElement { identity, .. } => &identity.webview_id,
    };
    crate::webview::apply_style_operation(&app, webview_id, &operation, false)
}

#[command]
pub fn commit_edit<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    transaction: Transaction,
) -> Result<(), String> {
    require_gates(&gates)?;
    transaction.validate().map_err(str::to_string)?;

    let mut next = hub.edit_history();
    next.commit(transaction.clone()).map_err(str::to_string)?;
    apply_transaction(&app, &transaction, false)?;
    if let Err(error) = crate::editing_storage::save_edit_history(&config, &next) {
        let _ = apply_transaction(&app, &transaction, true);
        return Err(error);
    }
    hub.set_edit_history(next);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn undo_edit<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
) -> Result<bool, String> {
    require_gates(&gates)?;
    let mut next = hub.edit_history();
    let Some(transaction) = next.undo().cloned() else {
        return Ok(false);
    };
    apply_transaction(&app, &transaction, true)?;
    if let Err(error) = crate::editing_storage::save_edit_history(&config, &next) {
        let _ = apply_transaction(&app, &transaction, false);
        return Err(error);
    }
    hub.set_edit_history(next);
    emit_after(&app, &hub);
    Ok(true)
}

#[command]
pub fn redo_edit<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
) -> Result<bool, String> {
    require_gates(&gates)?;
    let mut next = hub.edit_history();
    let Some(transaction) = next.redo().cloned() else {
        return Ok(false);
    };
    apply_transaction(&app, &transaction, false)?;
    if let Err(error) = crate::editing_storage::save_edit_history(&config, &next) {
        let _ = apply_transaction(&app, &transaction, true);
        return Err(error);
    }
    hub.set_edit_history(next);
    emit_after(&app, &hub);
    Ok(true)
}

#[command]
pub fn reset_edits<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
) -> Result<(), String> {
    require_gates(&gates)?;
    let mut pending = hub.edit_history();
    let mut reverted = Vec::new();
    while let Some(transaction) = pending.undo().cloned() {
        if let Err(error) = apply_transaction(&app, &transaction, true) {
            for prior in reverted.iter().rev() {
                let _ = apply_transaction(&app, prior, false);
            }
            return Err(error);
        }
        reverted.push(transaction);
    }

    let empty = EditHistory::default();
    if let Err(error) = crate::editing_storage::save_edit_history(&config, &empty) {
        for transaction in reverted.iter().rev() {
            let _ = apply_transaction(&app, transaction, false);
        }
        return Err(error);
    }
    hub.set_edit_history(empty);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn get_component_library(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
) -> Result<serde_json::Value, String> {
    require_gates(&gates)?;
    crate::editing_storage::load_components(&config)
}

#[command]
pub fn save_component_library(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    components: serde_json::Value,
) -> Result<(), String> {
    require_gates(&gates)?;
    crate::editing_storage::save_components(&config, &components)
}

#[command]
pub async fn save_version<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    label: String,
) -> Result<crate::editing_storage::VersionSummary, String> {
    require_gates(&gates)?;
    let mut summary = crate::editing_storage::save_version(&config, &hub.edit_history(), &label)?;
    // The picture is best-effort: a host that cannot be captured still keeps
    // its checkpoint.
    if let Ok(bytes) = crate::screenshot::capture_version_thumbnail(app, hub.inner()).await {
        summary.has_preview =
            crate::editing_storage::write_version_preview(&config, &summary.id, &bytes).is_ok();
    }
    Ok(summary)
}

#[command]
pub fn read_version_preview(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    version_id: String,
) -> Result<Vec<u8>, String> {
    require_gates(&gates)?;
    crate::editing_storage::read_version_preview(&config, &version_id)
}

#[command]
pub fn save_media(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    name: String,
    data_base64: String,
) -> Result<crate::media::MediaItem, String> {
    require_gates(&gates)?;
    if data_base64.len() > crate::media::MAX_MEDIA_BYTES * 2 {
        return Err("that file is larger than the media limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|_| "the uploaded file was not readable".to_string())?;
    crate::media::save_media(&config, &name, &bytes)
}

#[command]
pub fn list_media(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
) -> Result<Vec<crate::media::MediaItem>, String> {
    require_gates(&gates)?;
    crate::media::list_media(&config)
}

#[command]
pub fn read_media(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    name: String,
) -> Result<String, String> {
    require_gates(&gates)?;
    crate::media::read_media(&config, &name)
}

#[command]
pub fn delete_media(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    name: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    crate::media::delete_media(&config, &name)
}

#[command]
pub fn list_versions(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
) -> Result<Vec<crate::editing_storage::VersionSummary>, String> {
    require_gates(&gates)?;
    crate::editing_storage::list_versions(&config)
}

#[command]
pub fn restore_version<R: Runtime>(
    app: AppHandle<R>,
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    version_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    let desired = crate::editing_storage::load_version(&config, &version_id)?;
    let current = hub.edit_history();
    crate::editing_storage::save_version(&config, &current, "Before restore")?;

    let mut reverting = current.clone();
    let mut reverted = Vec::new();
    while let Some(transaction) = reverting.undo().cloned() {
        if let Err(error) = apply_transaction(&app, &transaction, true) {
            for prior in reverted.iter().rev() {
                let _ = apply_transaction(&app, prior, false);
            }
            return Err(error);
        }
        reverted.push(transaction);
    }

    let mut applied = Vec::new();
    for transaction in &desired.transactions()[..desired.cursor()] {
        if let Err(error) = apply_transaction(&app, transaction, false) {
            for prior in applied.iter().rev() {
                let _ = apply_transaction(&app, prior, true);
            }
            for prior in reverted.iter().rev() {
                let _ = apply_transaction(&app, prior, false);
            }
            return Err(error);
        }
        applied.push(transaction.clone());
    }

    if let Err(error) = crate::editing_storage::save_edit_history(&config, &desired) {
        for prior in applied.iter().rev() {
            let _ = apply_transaction(&app, prior, true);
        }
        for prior in reverted.iter().rev() {
            let _ = apply_transaction(&app, prior, false);
        }
        return Err(error);
    }
    hub.set_edit_history(desired);
    emit_after(&app, &hub);
    Ok(())
}

#[command]
pub fn delete_version(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    version_id: String,
) -> Result<(), String> {
    require_gates(&gates)?;
    crate::editing_storage::delete_version(&config, &version_id)
}

#[command]
pub fn prune_versions(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    keep: usize,
) -> Result<Vec<String>, String> {
    require_gates(&gates)?;
    crate::editing_storage::prune_versions(&config, keep)
}

#[command]
pub fn compare_version(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    version_id: String,
) -> Result<crate::editing_storage::VersionComparison, String> {
    require_gates(&gates)?;
    crate::editing_storage::compare_version(&config, &hub.edit_history(), &version_id)
}

#[command]
pub fn publish_project(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
    hub: State<'_, InspectorHub>,
    label: String,
) -> Result<crate::publish::PublishResult, String> {
    require_gates(&gates)?;
    crate::publish::publish(&config, &hub.edit_history(), &label)
}

#[command]
pub fn list_published(
    gates: State<'_, RuntimeGates>,
    config: State<'_, VisualEditorConfig>,
) -> Result<Vec<crate::editing_storage::PublishedEntry>, String> {
    require_gates(&gates)?;
    crate::editing_storage::list_published(&config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VisualEditorConfig;
    use crate::security::Gate;

    #[test]
    fn require_gates_surfaces_dev_mode_error() {
        let gates = RuntimeGates::new(
            VisualEditorConfig {
                enabled: true,
                allow: true,
                allow_in_production: false,
                auto_open: true,
                overlay_defer_ms: 100,
                overlay_mode: crate::config::OverlayMode::default(),
                project_root: None,
            },
            false,
        );
        let err = require_gates(&gates).unwrap_err();
        assert!(err.contains("allowInProduction"));
    }

    #[test]
    fn log_capability_denial_does_not_panic() {
        crate::security::log_capability_denial("enable", "missing visual-editor:inspect");
        assert_eq!(
            Gate::DevMode,
            RuntimeGates::new(
                VisualEditorConfig {
                    enabled: true,
                    allow: true,
                    allow_in_production: false,
                    auto_open: true,
                    overlay_defer_ms: 100,
                    overlay_mode: crate::config::OverlayMode::default(),
                    project_root: None,
                },
                false,
            )
            .check()
            .unwrap_err()
            .gate
        );
    }
}
