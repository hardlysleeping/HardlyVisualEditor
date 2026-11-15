/**
 * A chip can outlive the capture it points at (the page reloaded, the capture
 * was removed elsewhere). The backend refuses the removal, and discarding that
 * left the user pressing a remove button that did nothing at all.
 *
 * One scenario per file: the runtime keeps module-level state and mounts the
 * toolbar on `document.documentElement`.
 */
import { describe, expect, it } from 'vitest';

function snapshot() {
  return {
    enabled: false,
    inspector_window_open: false,
    active_target: { webview_id: 'main', pinned: false },
    webviews: [
      { id: 'main', label: 'main', window_label: 'main', url: 'tauri://localhost', status: 'active' },
    ],
    session: {
      selected_elements: [],
      captures: [
        { id: 'cap-1', path: '/tmp/cap-1.png', capture_type: 'webview', include_in_copy: true },
      ],
      issue_text: null,
    },
    settings: { overlay_color: '#58a6ff', crop_padding: 12 },
    edit_history: { can_undo: false, can_redo: false, transactions: 0 },
  };
}

function installHost(): { calls: string[] } {
  const calls: string[] = [];
  const state = snapshot();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => undefined,
    invoke: async (cmd: string) => {
      calls.push(cmd);
      if (cmd === 'plugin:visual-editor|remove_capture') {
        throw new Error('Unknown capture: cap-1');
      }
      if (cmd === 'plugin:visual-editor|get_state' || cmd === 'plugin:visual-editor|emit_state') {
        return JSON.parse(JSON.stringify(state));
      }
      return null;
    },
  };
  return { calls };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('guest chip removal', () => {
  it('reports a refused removal instead of dropping it', async () => {
    document.body.innerHTML = '<div id="host"><h2 id="title">Library</h2></div>';
    const probe = installHost();

    await import(/* @vite-ignore */ './guest-runtime.js?case=chip-removal');
    await window.__VISUAL_EDITOR_GUEST__?.openToolbar('main');
    await flush();

    const remove = document.querySelector('[data-visual-editor-chip-remove]');
    expect(remove).not.toBeNull();
    (remove as HTMLButtonElement).click();
    await flush();

    expect(probe.calls).toContain('plugin:visual-editor|remove_capture');
    const status = document.querySelector('[data-visual-editor-status]');
    expect(status?.textContent).toContain('That item is no longer in the selection');
    expect(status?.textContent).toContain('Close and reopen the inspector');
  });
});