# HardlyUI launcher

`packages/launcher` is the desktop surface for the editor: one window that lists
your Hardly projects — Tauri apps and served web apps — starts the selected
project's editor build, and streams its dev-server output. For a Tauri app it is
a shell around the plugin, not a replacement for it: editing still happens
inside the launched app's webview, because Tauri offers no way to attach an
editor to an already-running app from outside. For a served web app it starts
the server and opens the page in your browser.

## Run it

```sh
npm install
npm run launcher          # tauri dev, frontend on http://localhost:1423
npm run build:launcher    # typecheck + production frontend build
```

Building the native app requires GTK/WebKit dev packages, which this host does
not have; use a distrobox/container with `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev` and `libxdo-dev`. The browser
preview (`npm run dev --workspace=@hardlyui/launcher`) needs none of that: when
`__TAURI_INTERNALS__` is absent, the UI falls back to in-memory sample projects
so the layout can be reviewed without a Tauri shell. That preview shows a banner
saying launches are simulated — it never touches a real project.

### Install the built app

Install the launcher under its own name. `hardlyui` belongs to the setup CLI
([CLI.md](CLI.md)): installing the launcher over it means `hardlyui init` starts
a window instead of running the command.

```sh
install -m 755 "$CARGO_TARGET_DIR/release/hardlyui-launcher" \
  ~/.local/bin/hardlyui-launcher
install -m 644 packages/launcher/src-tauri/icons/128x128.png \
  ~/.local/share/icons/hicolor/128x128/apps/hardlyui.png
```

`~/.local/share/applications/hardlyui.desktop` then points `Exec` at
`~/.local/bin/hardlyui-launcher` with `Icon=hardlyui`:

```ini
[Desktop Entry]
Type=Application
Name=HardlyUI
Comment=Pick a Hardly project and start its editor build
Exec=/home/you/.local/bin/hardlyui-launcher
Icon=hardlyui
Terminal=false
Categories=Development;
Keywords=hardlyui;editor;tauri;
```

If an older build took the `hardlyui` name, move it once:

```sh
mv ~/.local/bin/hardlyui ~/.local/bin/hardlyui-launcher   # only if that file is the launcher
sed -i 's#/bin/hardlyui$#/bin/hardlyui-launcher#' \
  ~/.local/share/applications/hardlyui.desktop
```

## What it stores

`~/.config/hardlyui/projects.json` (respects `XDG_CONFIG_HOME`, or
`HARDLYUI_CONFIG_DIR`). One record per project: id, display name, absolute
path, dev command, adapter kind, readiness flags, last launch time.

The launcher only reads project folders. It never writes into them — `hardlyui
init` remains the step that wires the plugin into a project, and it is run by
you.

## Detection

Adding or scanning a folder records:

- **Tauri project** — a `src-tauri/tauri.conf.json` (or root `tauri.conf.json`)
  must exist. A served web app is also accepted (see below); anything else is
  rejected.
- **Adapter** — `svelte` when Svelte dependencies or `.svelte` sources are
  present, `css-html` when the project serves `web/` or a root `index.html`,
  otherwise `unknown`.
- **Dev command** — first match of the project's own `tauri:hardlyui`,
  `desktop:hardlyui`, `hardlyui:dev`, or `hardlyui` npm script; then a
  `tools/hardlyui` sidecar; then `npx tauri dev --features hardlyui --config
  src-tauri/tauri.hardlyui.conf.json` when the Tauri CLI is available; then the
  web-app server for a non-Tauri `server.py`; then `npm run dev`.
- **Web app** — a non-Tauri folder with `server.py`, `index.html`, or
  `web/index.html`. `server.py` runs as `python3 server.py --port 8471` when the
  script mentions `--port`, which keeps the launcher's copy off the port you
  already use by hand.
- **Readiness** — initialized (`initialized` in the plugin config or a
  `.hardlyui` directory) and dev overlay (`src-tauri/tauri.hardlyui.conf.json`).
- **Container** — a Tauri project on a host that cannot build Tauri (no
  `webkit2gtk-4.1` from `pkg-config`) gets `HARDLYUI_CONTAINER` when it is set,
  otherwise an existing `huibuild` distrobox box. The card shows a `runs in
  <name>` chip and an editable **Runs in container** row. Web apps never get
  one.

The dev command is editable per project, so a non-standard setup only needs one
correction.

### Container-backed projects

