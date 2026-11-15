# UI checks

Drives the real inspector overlay and the real guest toolbar in Chromium against
a stubbed plugin backend. These are the checks that catch the things unit tests
cannot: a panel that stopped rendering, a dialog that turned into the browser's
own `window.confirm`, a picker that lights up while nothing listens for clicks.

```sh
npm run test:ui              # both suites, after rebuilding the inspector app
npm run test:ui -- inspector # one suite
npm run test:ui -- guest
```

## What it needs

A Chromium binary. The runner uses `PW_EXEC` if set, otherwise the Playwright
cache (`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`). To install one:

```sh
npx playwright install chromium
```

Everything else is local: the app is served from `packages/inspector-app/dist`
and the guest runtime from `crates/plugin/guest/guest-runtime.iife.js`. Nothing
is fetched over the network.

## How it is put together

| Path | Job |
| --- | --- |
| `lib/stub.mjs` | Installs a fake `window.__TAURI_INTERNALS__` before app code runs, records every `invoke`, and returns a hub snapshot built from the options. `sampleElement()` gives a selected element so panels that need a selection render. |
| `lib/server.mjs` | Serves the built inspector app, `/host.html` (a plain page running the guest runtime) and the guest bundle. |
| `run.mjs` | Starts the server and browser, loads each spec, prints PASS/FAIL per check, exits non-zero on failure. |
| `specs/inspector.mjs` | Overlay loads, panels render, Settings writes only the fields the plugin reads, destructive actions ask in the app's own dialog, a refusal is explained with the original text kept. |
| `specs/guest.mjs` | Guest runtime mounts in a host page, picker arms from hub state, a click reports a selection, turning it off calls `disable`, closing hides the toolbar and reopening shows it again. |

The stub is deliberately shallow: it returns plausible data and lets the real
React components do the work. If a check needs more backend behaviour, add a
handler to `lib/stub.mjs` instead of special-casing the component.

## Writing a check

`check(title, ok, detail)` records one line. `detail` is only printed on failure,
so make it the number or text you would want to see when it breaks.
