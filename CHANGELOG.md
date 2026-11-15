# Changelog

All notable changes to this project are documented here. Version numbers stay in sync across the Rust crates and `@iamthamanic/visual-editor-sdk`.

> 0.2.0 and 0.2.1 were built on a private development line before this
> repository existed. Their entries are kept for history; the first release
> published here is 0.2.2.

## [0.2.2] - 2026-11-14

### Fixed

- The element picker now starts listening as soon as the editor is already on. After a reload, or any state push that arrived before the toolbar was clicked, the button used to light up while clicks on the page did nothing until it was switched off and on again.
- The toolbar's picker, context panel and DevTools buttons expose their pressed state to screen readers and automation instead of only changing colour.

## 0.2.1 - 2026-11-14

### Fixed

- Confirming a destructive action no longer opens a raw WebKit box titled "JavaScript - tauri://localhost". Restoring a checkpoint, deleting one, pruning to the newest 20, resetting every edit and removing a picture now ask in the app's own dialog, with the consequence written out and Cancel as the safe answer. Escape, the backdrop and Cancel all decline.

## 0.2.0 - 2026-11-13

### Added

- **Visual editing.** Select an element in the running app and change it in place: size, spacing, colour, typography, borders, alignment, block/flex/grid layout, and free positioning with an optional snap grid. Property edits can be scoped to all screen sizes or to phone, tablet or desktop, written as media queries.
- **Structure editing.** A tree of the page with parent/child selection, move up/down, grouping, and remove.
- **Text editing and bindings.** Edit text nodes in place, and bind a value from a simple or dotted Svelte expression instead of freezing it.
- **Svelte source adapter.** In Svelte projects, a change is reviewed as a source diff and written into the `.svelte` file on commit, with byte-identical undo/redo and per-write HMR. Unsafe markup and unsupported values are refused before anything is written.
- **Reusable elements.** Save a styled element or group (up to 50 elements, 8 levels deep) with a name and insert it again in another screen, including a named drop slot.
- **Checkpoints and publishing.** Every change is a draft, saved as you make it. A checkpoint is a named point with a captured preview, a stylesheet diff of what restoring would change, and its own delete; a project keeps up to 100 and can be pruned to the newest 20 (published points are never pruned). Publishing turns the current draft into a protected restore point and copies the pictures it uses into a folder the built site serves.
- **Picture library.** Upload, insert, copy address, and remove project pictures, served from `/__hardlyui/media/`.
- **Device preview.** Resize the app window to named phone/tablet/laptop/desktop profiles, or restore its original size and position.
- **Launcher.** `hardlyui-launcher` lists Hardly projects, detects Tauri apps and served web apps, requires the WebKit build dependencies before a native build, starts the selected project's editor build, streams its output, and opens the folder or browser. Native builds run in a `huibuild` distrobox container.
- **Setup CLI.** `hardlyui init` wires the plugin into a Tauri 2 project: plugin dependency and registration, config with `projectRoot`, history and stylesheet files, frontend stylesheet import, and the plugin permissions.
- **Settings.** The inspector window can change overlay colour, crop padding and the screenshot folder, applied live or at the next capture.
- **Failure explanations.** Backend and adapter failures render as a short title, the next thing to try, and the original text behind a Details disclosure — in the inspector window, the SDK overlay and the injected toolbar. Refused chip removals explain themselves instead of silently doing nothing.
- **MCP surface** for inspecting and editing from an MCP client.

### Changed

- The overlay, inspector window and SDK overlay speak English throughout.
- Screenshots open in an editor with Draw, Add text, Crop, Undo/Redo (50 steps) and Cancel.
- Context bundles keep the order of the composer, chips included.
- The launcher installs as `hardlyui-launcher`; `hardlyui` stays the setup CLI.

### Fixed

- Checkpoints saved in the same millisecond were ordered by id, which sorted `-20` before `-6` and let pruning delete the newest snapshot; ordering now compares the sequence numerically.
- A chip pointing at a capture or element that no longer exists now reports "That item is no longer in the selection" instead of an unhandled rejection, and the same message no longer blames the screenshot taker.
- A failed screenshot save reports why instead of failing silently.
- The embedded toolbar is restored after a hard reload on slow hosts, including a fallback path when the activation eval never arrives.

## [0.1.2] - 2026-07-12

### Added

- Screenshot editor undo/redo: **Zurück** / **Vor** toolbar buttons and **Cmd/Ctrl+Z** (plus redo via **Cmd+Shift+Z** / **Ctrl+Y**) in guest, inspector-app, and SDK overlay

## [0.1.1] - 2026-07-10

### Fixed

- Embedded toolbar no longer disappears after Hard Reload on slow hosts: restore waits for page readiness, verifies toolbar mount, extends retry window to 15s, and falls back to `open_overlay_for_app`.

## [0.1.0] - 2026-07-10

### Added

- Tauri 2 visual inspector plugin with embedded overlay (default `overlayMode: embedded`)
- Element picker, multi-select, native screenshots, context bundle clipboard export
- Context panel with composer chips, screenshot editor, DevTools toggle
- Five-gate security model (dev-safe by default)
- Optional `@iamthamanic/visual-editor-sdk` for `data-inspector-*` metadata
- Examples: `react-vite`, `vanilla`

[0.1.2]: https://github.com/iamthamanic/tauri-plugin-visual-editor/releases/tag/v0.1.2
[0.1.1]: https://github.com/iamthamanic/tauri-plugin-visual-editor/releases/tag/v0.1.1
[0.1.0]: https://github.com/iamthamanic/tauri-plugin-visual-editor/releases/tag/v0.1.0
[0.2.2]: https://github.com/hardlysleeping/HardlyVisualEditor/releases/tag/v0.2.2
