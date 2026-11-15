/**
 * The toolbar must be able to start the picker by itself.
 *
 * Repro of the field failure: the Rust `enable` command flips the hub flag and
 * emits state, but the separate `activate` eval never reaches the page. The
 * picker button then lit up while nothing was listening for pointer events, so
 * clicking elements did nothing and no error appeared anywhere.
 *
 * One scenario per file: the runtime keeps module-level state and mounts the
 * toolbar on `document.documentElement`, so a second scenario in the same file
 * would reuse the first toolbar.
 */
import { describe, expect, it } from 'vitest';

type Probe = { calls: string[]; selections: unknown[] };

function snapshot() {
  return {
    enabled: false,
    inspector_window_open: false,
    active_target: { webview_id: 'main', pinned: false },
    webviews: [
      { id: 'main', label: 'main', window_label: 'main', url: 'tauri://localhost', status: 'active' },
    ],
    session: { selected_elements: [], captures: [], issue_text: null },
    settings: { overlay_color: '#58a6ff', crop_padding: 12 },
    edit_history: { can_undo: false, can_redo: false, transactions: 0 },
  };
}

/** Stubs the host IPC. `enable` never activates the guest on its own. */
function installInertHost(): Probe {
  const probe: Probe = { calls: [], selections: [] };
  const state = snapshot();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    invoke: async (cmd: string, args?: unknown) => {
      probe.calls.push(cmd);
      if (cmd === 'plugin:visual-editor|enable') {
        state.enabled = true;
        return null;
      }
      if (cmd === 'plugin:visual-editor|report_selection') {
        probe.selections.push(args);
        return null;
      }
      if (cmd === 'plugin:visual-editor|get_state' || cmd === 'plugin:visual-editor|emit_state') {
        return JSON.parse(JSON.stringify(state));
      }
      return null;
    },
  };
  return probe;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('guest runtime picker', () => {
  it('starts selection when no activate eval ever reached the page', async () => {
    document.body.innerHTML =
      '<div id="host"><h2 id="title">Library</h2><button id="play">Play</button></div>';
    const probe = installInertHost();

    await import(/* @vite-ignore */ './guest-runtime.js?case=inert');
    await window.__VISUAL_EDITOR_GUEST__?.openToolbar('main');
    await flush();

    const picker = document.querySelector('[data-visual-editor-picker-toggle]');
    expect(picker).not.toBeNull();
    (picker as HTMLButtonElement).click();
    await flush();

    // `enable` succeeded, so the guest must have built the engine locally.
    expect(probe.calls).toContain('plugin:visual-editor|enable');
    expect(document.querySelector('#visual-editor-overlay-root')).not.toBeNull();

    const title = document.querySelector('#title') as HTMLElement;
    // happy-dom has no layout, so the engine's hit test cannot resolve a
    // target on its own; stubbing the hit test keeps the rest of the path
    // (resolve, measure, identity, report) real.
    document.elementFromPoint = () => title;
    for (const type of ['pointermove', 'pointerdown', 'pointerup']) {
      title.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 20, clientY: 20 }));
    }
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    await flush();

    expect(probe.selections).toHaveLength(1);
    const reported = probe.selections[0] as {
      snapshot?: { webview_id?: string; tag?: string };
      action?: string;
    };
    expect(reported.snapshot?.webview_id).toBe('main');
    expect(reported.snapshot?.tag).toBe('h2');
    expect(reported.action).toBe('add');
  });
});