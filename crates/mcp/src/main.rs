//! stdio entry point: newline-delimited JSON-RPC 2.0, as MCP's stdio transport
//! specifies. Nothing is logged to stdout — a stray print would corrupt the
//! stream — so diagnostics go to stderr.

use std::io::{self, BufRead, Write};

use hardlyui_mcp::{handle, Project};

fn main() -> std::process::ExitCode {
    let mut args = std::env::args().skip(1);
    let mut root = std::env::var("HARDLYUI_PROJECT").ok();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--project" => root = args.next(),
            "--help" | "-h" => {
                eprintln!("hardlyui-mcp [--project <dir>]  (or HARDLYUI_PROJECT=<dir>)");
                return std::process::ExitCode::SUCCESS;
            }
            other => {
                eprintln!("hardlyui-mcp: unknown argument {other}");
                return std::process::ExitCode::from(2);
            }
        }
    }
    let root = root.unwrap_or_else(|| ".".to_string());
    let project = match Project::open(&root) {
        Ok(project) => project,
        Err(error) => {
            eprintln!("hardlyui-mcp: {error}");
            return std::process::ExitCode::from(2);
        }
    };
    eprintln!("hardlyui-mcp: project {}", project.root().display());

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("hardlyui-mcp: cannot read stdin: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let request: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                let reply = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": serde_json::Value::Null,
                    "error": { "code": -32700, "message": format!("parse error: {error}") }
                });
                let _ = writeln!(stdout, "{reply}");
                let _ = stdout.flush();
                continue;
            }
        };
        if let Some(reply) = handle(&project, &request) {
            if writeln!(stdout, "{reply}").is_err() {
                break;
            }
            let _ = stdout.flush();
        }
    }
    std::process::ExitCode::SUCCESS
}
