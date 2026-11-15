/**
 * The picker must arm itself when the hub already reports the editor as on.
 *
 * The other case — clicking the picker to turn the editor on — is covered in
 * guest-runtime.test.ts. This one is the reload: the state says `enabled: true`
 * before the toolbar mounts, so no click ever runs `enable`. The toolbar used to
 * paint the picker as armed while nothing listened for pointer events.
 *
 * One scenario per file: the runtime keeps module-level state and mounts the
 * toolbar on `document.documentElement`.
 */
import { describe, expect, it } from 'vitest';

type Probe = { calls: string[]; selections: unknown[] };

function snapshot() {
  return {
    enabled: true,
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

function installEnabledHost(): Probe {
  const probe: Probe = { calls: [], selections: [] };
  const state = snapshot();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    invoke: async (cmd: string, args?: unknown) => {
      probe.calls.push(cmd);
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

describe('guest runtime after a reload', () => {
  it('listens for element clicks without the picker being clicked', async () => {
    document.body.innerHTML =
      '<div id="host"><h2 id="title">Library</h2><button id="play">Play</button></div>';
    const probe = installEnabledHost();

    await import(/* @vite-ignore */ './guest-runtime.js?case=already-enabled');
    await window.__VISUAL_EDITOR_GUEST__?.openToolbar('main');
    await flush();

    // No click on the picker: the state arrived enabled and that must be enough.
    expect(probe.calls).not.toContain('plugin:visual-editor|enable');
    expect(document.querySelector('#visual-editor-overlay-root')).not.toBeNull();

    const title = document.querySelector('#title') as HTMLElement;
    // happy-dom has no layout, so the hit test cannot resolve a target alone;
    // stubbing it keeps resolve, measure, identity and report real.
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