Immutable hosts (Bazzite, Silverblue) have no `gtk+-3.0`, `webkit2gtk-4.1` or
`libsoup-3.0` development packages, so a Tauri dev build cannot run there. For a
project with a container, the launcher keeps the same working directory but
wraps the command:

```sh
distrobox enter <name> -- bash -lc 'cd <project> && <dev command>'
```

`pkg-config --exists webkit2gtk-4.1` is asked once per session, `distrobox list`
once for the default box. The container name is validated as a name (letters,
digits, dot, dash, underscore; 40 characters) rather than passed through a
shell, so a bad registry entry cannot become a command. The inner script
(`cd <project> && <dev command>`) is quoted exactly once, so a project path or
command containing an apostrophe stays a single argument instead of splitting
the outer shell command. The detected box is only a starting value: after that,
the **Runs in container** row is authoritative, an empty value means "run on
this host", and a rescans do not put a cleared box back. The dev command stays
the override too: set a container-less command and it runs on the host.

## Discovery

“Scan for projects” walks these roots (depth 5, skipping dependency and build
directories) for Tauri configs: `~/apps`, `~/projects`, `~/dev`,
`~/Documents/Codex`, `~/Documents/Code`; existing roots only. Override with
`HARDLYUI_SCAN_ROOTS=/one:/two`.

## Launch and stop

Launch runs the dev command through `/bin/bash -lc` (so `nvm` and other
login-shell paths resolve) with the project as the working directory, in its own
process group. stdout/stderr stream into the log pane. Stop sends `SIGTERM` to
the whole group and `SIGKILL` after five seconds; that closes vite, cargo and the
Tauri window together instead of orphaning them.

Editing remains development-only: the launched command uses the dev overlay
config, not a production build.

## Web addresses

Every project card has a **Web address** row and an **Open ↗** button. The
address comes from one of two places: the `--port` in a detected `server.py`
command, or the first local `http://` address in the dev server's own output
(vite prints `Local: http://localhost:1420/`). The launcher emits it as an event,
so the row fills in as soon as the server prints it.

Opening is done by the OS (`open::that_detached`), so the page lands in your
default browser in a new tab. Only local addresses are accepted —
`localhost`, `127.0.0.1`, `[::1]` — because the address is read from a child
process's output and must never be able to point somewhere else.

Launching a project detected as a web app also opens the page automatically, once
the server has printed its address. A Tauri project never auto-opens its Vite
URL; that URL is only offered through the Open button.

## Current limits

- The launcher does not add source writeback. Edits still resolve through each
  app's adapter and `.hardlyui` history; source writes exist only where a host
  adapter implements them.
- It cannot enable editing in a project that has not been initialized; the
  readiness chips tell you which ones need `hardlyui init`.
- The installed binary starts and stays up, but its interactive launch path —
  spawn a project, stream its logs, open its address — has only been driven in
  the browser preview with sample data. The URL parsing and address validation
  were checked directly against the compiled functions; the full desktop round
  trip is still owed.
- Clicking inside the installed window cannot be automated on this Wayland
  session: `xdotool` finds the XWayland window, but XTEST motion and keys are
  ignored, and GNOME Shell's screenshot DBus API refuses this user. Window
  captures work (`import -window <id>`), so the rendering is verifiable while
  the click-through is not. Verifying launch, container detection and web-app
  open end to end needs a manual pass.
- The container path is covered by the compiled functions and a real
  `distrobox enter huibuild -- bash -lc 'cd <project> && pkg-config --exists
  webkit2gtk-4.1'` run; it has not been exercised through the window.
- A web app is edited in the browser, not in the launcher: the launcher only
  starts the server and opens the tab.

## Container build

This host is immutable and lacks the GTK/WebKit development packages, so native
builds run in a distrobox container (`huibuild`, Ubuntu 24.04) that mounts
`$HOME`. Keep the target directory outside the repo so container and host
artifacts never mix:

```sh
distrobox enter huibuild -- bash -lc '
  cd /path/to/hardlyui &&
  CARGO_TARGET_DIR=$HOME/.cache/hardlyui-launcher-release \
  cargo build --release -p hardlyui-launcher --features custom-protocol'
```

The release binary embeds `packages/launcher/dist`, so it runs standalone
(`--features custom-protocol` is what selects the embedded assets). Without it
the binary expects the Vite dev server on `http://localhost:1423`.