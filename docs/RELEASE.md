# Release process — v0.2.x

Hosts consume artifacts from this repository. Nothing here is on a registry yet:
the crates.io entries under these names belong to the upstream author and stop at
0.1.x, and the CLI and SDK packages are unpublished or behind the tree. Until
that changes, a host installs the plugin by git tag (see README) and releases
attach the desktop bundles.

## What gets published

| Artifact | Registry | Consumers |
|----------|----------|-----------|
| `tauri-plugin-visual-editor-core` | git tag (crates.io name is upstream 0.1.x) | Plugin crate (transitive) |
| `tauri-plugin-visual-editor` | git tag (crates.io name is upstream 0.1.x) | Host `Cargo.toml` (includes guest JS + inspector assets) |
| `@iamthamanic/visual-editor-sdk` | npm 0.1.0 (tree is 0.2.0) | Optional `InspectorMeta` in host frontend |
| `@tauri-plugin/visual-editor-cli` | npm (first publish pending) | `hardlyui init` in a project |
| `hardlyui-launcher` | GitHub release (deb/rpm/AppImage) | Desktop window that lists and launches projects |

Not published to npm for hosts: `@tauri-plugin/visual-editor` (guest) — embedded in the Rust crate.

## Prerequisites (one-time)

1. crates.io account + API token → GitHub secret `CARGO_REGISTRY_TOKEN`
2. npm account + token → GitHub secret `NPM_TOKEN`
3. `cargo login` / `npm login` for manual publishes

## Desktop bundles (launcher)

Hosts do not build these; they are for the person using the editor. Native
builds need the WebKit/GTK development packages, so run them in `huibuild` from
a clean `packages/launcher/dist`:

```sh
npm run build:launcher
distrobox enter huibuild -- bash -lc '
  cd packages/launcher &&
  CARGO_TARGET_DIR=$HOME/.cache/hardlyui-launcher-release \
  ../../node_modules/.bin/tauri build --features custom-protocol \
    --bundles appimage,deb,rpm'
```

Artefacts land in `$CARGO_TARGET_DIR/release/bundle/{appimage,deb,rpm}`. Attach
those to the tag's GitHub release. AppImage is the one that runs on immutable
distros such as Bazzite without layering packages; the launcher installs as
`hardlyui-launcher` and leaves the `hardlyui` name to the setup CLI.

## Release steps

### 1. Bump version (keep in sync)

All at the same version, e.g. `0.2.2`:

- `Cargo.toml` (`[workspace.package] version`)
- `crates/plugin/Cargo.toml` (the `tauri-plugin-visual-editor-core` pin)
- `crates/plugin/src/lib.rs` (the version test)
- `packages/{guest,sdk,cli,messages}/package.json`
- `packages/launcher/src-tauri/Cargo.toml` and `tauri.conf.json`
- `README.md` (the install tag), `CHANGELOG.md`

### 2. Run checks in this repo

```bash
npm run checks
```

### 3. Commit, tag, push

```bash
git add -A
git commit -m "chore: release v0.1.1"
git tag v0.1.1
git push origin main --tags
```

### 4. Tag push builds the desktop bundles

Tag push `v*` triggers [.github/workflows/release.yml](../.github/workflows/release.yml),
which installs the WebKit/GTK development packages, builds the launcher, runs
`tauri build --bundles appimage,deb,rpm` and attaches the three artefacts to the
release for that tag. It does not publish to crates.io or npm: those names are
still held by the upstream author, so registry publishing stays a manual step
for whoever owns the accounts.

Building the same bundles locally (step 3 above) and uploading them with
`gh release upload` remains the fallback when CI is unavailable.

### 5. Update host apps

```bash
cd /path/to/scriptony
cargo update -p tauri-plugin-visual-editor
npm update @iamthamanic/visual-editor-sdk   # if used
```

Or merge the Dependabot PR.

## Registry publish (blocked until the names are ours)

The commands below are the intended path; they cannot run from this machine
because the crates.io and npm names belong to the upstream author and no publish
token exists here.

```bash
npm run bundle --workspace=@tauri-plugin/visual-editor
npm run build:inspector
cargo publish -p tauri-plugin-visual-editor-core
# wait ~30s for crates.io index
cargo publish -p tauri-plugin-visual-editor --features visual-inspector
npm run build --workspace=@iamthamanic/visual-editor-sdk
npm publish --workspace=@iamthamanic/visual-editor-sdk
```

## First release (0.1.0)

First `cargo publish` for a crate name claims it on crates.io. Run manually once if CI secrets are not ready yet.
