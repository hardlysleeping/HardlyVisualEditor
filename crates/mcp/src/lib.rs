//! Headless MCP surface for a HardlyUI project.
//!
//! The plugin and the inspector need a live webview to know what is selected and
//! what an element currently computes. An agent does not: it works against the
//! project's own persisted state, which is the same `.hardlyui/history.json` and
//! `hardlyui-overrides.css` the plugin writes. Every tool here reads or appends
//! that history through the shared core types, so an agent edit is an ordinary
//! transaction that the app's undo, versions and publish flow already handle.
//!
//! Selection is deliberately absent: it only exists inside a running window.
//! Inspection takes a selector instead, and the tools say so rather than
//! pretending to know what the user last clicked.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri_plugin_visual_editor_core::editing::{
    EditHistory, ElementIdentity, StyleOperation, Transaction,
};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const SERVER_NAME: &str = "hardlyui";
const HISTORY_DIR: &str = ".hardlyui";
const HISTORY_FILE: &str = "history.json";
const OVERRIDES_FILE: &str = "hardlyui-overrides.css";
const DEFAULT_WEBVIEW_ID: &str = "mcp";
const MAX_TRANSACTIONS_LISTED: usize = 200;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// One project directory, opened once per process.
#[derive(Debug, Clone)]
pub struct Project {
    root: PathBuf,
}

impl Project {
    /// Open a project directory. The path is canonicalised so every write below
    /// is provably inside the directory the server was given.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, String> {
        let canonical = root
            .as_ref()
            .canonicalize()
            .map_err(|error| format!("cannot resolve project root: {error}"))?;
        if !canonical.is_dir() {
            return Err("project root must be a directory".into());
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn history_file(&self) -> PathBuf {
        self.root.join(HISTORY_DIR).join(HISTORY_FILE)
    }

    fn css_file(&self) -> PathBuf {
        self.root.join(OVERRIDES_FILE)
    }

    /// Load the project history, treating a missing file as an empty history.
    pub fn history(&self) -> Result<EditHistory, String> {
        let file = self.history_file();
        match fs::read(&file) {
            Ok(bytes) => {
                let history: EditHistory = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("invalid history file: {error}"))?;
                history
                    .validate()
                    .map_err(|error| format!("invalid history state: {error}"))?;
                Ok(history)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(EditHistory::default())
            }
            Err(error) => Err(format!("cannot read history file: {error}")),
        }
    }

