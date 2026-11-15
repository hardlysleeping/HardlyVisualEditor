# HardlyUI setup CLI

The workspace includes an initial `hardlyui init` command for Tauri 2 projects.
From this checkout:

```sh
node packages/cli/bin/hardlyui.mjs init /path/to/tauri-project
```

From an installed workspace link, you can also run:

```sh
npm run hardlyui --workspace=@tauri-plugin/visual-editor-cli -- init /path/to/tauri-project
```

Install it as a command of its own, then run `hardlyui init` from the project
directory:

```sh
# from this checkout
npm link --workspace=@tauri-plugin/visual-editor-cli

# once the package is published
npm install -g @tauri-plugin/visual-editor-cli
```

`hardlyui` is this setup CLI. The desktop window is a separate program,
`hardlyui-launcher` ([LAUNCHER.md](LAUNCHER.md)) — installing the launcher under
the name `hardlyui` shadows this command.

The command configures `plugins.visualEditor` with `projectRoot` set to the
project directory relative to the directory containing `tauri.conf.json` (for
example, `..` when the app root is the parent of `src-tauri`). The Rust plugin
resolves `.hardlyui/history.json` and `hardlyui-overrides.css` from that root.
The CLI creates those files when absent, imports the stylesheet from a common
frontend entry point, adds or updates the Rust plugin dependency and
registration when standard Tauri files are present, and enables the plugin's
default/inspect/editing permissions in a capability file.

The inspector's **Reset edits** action reverses active operations in the live
webview, clears the history cursor, and rewrites the generated stylesheet to
its empty state. It asks for confirmation before clearing project edits.

It supports JSON `tauri.conf.json` files, common frontend entry points, and the
standard `src-tauri` Rust layout. JSON5/JSONC configs and uncommon application
layouts need manual setup; the CLI reports missing standard files instead of
rewriting unfamiliar project structures. It leaves existing history and CSS
files intact. The plugin stays development-only by default through
`allowInProduction: false`.
