# HardlyUI

The Tauri plugin package is `tauri-plugin-visual-editor`.

[![Checks](https://github.com/hardlysleeping/HardlyVisualEditor/actions/workflows/checks.yml/badge.svg)](https://github.com/hardlysleeping/HardlyVisualEditor/actions/workflows/checks.yml)
[![Release](https://img.shields.io/github/v/release/hardlysleeping/HardlyVisualEditor.svg)](https://github.com/hardlysleeping/HardlyVisualEditor/releases)
[![npm](https://img.shields.io/npm/v/@iamthamanic/visual-editor-sdk.svg)](https://www.npmjs.com/package/@iamthamanic/visual-editor-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Visual Inspector plugin for **Tauri 2** — select UI elements, capture screenshots, and copy **Context Bundles** into AI editors like Cursor.

> Bridge between your running Tauri app and AI-assisted development. Not a Cursor replacement.

## Features

**Inspect and describe**

- Embedded floating toolbar (no extra window required) plus a larger inspector window
- Visual element inspection with hover + multi-select
- Native screenshots (window, webview, element crop) with a draw/text/crop editor
- Context composer with element + screenshot chips, ordered as you wrote them
- Structured **Context Bundle** export for AI editors
- Optional SDK for `data-inspector-*` metadata (recommended)
- DevTools toggle, hard reload, five-gate security model

**Edit in place**

- Size, spacing, colour, typography, borders, alignment, block/flex/grid layout, free positioning with snapping
- Property edits scoped to all screen sizes or to phone, tablet or desktop
- Structure tree: parent/child selection, move, group, remove
- Text editing and Svelte expression bindings
- Svelte source writes with a reviewed diff, byte-identical undo/redo and per-write HMR
- Named checkpoints with captured previews and a diff of what restoring would change
- Reusable elements, a project picture library, and publishing with the pictures copied into a served folder
- Device preview profiles that resize the window and restore its original geometry
- One Undo across both edit lanes, plus failures written as a title, a next step and the original text behind Details

**Around it**

- `hardlyui-launcher`: pick a project, build and run its editor build, follow the output, open the folder or browser
- `hardlyui init`: wire the plugin into a Tauri 2 project

## Quick install (host app)

### 1. Rust

0.2.x is not on crates.io — the crate published there under this name is the
0.1.x line from the original author — so depend on the tag:

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-visual-editor = { git = "https://github.com/hardlysleeping/HardlyVisualEditor", tag = "v0.2.2", features = ["visual-inspector"] }
```

Working from a checkout of this repository instead behaves the same way:

```toml
tauri-plugin-visual-editor = { path = "/path/to/HardlyVisualEditor/crates/plugin", features = ["visual-inspector"] }
```

```rust
// src-tauri/src/lib.rs
.plugin(tauri_plugin_visual_editor::init())
```

### 2. Config

```json
// src-tauri/tauri.conf.json
{
  "plugins": {
    "visualEditor": {
      "enabled": true,
      "allow": true,
      "overlayMode": "embedded",
      "autoOpen": true,
      "overlayDeferMs": 100
    }
  }
}
```

### 3. Capabilities

```json
"permissions": ["core:default", "visual-editor:all"]
```

No frontend import required — the overlay auto-injects into your webview.

### 4. Best bundle quality (recommended)

```bash
npm install @iamthamanic/visual-editor-sdk
```

```tsx
import { InspectorMeta } from '@iamthamanic/visual-editor-sdk/react';

<InspectorMeta component="SaveButton" file="src/SaveButton.tsx" id="save">
  <button>Save</button>
</InspectorMeta>
```

**Full guide:** [docs/quick-start.md](docs/quick-start.md)

## Packages

| Package | Registry | Purpose |
|---------|----------|---------|
| `tauri-plugin-visual-editor` | git tag `v0.2.2` (crates.io still carries upstream 0.1.x) | Tauri plugin (includes guest overlay) |
| `@iamthamanic/visual-editor-sdk` | [npm](https://www.npmjs.com/package/@iamthamanic/visual-editor-sdk) (0.1.0 on npm; this tree is 0.2.2) | `InspectorMeta` + metadata helpers |
| `@tauri-plugin/visual-editor-cli` | local (`packages/cli`), not published yet | `hardlyui init`: wire the plugin into a project |
| `@hardlyui/launcher` | local (`packages/launcher`) | Desktop launcher: pick a project, start its editor build, stream logs |
| `hardlyui-mcp` | local (`crates/mcp`) | Headless MCP server: inspect and edit a project's saved edits over stdio |

Hosts do **not** need `npm install @tauri-plugin/visual-editor` — guest JS ships inside the Rust crate.

## Update in consuming apps

```bash
cargo update -p tauri-plugin-visual-editor
npm update @iamthamanic/visual-editor-sdk
```

See [docs/consuming-apps.md](docs/consuming-apps.md).

## Examples

```bash
git clone https://github.com/iamthamanic/tauri-plugin-visual-editor.git
cd tauri-plugin-visual-editor
npm install
npm run checks
npm run tauri:dev --workspace=example-react-vite
```

- [examples/react-vite](examples/react-vite/) — React + Vite + SDK metadata
- [examples/vanilla](examples/vanilla/) — vanilla JS + manual `data-inspector-*` attrs

## Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.md) | Complete host setup checklist |
| [Using HardlyUI](docs/using-hardlyui.md) | The toolbar, editing, settings, checkpoints, publishing |
| [Integration Guide](docs/integration-guide.md) | Multi-webview, security, API usage |
| [Plugin API](docs/plugin-api.md) | Commands and types |
| [Context Bundle Format](docs/context-bundle-format.md) | Export structure |
| [Architecture](docs/architecture.md) | Hub, guest injection, screenshots |
| [Launcher](docs/LAUNCHER.md) | Project registry, detection, launch/stop, discovery |
| [Release](docs/RELEASE.md) | Publishing workflow |

## Development

```bash
npm run checks          # quality gate (Rust + TypeScript)
cargo test --workspace
npm run tauri:dev --workspace=example-react-vite
```

## Project structure

```
tauri-plugin-visual-editor/
├── crates/              # Rust plugin + core
├── packages/            # guest, sdk, inspector-app, launcher
├── examples/            # react-vite, vanilla
├── docs/
└── templates/           # dependabot + local patch templates for hosts
```

## License

MIT — see [LICENSE](LICENSE)