    /// Persist history and the stylesheet it generates. Both files are written
    /// through a same-directory rename, and the history is restored if the CSS
    /// write fails, so a half-saved project cannot exist.
    pub fn save(&self, history: &EditHistory) -> Result<(), String> {
        history.validate().map_err(str::to_string)?;
        let css = history.overrides_css().map_err(str::to_string)?;
        let dir = self.root.join(HISTORY_DIR);
        fs::create_dir_all(&dir)
            .map_err(|error| format!("cannot create {HISTORY_DIR}: {error}"))?;
        let history_file = self.history_file();
        let json = serde_json::to_vec_pretty(history)
            .map_err(|error| format!("cannot encode history: {error}"))?;
        let previous = fs::read(&history_file).ok();
        atomic_write(&history_file, &json)?;
        if let Err(error) = atomic_write(&self.css_file(), css.as_bytes()) {
            match previous {
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

    pub fn css(&self) -> Result<String, String> {
        self.history()?.overrides_css().map_err(str::to_string)
    }

    pub fn status(&self) -> Result<Value, String> {
        let history = self.history()?;
        let css = history.overrides_css().map_err(str::to_string)?;
        Ok(json!({
            "project": self.root,
            "history_file": self.history_file(),
            "css_file": self.css_file(),
            "transactions": history.transactions().len(),
            "cursor": history.cursor(),
            "can_undo": history.can_undo(),
            "can_redo": history.can_redo(),
            "css_bytes": css.len(),
            "selection": Value::Null,
            "selection_note": "A live selection exists only inside the app window; use hardlyui_inspect_element with a selector.",
        }))
    }

    /// Append one style transaction and save. `before` is unknown without a live
    /// DOM, so the operation records only the intended value; undo works by the
    /// history cursor rather than by replaying the previous declaration.
    pub fn apply_style(
        &self,
        selector: &str,
        property: &str,
        value: &str,
        label: Option<&str>,
        webview_id: Option<&str>,
    ) -> Result<Value, String> {
        let identity = identity_for(selector, webview_id.unwrap_or(DEFAULT_WEBVIEW_ID))?;
        let transaction = Transaction {
            id: next_transaction_id(),
            label: label.map(str::to_string),
            operations: vec![StyleOperation::SetStyle {
                identity: identity.clone(),
                property: property.to_string(),
                before: None,
                after: Some(value.to_string()),
            }],
        };
        transaction.validate().map_err(str::to_string)?;
        let mut history = self.history()?;
        history
            .commit(transaction)
            .map_err(|error| error.to_string())?;
        self.save(&history)?;
        let css = history.overrides_css().map_err(str::to_string)?;
        let rule = rule_for_selector(&css, &identity);
        Ok(json!({
            "committed": true,
            "selector": selector,
            "property": property,
            "value": value,
            "transactions": history.transactions().len(),
            "cursor": history.cursor(),
            "rule": rule,
        }))
    }

    pub fn undo(&self) -> Result<Value, String> {
        self.transform("undo")
    }

    pub fn redo(&self) -> Result<Value, String> {
        self.transform("redo")
    }

    fn transform(&self, action: &str) -> Result<Value, String> {
        let mut history = self.history()?;
        let changed = if action == "undo" {
            history.undo().is_some()
        } else {
            history.redo().is_some()
        };
        if !changed {
            return Err(format!("nothing to {action}"));
        }
        self.save(&history)?;
        Ok(json!({
            "action": action,
            "transactions": history.transactions().len(),
            "cursor": history.cursor(),
            "css": history.overrides_css().map_err(str::to_string)?,
        }))
    }

    /// The generated declarations HardlyUI currently applies to one selector.
    pub fn inspect_element(&self, selector: &str) -> Result<Value, String> {
        let identity = identity_for(selector, DEFAULT_WEBVIEW_ID)?;
        let history = self.history()?;
        let css = history.overrides_css().map_err(str::to_string)?;
        let rule = rule_for_selector(&css, &identity);
        let touching = history
            .transactions()
            .iter()
            .take(history.cursor())
            .filter(|transaction| {
                transaction
                    .operations
                    .iter()
                    .any(|operation| match operation {
                        StyleOperation::SetStyle {
                            identity: owner, ..
                        } => owner.stable_css_selector() == identity.stable_css_selector(),
                        _ => false,
                    })
            })
            .map(|transaction| {
                json!({
                    "id": transaction.id,
                    "label": transaction.label,
                    "properties": transaction
                        .operations
                        .iter()
                        .filter_map(|operation| match operation {
                            StyleOperation::SetStyle { property, after, .. } => {
                                Some(json!({ "property": property, "value": after }))
                            }
                            _ => None,
                        })
                        .collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "selector": selector,
            "resolved_selector": css_selector(&identity),
            "applied": rule,
            "transactions": touching,
        }))
    }

    pub fn list_transactions(&self, limit: usize) -> Result<Value, String> {
        let history = self.history()?;
        let limit = limit.clamp(1, MAX_TRANSACTIONS_LISTED);
        let items = history
            .transactions()
            .iter()
            .enumerate()
            .map(|(index, transaction)| {
                json!({
                    "index": index,
                    "active": index < history.cursor(),
                    "id": transaction.id,
                    "label": transaction.label,
                    "operations": transaction.operations.len(),
                    "summary": summarize(transaction),
                })
            })
            .rev()
            .take(limit)
            .collect::<Vec<_>>();
        Ok(json!({
            "transactions": items,
            "cursor": history.cursor(),
            "total": history.transactions().len(),
        }))
    }
}

fn identity_for(selector: &str, webview_id: &str) -> Result<ElementIdentity, String> {
    let trimmed = selector.trim();
    if trimmed.is_empty() {
        return Err("selector must not be empty".into());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("selector must not contain control characters".into());
    }
    // `#id` is the friendly form; anything else is treated as a CSS selector and
    // validated by the core before it can reach the generated stylesheet.
    let identity = match trimmed.strip_prefix('#') {
        Some(id) if !id.is_empty() => ElementIdentity {
            webview_id: webview_id.to_string(),
            inspector_id: None,
            html_id: Some(id.to_string()),
            semantic_selector: None,
            generated_id: None,
        },
        _ => ElementIdentity {
            webview_id: webview_id.to_string(),
            inspector_id: None,
            html_id: None,
            semantic_selector: Some(trimmed.to_string()),
            generated_id: None,
        },
    };
    identity.validate().map_err(str::to_string)?;
    Ok(identity)
}

fn css_selector(identity: &ElementIdentity) -> Option<String> {
    identity
        .stable_css_selector()
        .map(|(attribute, value)| match attribute {
            "semantic_selector" => value.to_string(),
            _ => format!("[{attribute}=\"{value}\"]"),
        })
}

fn rule_for_selector(css: &str, identity: &ElementIdentity) -> Option<String> {
    let selector = css_selector(identity)?;
    let header = format!("\n{selector} {{");
    let start = css.find(&header)? + 1;
    let end = css[start..].find('}')? + start + 1;
    Some(css[start..end].to_string())
}

fn summarize(transaction: &Transaction) -> String {
    let mut parts = Vec::new();
    for operation in &transaction.operations {
        match operation {
            StyleOperation::SetStyle {
                identity,
                property,
                after,
                ..
            } => parts.push(format!(
                "{} {}: {}",
                css_selector(identity).unwrap_or_else(|| "?".into()),
                property,
                after.clone().unwrap_or_else(|| "(unset)".into())
            )),
            StyleOperation::SetResponsiveStyle {
                identity,
                property,
                breakpoint,
                after,
                ..
            } => parts.push(format!(
                "{} @{} {}: {}",
                css_selector(identity).unwrap_or_else(|| "?".into()),
                breakpoint,
                property,
                after.clone().unwrap_or_else(|| "(unset)".into())
            )),
            StyleOperation::SetText {
                identity, after, ..
            } => parts.push(format!(
                "{} text: {}",
                css_selector(identity).unwrap_or_else(|| "?".into()),
                after.chars().take(40).collect::<String>()
            )),
            StyleOperation::InsertElement { tag, .. } => parts.push(format!("insert <{tag}>")),
            StyleOperation::RemoveElement { .. } => parts.push("remove element".into()),
            StyleOperation::MoveElement { .. } => parts.push("move element".into()),
            StyleOperation::SetAttribute { name, .. } => parts.push(format!("set {name}")),
            StyleOperation::SetTextBinding { .. } => parts.push("bind text".into()),
        }
    }
    parts.join("; ")
}

fn next_transaction_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("mcp-{nanos}-{sequence}")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("hardlyui"),
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let mut file = fs::File::create(&temp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, path).map_err(|error| error.to_string())
}

// -- MCP protocol -----------------------------------------------------------

/// Tool catalogue, in the shape `tools/list` returns.
pub fn tools() -> Value {
    json!([
        {
            "name": "hardlyui_status",
            "description": "Report the project's edit history size, undo/redo state and generated stylesheet path.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "hardlyui_history",
            "description": "List saved edit transactions newest first, with which are still active.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 200 } },
                "additionalProperties": false
            }
        },
        {
            "name": "hardlyui_inspect_element",
            "description": "Show the CSS declarations HardlyUI applies to one element selector, and the transactions behind them.",
            "inputSchema": {
                "type": "object",
                "properties": { "selector": { "type": "string" } },
                "required": ["selector"],
                "additionalProperties": false
            }
        },
        {
            "name": "hardlyui_apply_style",
            "description": "Apply one supported CSS declaration to a selector as a saved, undoable transaction.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string" },
                    "property": { "type": "string" },
                    "value": { "type": "string" },
                    "label": { "type": "string" },
                    "webview_id": { "type": "string" }
                },
                "required": ["selector", "property", "value"],
                "additionalProperties": false
            }
        },
        {
            "name": "hardlyui_undo",
            "description": "Move the edit-history cursor back one transaction and rewrite the stylesheet.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "hardlyui_redo",
            "description": "Move the edit-history cursor forward one transaction and rewrite the stylesheet.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

/// Handle one JSON-RPC request. `None` means "no response" (notifications and
/// empty lines), which the stdio transport must honour.
pub fn handle(project: &Project, request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    // `notifications/initialized` and friends carry no id: nothing to answer.
    id.as_ref()?;
    let id = id.unwrap_or(Value::Null);
    let reply = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call_tool(project, &params),
        other => Err(format!("unknown method: {other}")),
    };
    Some(match reply {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(message) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": message }
        }),
    })
}

