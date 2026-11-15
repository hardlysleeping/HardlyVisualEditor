# @hardlyui/adapter-svelte-source

Dev-only Svelte source adapter for HardlyUI. Two halves that belong together:

1. **Coordinates.** Every ordinary element outside an `{#each}` gets
   `data-hardlyui-source="relative/path.svelte:offset"` at transform time, so a
   clicked DOM node maps back to the exact source position.
2. **Reviewed writes.** A POST endpoint (`/__hardlyui/source-text`) writes a
   reviewed edit back into the `.svelte` file: static text, one inline style
   declaration, or validated static component markup. It pins a SHA-256 revision
   between preview and write, recompiles the result before writing, keeps
   undo/redo history in `.hardlyui/source-history.json`, and reloads the module.
   Foreign origins are refused; only `tauri://localhost` and
   `http://tauri.localhost` are allowed by default.

It only exists in the dev server. Nothing here runs in a production build.

## Use it in a host

```ts
import { hardlyUiSourceLocator } from "./tools/hardlyui-source-adapter.js";

export default defineConfig({
  plugins: [
    ...(process.env.VITE_HARDLYUI_SOURCE === "1" ? [hardlyUiSourceLocator()] : []),
    svelte(),
  ],
});
```

The plugin is `enforce: "pre"`, so it must come before `svelte()`; its
coordinates are gone by the time the Svelte compiler sees the module.

Hosts keep a copy rather than depending on this checkout, so a host repo stays
self-contained:

```sh
npm run vendor --workspace=@hardlyui/adapter-svelte-source -- \
  ~/your-app/tools/hardlyui-source-adapter.ts
```

The copy carries a "generated, do not edit" header naming its source.

## Options

| Option        | Default                      | Meaning                                  |
| ------------- | ---------------------------- | ---------------------------------------- |
| `origins`     | `tauri://localhost`, `http://tauri.localhost` | WebView origins allowed to call the endpoint |
| `endpoint`    | `/__hardlyui/source-text`    | Middleware path (the inspector's default) |
| `historyFile` | `.hardlyui/source-history.json` | Undo/redo store, relative to the Vite root |

## What is refused

- Elements inside `{#each}` (one coordinate for many instances).
- Dynamic `style` attributes and `style:` directives.
- Style values containing `; { } < >`, `url(...)`, or `expression(...)`, and
  properties outside the whitelist in `src/index.ts`.
- Text targets that are not a single static text node.
- Component markup outside static `div`/`p`/`span`/`button`/`img`, unsafe image
  sources, unsupported attributes, or expressions that are not simple member
  paths. Image sources are limited to HTTPS or local app assets; reusable nodes
  may carry up to 40 whitelisted style declarations.
- Files outside the Vite root, and a write whose revision no longer matches.

## Develop

```sh
npm run build --workspace=@hardlyui/adapter-svelte-source
npm test --workspace=@hardlyui/adapter-svelte-source
```

The test starts a real Vite dev server over a temp directory and drives the
endpoint: coordinate stamping, preview-without-write, style write, stale-revision
rejection, unsafe CSS, dynamic style, text write, undo, origin and path guards.
