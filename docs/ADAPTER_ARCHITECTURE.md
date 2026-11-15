# Shared visual editor adapters

The editor shell sends normalized `EditIntent` values and consumes inspections,
capabilities, patches, validation results, and transactions from an adapter.
It never mutates source files itself. Shared contracts live in
`packages/visual-editor-core/src/index.ts`.

## Static HTML and CSS

A server-rendered app has no component model to write back to, so the static
adapter works on the canonical source file: it translates move and resize intents
into edits of the stylesheet rule that already owns the element's geometry, and
returns CSS `SourcePatch` records. Editor-generated inline styles must never
become a competing rule, so the adapter refuses to write them at all — the diff
it produces has to be reviewable as a normal CSS change.

When the running app is served by its own process, the editor loads the app's
origin directly and adds a placeholder only where the real element is missing
from the current state. A loopback sidecar serves the source adapter; writes are
limited to the geometry declarations it owns and require an explicit diff review.
The adapter checks revision hashes and keeps source undo/redo snapshots, so a
stale offset is a refusal rather than a silent overwrite.

## Svelte

The Svelte adapter owns `.svelte` AST/source mutation. It must reject ambiguous or
dynamic targets, preserve Svelte expressions and directives, and return source
patches through the same core contract. It must never pass rendered Svelte DOM
through the static HTML adapter.

Implemented as `packages/adapter-svelte-source` (`@hardlyui/adapter-svelte-source`).
It is a dev-only Vite plugin with two halves: a `transform` that stamps each
ordinary element outside an `{#each}` with `data-hardlyui-source="path:offset"`,
and a POST endpoint (`/__hardlyui/source-text`) that applies a reviewed static
text, inline style, or validated component-markup edit. Writes are pinned to a
SHA-256 revision, recompiled before they land, recorded in
`.hardlyui/source-history.json` for undo/redo, and followed by a module reload.
Foreign origins are refused, and paths outside the Vite root never resolve.

Hosts keep a generated copy rather than depending on this checkout, so a host
repo stays self-contained:

```sh
npm run vendor --workspace=@hardlyui/adapter-svelte-source -- <host>/tools/hardlyui-source-adapter.ts
```

Then add it before `svelte()` behind an opt-in flag:

```ts
plugins: [
  ...(process.env.VITE_HARDLYUI_SOURCE === "1" ? [hardlyUiSourceLocator()] : []),
  svelte(),
],
```

## Writing a new adapter

An adapter for another stack only has to implement the contracts in
`packages/visual-editor-core`: report capabilities, inspect an element, validate
an intent before touching anything, and apply it as a patch with a revision
check. Undo/redo lives in the same history, so an adapter that cannot restore a
change byte-identically should refuse the edit instead of approximating it.
