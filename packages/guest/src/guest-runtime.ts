/**
 * Guest bootstrap entry — activated by Rust eval injection on enable.
 * Location: packages/guest/src/guest-runtime.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { SelectionEngine } from './selection.js';
import { resumeCaptureUi, suspendCaptureUi } from './capture-ui.js';
import { InspectorToolbar } from './toolbar.js';
import type { ElementSnapshot } from './types.js';
import { applyStyleOperation, type EditOperation } from './editing.js';
import { installComponentDrop } from './component-drop.js';

type GuestGlobal = {
  activate(webviewId: string): void;
  deactivate(): void;
  configure(options: { overlayColor?: string; cropPadding?: number }): void;
  openToolbar(webviewId?: string): Promise<void>;
  closeToolbar(): void;
  selectElement(selector: string): Promise<void>;
  applyStyleOperation(operation: EditOperation, reverse?: boolean): boolean;
  applyPersistedOperations(operations: EditOperation[]): void;
  version: string;
};

declare global {
  interface Window {
    __VISUAL_EDITOR_GUEST__?: GuestGlobal;
  }
}

let engine: SelectionEngine | null = null;
let toolbar: InspectorToolbar | null = null;
let persistedEditObserver: MutationObserver | null = null;
let persistedEditGeneration = 0;
let removeComponentDrop: (() => void) | null = null;
// Which webview this guest lives in. The host passes it when it opens the
// toolbar, so the picker can start selection on its own instead of waiting for
// a separate activation eval that may never arrive.
let webviewId: string | null = null;

async function reportSelection(
  snapshot: ElementSnapshot,
  action: 'add' | 'replace' | 'toggle',
): Promise<void> {
  await invoke('plugin:visual-editor|report_selection', { snapshot, action });
}

async function notifyNavigation(id: string): Promise<void> {
  await invoke('plugin:visual-editor|notify_navigation', { webviewId: id });
}

/** Build the selection engine on first use, once a webview id is known. */
function ensureEngine(): SelectionEngine | null {
  if (engine) return engine;
  if (!webviewId) return null;
  removeComponentDrop?.();
  removeComponentDrop = installComponentDrop(webviewId);
  engine = new SelectionEngine({
    webviewId,
    reportSelection,
    onNavigation: (id) => {
      void notifyNavigation(id).catch(() => undefined);
    },
  });
  return engine;
}

const runtime: GuestGlobal = window.__VISUAL_EDITOR_GUEST__ ?? {
  version: '0.1.0',
  activate(id: string) {
    webviewId = id;
    ensureEngine()?.activate();
  },
  deactivate() {
    engine?.destroy();
    engine = null;
    removeComponentDrop?.();
    removeComponentDrop = null;
  },
  configure(options) {
    engine?.configure(options);
  },
  async openToolbar(id?: string) {
    if (id) webviewId = id;
    if (!toolbar) {
      toolbar = new InspectorToolbar({
        onPickerChange: (enabled) => {
          if (enabled) {
            ensureEngine()?.activate();
          } else {
            engine?.deactivate();
          }
        },
        onChipFocus: (element) => {
          engine?.highlightElement(element);
        },
      });
    }
    await toolbar.open();
  },
  closeToolbar() {
    toolbar?.close();
  },
  async selectElement(selector) {
    if (!engine) throw new Error('Enable the visual editor before navigating the element tree');
    await engine.selectElement(selector);
  },
  applyStyleOperation,
  applyPersistedOperations(operations) {
    const generation = ++persistedEditGeneration;
    let attempts = 0;
    const replay = () => {
      if (generation !== persistedEditGeneration) return;
      const pending = operations.filter((operation) => !applyStyleOperation(operation));
      if (pending.length && attempts++ < 40) {
        window.setTimeout(replay, 150);
      }
    };
    persistedEditObserver?.disconnect();
    if (document.documentElement) {
      persistedEditObserver = new MutationObserver(() => queueMicrotask(replay));
      persistedEditObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    replay();
  },
};

window.__VISUAL_EDITOR_GUEST__ = runtime;

declare global {
  interface Window {
    __VISUAL_EDITOR_SUSPEND_CAPTURE_UI__?: () => void;
    __VISUAL_EDITOR_RESUME_CAPTURE_UI__?: () => void;
  }
}

window.__VISUAL_EDITOR_SUSPEND_CAPTURE_UI__ = suspendCaptureUi;
window.__VISUAL_EDITOR_RESUME_CAPTURE_UI__ = resumeCaptureUi;

export default runtime;
