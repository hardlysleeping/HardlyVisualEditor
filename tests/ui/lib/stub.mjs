/**
 * Fake Tauri IPC for the UI tests.
 *
 * The inspector window and the guest toolbar talk to the Rust plugin through
 * `window.__TAURI_INTERNALS__.invoke`. The tests need the real UI with a known
 * backend, so this script installs a stub before any app code runs and records
 * every call for assertions.
 *
 * Usage: `page.addInitScript(stubSource(options))`.
 */

/**
 * A selected element shaped like the one the guest runtime reports for the
 * `#card` block of the test host page. Panels that only render with a selection
 * — the structure tree, the style controls — need one.
 */
export function sampleElement(overrides = {}) {
  return {
    id: 'el-1',
    selector: '#card',
    component: null,
    file: null,
    inspector_id: null,
    entity: null,
    status: 'valid',
    linked_capture_id: null,
    snapshot: {
      webview_id: 'main',
      tag: 'div',
      text: 'Pick this paragraph to test selection.',
      editable_text: null,
      text_nodes: ['Pick this paragraph to test selection.'],
      attributes: [
        ['class', 'card'],
        ['id', 'card'],
      ],
      dom_path: 'html > body > div:nth-of-type(1)',
      outer_html:
        '<div class="card" id="card"><p id="copy">Pick this paragraph to test selection.</p><button id="save" type="button">Save</button></div>',
      reusable_html:
        '<div class="card" id="card"><p id="copy">Pick this paragraph to test selection.</p></div>',
      parent_dom_path: 'html > body',
      parent_child_index: 1,
      visibility: 'visible',
      css_bounds: { x: 24, y: 96, width: 420, height: 120 },
      physical_bounds: { x: 24, y: 96, width: 420, height: 120 },
      visible_bounds: { x: 24, y: 96, width: 420, height: 120 },
      full_bounds: { x: 24, y: 96, width: 420, height: 120 },
      computed_layout: [
        ['display', 'block'],
        ['padding', '16px'],
        ['margin-top', '16px'],
        ['border-top-width', '1px'],
        ['border-radius', '8px'],
      ],
      css_variables: [],
      layout_children: [],
    },
    ...overrides,
  };
}

/**
 * @param {object} [options]
 * @param {Array} [options.elements] selected elements; `[]` is an empty selection
 * @param {Array} [options.transactions] edits the window believes exist
 * @param {Array} [options.versions] checkpoints
 * @param {Array} [options.media] pictures
 * @param {Record<string, string>} [options.fail] command → error text it throws
 */
export function stubSource(options = {}) {
  const config = {
    elements: options.elements ?? [],
    transactions: options.transactions ?? [],
    versions: options.versions ?? [],
    media: options.media ?? [],
    fail: options.fail ?? {},
  };

  return `(() => {
    const config = ${JSON.stringify(config)};
    const calls = [];
    const settings = {
      theme: 'system',
      shortcut: 'CommandOrControl+Shift+I',
      overlay_color: '#22d3ee',
      crop_padding: 16,
      screenshot_dir: 'appData',
      screenshot_absolute_path: null,
    };
    let sequence = 0;

    const snapshot = () => ({
      enabled: true,
      inspector_window_open: true,
      session: {
        selected_elements: config.elements,
        captures: [],
        primary_capture_id: null,
        issue_text: null,
      },
      webviews: [
        { id: 'main', label: 'main', window_label: 'main', url: 'http://127.0.0.1/host.html', status: 'active' },
      ],
      active_target: { webview_id: 'main', pinned: false },
      settings: { ...settings },
      edit_history: { transactions: config.transactions, cursor: config.transactions.length },
    });

    const handlers = {
      'plugin:visual-editor|get_state': () => snapshot(),
      'plugin:visual-editor|list_versions': () => config.versions,
      'plugin:visual-editor|list_published': () => [],
      'plugin:visual-editor|list_media': () => config.media,
      'plugin:visual-editor|get_component_library': () => [],
      'plugin:visual-editor|revalidate': () => 0,
      'plugin:visual-editor|update_settings': (args) => {
        Object.assign(settings, args ?? {});
        return null;
      },
      'plugin:event|listen': () => 1,
      'plugin:event|unlisten': () => null,
    };

    window.__TEST__ = { calls, config, settings, snapshot };
    window.__TEST__.resetCalls = () => { calls.length = 0; };
    window.__TEST__.callsTo = (name) => calls.filter((call) => call.cmd === name);

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'visual-editor' },
        currentWebview: { label: 'visual-editor' },
      },
      transformCallback(callback) {
        const id = ++sequence;
        window['_' + id] = callback;
        return id;
      },
      unregisterCallback(id) {
        delete window['_' + id];
      },
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        const failure = config.fail[cmd];
        if (failure) throw new Error(failure);
        const handler = handlers[cmd];
        return handler ? handler(args) : null;
      },
    };
  })();`;
}
