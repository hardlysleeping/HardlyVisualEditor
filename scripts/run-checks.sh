#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm: generated message copies are current"
npm run check:messages --if-present

echo "==> npm: bundle guest runtime"
npm run bundle --workspace=@tauri-plugin/visual-editor --if-present

echo "==> npm: build inspector assets"
npm run build:inspector --if-present

echo "==> npm: build SDK (types for examples)"
npm run build --workspace=@iamthamanic/visual-editor-sdk --if-present

echo "==> Rust: fmt check"
cargo fmt --all -- --check

echo "==> Rust: clippy"
cargo clippy -p tauri-plugin-visual-editor --features visual-inspector -- -D warnings

echo "==> Rust: test"
cargo test -p tauri-plugin-visual-editor-core
cargo test -p tauri-plugin-visual-editor --features visual-inspector

echo "==> npm: typecheck"
npm run typecheck --workspaces --if-present

echo "==> npm: test"
npm run test --workspace=@tauri-plugin/visual-editor --if-present
npm run test --workspace=@iamthamanic/visual-editor-sdk --if-present
npm run test --workspace=@hardlyui/adapter-svelte-source --if-present

# Drives the real overlay and guest toolbar in Chromium. Needs a browser, which
# this container does not carry, so it is skipped unless one is available.
if [ -n "${PW_EXEC:-}" ] || compgen -G "$HOME/.cache/ms-playwright/*/chrome-linux64/chrome" >/dev/null; then
  echo "==> npm: UI checks (Chromium)"
  npm run test:ui
else
  echo "==> npm: UI checks skipped (no Chromium; run npx playwright install chromium or set PW_EXEC)"
fi

echo "==> All checks passed (or skipped pending scaffold)"
