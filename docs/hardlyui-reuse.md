# HardlyUI foundation and upstream reuse

HardlyUI extends `tauri-plugin-visual-editor` into a development-only visual
editor. The upstream repository remains the base; its inspection path should
stay intact unless a concrete editing requirement needs an extension.

## Reuse unchanged

- Tauri 2 plugin registration, feature flags, ACL permissions, and runtime
  security gates in `crates/plugin`.
- Guest bootstrap, injected runtime packaging, and webview lifecycle hooks.
- Hover targeting, pointer selection, multi-select, and selection overlays in
  `packages/guest`.
- DOM measurement and the `data-inspector-*` metadata convention.
- Rust selector and metadata resolution in `crates/core`.
- Inspector hub as the source of truth for registered webviews and selection
  state.
- Existing vanilla and React/Vite examples as integration fixtures.

## Extend for editing

- Add a shared transaction model to `crates/core`; every manual or agent edit
  must enter through that model.
- Add edit-mode controls and a compact inspector without replacing the picker
  or its selection identity.
- Apply changes to the selected live DOM element, then serialize committed
  values into a project override stylesheet.
- Keep persistent history and version snapshots separate from the upstream
  inspector's ephemeral selection session.
- Gate source-writing commands behind the existing development security model
  and an explicit project-root allowlist.

## First vertical slice

The first implementation should prove one width edit end to end: select with
the existing picker, commit a width transaction, update the live element,
serialize `hardlyui-overrides.css`, reload, then undo and redo through the same
transaction history. Inspector panel breadth and additional CSS properties
come after this slice works.

## Upstream attribution

The upstream MIT license and copyright notice are retained in `LICENSE`.
HardlyUI-specific work should be documented separately from reused upstream
behavior so later upgrades remain reviewable.
