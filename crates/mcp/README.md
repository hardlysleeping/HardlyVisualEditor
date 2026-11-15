# hardlyui-mcp

A headless [MCP](https://modelcontextprotocol.io) server over a HardlyUI
project's own persisted edits. It speaks newline-delimited JSON-RPC 2.0 on
stdio, so any MCP client can inspect and edit a project without a running app
window.

```sh
cargo run -p hardlyui-mcp -- --project /path/to/app
# or
HARDLYUI_PROJECT=/path/to/app hardlyui-mcp
```

It reads and writes exactly what the plugin writes — `.hardlyui/history.json`
and `hardlyui-overrides.css` — through the shared
`tauri-plugin-visual-editor-core` transaction types. An agent edit is therefore
an ordinary transaction: the app's undo, version checkpoints and publish flow
already cover it.

| Tool | Does |
|---|---|
| `hardlyui_status` | History size, cursor, undo/redo state, stylesheet path |
| `hardlyui_history` | Transactions newest first, marked active or undone |
| `hardlyui_inspect_element` | The declarations applied to one selector, and the transactions behind them |
| `hardlyui_apply_style` | Append one supported declaration as a saved, undoable transaction |
| `hardlyui_undo` / `hardlyui_redo` | Move the cursor and rewrite the stylesheet |

## What it deliberately cannot do

- **Selection.** What is selected exists only inside a running webview. The
  tools take a selector instead and `hardlyui_status` reports `selection: null`
  with a note, rather than inventing state.
- **Live DOM inspection.** It reports what HardlyUI has applied, not what the
  browser currently computes for an element. For that, inspect the app.
- **Anything outside the project root.** The root is canonicalised at startup
  and every write is a same-directory rename beneath it. Property names, CSS
  values and selectors are validated by the core before they reach the
  stylesheet, and a failed stylesheet write rolls the history back.

```sh
cargo test -p hardlyui-mcp
```