fn call_tool(project: &Project, params: &Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or("tools/call requires a tool name")?;
    if !tools()
        .as_array()
        .map(|tools| tools.iter().any(|tool| tool["name"] == name))
        .unwrap_or(false)
    {
        return Err(format!("unknown tool: {name}"));
    }
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
    if !arguments.is_object() {
        return Err("tool arguments must be an object".into());
    }
    // Argument mistakes are reported as tool results (`isError`), not transport
    // errors: a client can then correct the call instead of treating the server
    // as broken.
    let outcome = run_tool(project, name, &arguments);
    Ok(match outcome {
        Ok(payload) => json!({
            "content": [{ "type": "text", "text": serde_json::to_string_pretty(&payload).unwrap_or_default() }],
            "isError": false,
        }),
        Err(message) => json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        }),
    })
}

fn run_tool(project: &Project, name: &str, arguments: &Value) -> Result<Value, String> {
    let text_arg = |key: &str| {
        arguments
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("tool requires a string argument: {key}"))
    };
    match name {
        "hardlyui_status" => project.status(),
        "hardlyui_history" => {
            let limit = arguments.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            project.list_transactions(limit)
        }
        "hardlyui_inspect_element" => project.inspect_element(&text_arg("selector")?),
        "hardlyui_apply_style" => {
            let label = arguments.get("label").and_then(Value::as_str);
            let webview = arguments.get("webview_id").and_then(Value::as_str);
            project.apply_style(
                &text_arg("selector")?,
                &text_arg("property")?,
                &text_arg("value")?,
                label,
                webview,
            )
        }
        "hardlyui_undo" => project.undo(),
        "hardlyui_redo" => project.redo(),
        other => Err(format!("unknown tool: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hardlyui-mcp-{name}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn status_starts_empty() {
        let dir = scratch("status");
        let project = Project::open(&dir).unwrap();
        let status = project.status().unwrap();
        assert_eq!(status["transactions"], 0);
        assert_eq!(status["cursor"], 0);
        assert_eq!(status["can_undo"], false);
        assert!(status["selection"].is_null());
        cleanup(&dir);
    }

    #[test]
    fn apply_style_writes_history_and_stylesheet() {
        let dir = scratch("apply");
        let project = Project::open(&dir).unwrap();
        let result = project
            .apply_style(".card", "padding", "12px", Some("Card padding"), None)
            .unwrap();
        assert_eq!(result["cursor"], 1);
        assert!(result["rule"].as_str().unwrap().contains("padding: 12px;"));
        let history = project.history().unwrap();
        assert_eq!(history.transactions().len(), 1);
        assert_eq!(
            history.transactions()[0].label.as_deref(),
            Some("Card padding")
        );
        let css = fs::read_to_string(dir.join(OVERRIDES_FILE)).unwrap();
        assert!(css.contains(".card {"));
        cleanup(&dir);
    }

    #[test]
    fn undo_and_redo_move_the_cursor_and_the_css() {
        let dir = scratch("undo");
        let project = Project::open(&dir).unwrap();
        project
            .apply_style(".card", "padding", "12px", None, None)
            .unwrap();
        project.undo().unwrap();
        assert_eq!(project.history().unwrap().cursor(), 0);
        assert!(!project.css().unwrap().contains(".card"));
        project.redo().unwrap();
        assert!(project.css().unwrap().contains("padding: 12px;"));
        assert!(project.undo().is_ok());
        assert!(project.undo().is_err(), "nothing left to undo");
        cleanup(&dir);
    }

    #[test]
    fn id_selector_is_written_as_an_attribute_selector() {
        let dir = scratch("id");
        let project = Project::open(&dir).unwrap();
        let result = project
            .apply_style("#hero", "color", "red", None, None)
            .unwrap();
        assert_eq!(result["rule"], "[id=\"hero\"] {\n  color: red;\n}");
        cleanup(&dir);
    }

    #[test]
    fn unsupported_property_and_unsafe_value_are_refused() {
        let dir = scratch("refuse");
        let project = Project::open(&dir).unwrap();
        assert!(project
            .apply_style(".card", "transform", "scale(2)", None, None)
            .is_err());
        assert!(project
            .apply_style(".card", "color", "red; } body {", None, None)
            .is_err());
        assert!(project.apply_style("", "color", "red", None, None).is_err());
        assert_eq!(project.history().unwrap().transactions().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn inspect_reports_applied_declarations_and_their_transactions() {
        let dir = scratch("inspect");
        let project = Project::open(&dir).unwrap();
        project
            .apply_style(".card", "padding", "12px", Some("first"), None)
            .unwrap();
        project
            .apply_style(".card", "color", "blue", Some("second"), None)
            .unwrap();
        let inspected = project.inspect_element(".card").unwrap();
        let rule = inspected["applied"].as_str().unwrap();
        assert!(rule.contains("padding: 12px;"));
        assert!(rule.contains("color: blue;"));
        assert_eq!(inspected["transactions"].as_array().unwrap().len(), 2);
        cleanup(&dir);
    }

    #[test]
    fn protocol_answers_initialize_list_and_call() {
        let dir = scratch("protocol");
        let project = Project::open(&dir).unwrap();
        let init = handle(
            &project,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
        )
        .unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "hardlyui");

        assert!(handle(
            &project,
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .is_none());

        let list = handle(
            &project,
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        let names = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 6);
        assert!(names.contains(&"hardlyui_apply_style".to_string()));

        let call = handle(
            &project,
            &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
                "name":"hardlyui_apply_style",
                "arguments":{"selector":".card","property":"padding","value":"4px"}
            }}),
        )
        .unwrap();
        assert_eq!(call["result"]["isError"], false);
        assert!(call["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("committed"));

        let bad = handle(
            &project,
            &json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
                "name":"hardlyui_apply_style","arguments":{"selector":".card","property":"padding"}
            }}),
        )
        .unwrap();
        assert_eq!(bad["result"]["isError"], true);
        cleanup(&dir);
    }

    #[test]
    fn every_tool_has_a_schema_and_a_handler() {
        let dir = scratch("schemas");
        let project = Project::open(&dir).unwrap();
        for tool in tools().as_array().unwrap() {
            let name = tool["name"].as_str().unwrap();
            assert!(tool["description"].as_str().unwrap().len() > 10, "{name}");
            assert!(tool["inputSchema"]["type"] == "object", "{name}");
            let call = handle(
                &project,
                &json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{
                    "name": name, "arguments": {}
                }}),
            )
            .unwrap();
            assert!(
                call["result"].is_object() || call["error"].is_object(),
                "{name} produced neither a result nor an error"
            );
            assert_ne!(
                call["error"]["message"],
                "unknown tool: ".to_string() + name,
                "{name} is listed without a handler"
            );
        }
        cleanup(&dir);
    }

    #[test]
    fn a_missing_project_directory_is_refused() {
        let missing = std::env::temp_dir().join("hardlyui-mcp-does-not-exist");
        assert!(Project::open(&missing).is_err());
    }
}
