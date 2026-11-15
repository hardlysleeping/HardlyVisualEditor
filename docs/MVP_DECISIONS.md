# HardlyUI MVP decisions

## MVP persistence model

**Decision:** Use the existing project-scoped `.hardlyui/history.json` as the source of truth for both style and structural edit transactions. Continue generating `hardlyui-overrides.css` for style operations. Structural operations are replayed by the shared Tauri plugin after a host webview finishes loading. The plugin owns replay; host apps do not add one-off editor code.

**Why:** This gets visual add/remove working across the first Hardly apps without writing framework-specific source files or requiring a particular component kit. The generated manifest remains reviewable and undo/redo remains a transaction cursor operation. The plugin is already opt-in in development builds.

**MVP boundaries:**

- On first edit, the plugin assigns a deterministic `data-hardlyui-id` derived from the selected element's DOM path and stores both that ID and its semantic path in the transaction. This lets generated CSS address the element without requiring the app author to tag every node. The identity is as stable as the surrounding DOM structure; apps can supply `data-inspector-id` or HTML IDs for stronger identity.
- The insert palette initially supports safe built-in `div`, `p`, `span`, and `button` elements with plain text and editable styles.
- Removing an element records its serialized subtree and parent/position so it can be restored by undo and after reload.
- The plugin replays active transactions after page load and observes later child-list changes so host framework rerenders can reapply the active operations. Missing targets are retried for a short period; the MVP does not rewrite framework source files.
- Source-code writeback, arbitrary third-party component execution, and framework-specific AST transforms are outside MVP. Reusable component catalogs can emit safe markup plus styles first; framework-native components can be added through later adapters.
- Tailwind and CSS custom properties are optional token sources. Generic CSS editing must still work without them.

## MVP exit criteria

In one supported app, a user can select an existing element, change width live, insert a built-in element, remove an element, reload the app and see committed structure/styles restored, and undo/redo both kinds of edits. No external component library is required.
