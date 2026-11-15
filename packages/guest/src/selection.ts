/**
 * Inspect-mode pointer handling with passthrough and multi-select.
 * Location: packages/guest/src/selection.ts
 */

import { resolveHoverTarget } from './hover.js';
import { findElementForSnapshot } from './dom-resolve.js';
import { buildDomPath } from './dom-path.js';
import { eventHitsInspectorUi, isInspectorUiElement } from './inspector-ui-guard.js';
import { invoke } from '@tauri-apps/api/core';
import { measureElement } from './measure.js';
import { watchNavigation } from './navigation-watch.js';
import { OverlayRenderer, type OverlaySelection } from './overlay.js';
import type { ElementIdentity, SetStyleOperation } from './editing.js';
import type { ElementSnapshot } from './types.js';
import type { SelectedElement } from './toolbar-types.js';

export type SelectionReporter = (
  snapshot: ElementSnapshot,
  action: 'add' | 'replace' | 'toggle',
) => Promise<void>;

export type GuestRuntimeOptions = {
  webviewId: string;
  reportSelection: SelectionReporter;
  onNavigation?: (webviewId: string) => void;
};

type CanvasGesture = {
  pointerId: number;
  kind: 'move' | 'resize';
  element: HTMLElement;
  snapshot: ElementSnapshot;
  startX: number;
  startY: number;
  bounds: DOMRect;
  beforeTranslate: string | null;
  beforeWidth: string | null;
  beforeHeight: string | null;
  baseX: number;
  baseY: number;
  baseWidth: number;
  baseHeight: number;
  entries: Array<{
    element: HTMLElement;
    snapshot: ElementSnapshot;
    beforeTranslate: string | null;
    beforeWidth: string | null;
    beforeHeight: string | null;
    baseX: number;
    baseY: number;
    baseWidth: number;
    baseHeight: number;
  }>;
  guideBounds: DOMRect;
};

function parsePixelTranslation(value: string): [number, number] | null {
  if (!value || value === 'none') return [0, 0];
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px(?:\s+(-?(?:\d+\.?\d*|\.\d+))px)?$/);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

function stableIdentity(element: HTMLElement, webviewId: string): ElementIdentity {
  const selector = buildDomPath(element);
  let hash = 2166136261;
  for (let index = 0; index < selector.length; index += 1) hash = Math.imul(hash ^ selector.charCodeAt(index), 16777619);
  return {
    webview_id: webviewId,
    inspector_id: element.getAttribute('data-inspector-id'),
    html_id: element.id || null,
    semantic_selector: selector,
    generated_id: element.getAttribute('data-hardlyui-id') ?? `hardlyui-${(hash >>> 0).toString(36)}`,
  };
}

function roundPixel(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export class SelectionEngine {
  private readonly overlay = new OverlayRenderer();
  private readonly options: GuestRuntimeOptions;
  private active = false;
  private passthrough = false;
  private hoverTarget: Element | null = null;
  private selections: OverlaySelection[] = [];
  private nextId = 1;
  private canvasGesture: CanvasGesture | null = null;
  private zoomFactor = 1;
  private originalBodyZoom = '';
  private unwatchNavigation: (() => void) | null = null;

  constructor(options: GuestRuntimeOptions) {
    this.options = options;
    this.unwatchNavigation = watchNavigation(() => this.handleNavigation());
  }

  /** Remove all overlay boxes (selection, hover, chip focus). */
  clearVisuals(): void {
    this.selections = [];
    this.hoverTarget = null;
    this.overlay.setHover(null);
    this.overlay.setFocus(null);
    this.overlay.renderSelections([]);
  }

  private handleNavigation(): void {
    this.clearVisuals();
    this.options.onNavigation?.(this.options.webviewId);
  }

  destroy(): void {
    this.unwatchNavigation?.();
    this.unwatchNavigation = null;
    this.deactivate();
    this.overlay.unmount();
  }

  configure(options: { overlayColor?: string; cropPadding?: number }): void {
    this.overlay.configure(options);
  }

  activate(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.originalBodyZoom = document.body?.style.zoom ?? '';
    this.zoomFactor = 1;
    this.overlay.mount();
    this.overlay.setZoom(this.zoomFactor);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerCancel, true);
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  deactivate(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerCancel, true);
    window.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.cancelCanvasGesture();
    if (document.body) document.body.style.zoom = this.originalBodyZoom;
    this.zoomFactor = 1;
    this.overlay.setZoom(0);
    this.clearVisuals();
  }

  highlightElement(element: SelectedElement): void {
    const hubSnapshot = element.snapshot as unknown as ElementSnapshot;
    const live = findElementForSnapshot(hubSnapshot, element.selector);
    const snapshot = live ? this.measure(live) : hubSnapshot;
    this.overlay.mount();
    this.overlay.setFocus(snapshot);
    live?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async selectElement(selector: string): Promise<void> {
    let matches: NodeListOf<Element>;
    try { matches = document.querySelectorAll(selector); }
    catch { throw new Error('The structure item no longer matches this page'); }
    if (matches.length !== 1 || !(matches[0] instanceof HTMLElement)) {
      throw new Error('The structure item is no longer unique on this page');
    }
    const target = matches[0];
    const snapshot = this.measure(target);
    await this.options.reportSelection(snapshot, 'replace');
    const selection = { id: `tree-${this.nextId++}`, label: snapshot.tag, snapshot };
    this.selections = [selection];
    this.overlay.mount();
    this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
    this.overlay.setFocus(snapshot);
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private measure(el: Element): ElementSnapshot {
    return measureElement(el, { webviewId: this.options.webviewId });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active) {
      return;
    }
    if (eventHitsInspectorUi(event)) {
      this.hoverTarget = null;
      this.overlay.setHover(null);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.canvasGesture?.pointerId === event.pointerId) {
      this.updateCanvasGesture(event);
      return;
    }
    if (!this.active || this.passthrough) {
      return;
    }
    const raw = document.elementFromPoint(event.clientX, event.clientY);
    if (isInspectorUiElement(raw)) {
      this.hoverTarget = null;
      this.overlay.setHover(null);
      return;
    }
    const target = resolveHoverTarget(raw);
    this.hoverTarget = target;
    this.overlay.setHover(target ? this.measure(target) : null);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.canvasGesture?.pointerId === event.pointerId) void this.finishCanvasGesture();
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.canvasGesture?.pointerId === event.pointerId) this.cancelCanvasGesture();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.active || !event.ctrlKey || eventHitsInspectorUi(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.zoomFactor = Math.min(2.5, Math.max(0.5, this.zoomFactor * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    if (document.body) document.body.style.zoom = String(Math.round(this.zoomFactor * 1000) / 1000);
    this.overlay.setZoom(this.zoomFactor);
    this.selections = this.selections.map((selection) => {
      const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
      return live ? { ...selection, snapshot: this.measure(live) } : selection;
    });
    this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
  };

  private readonly onOverlayGestureStart = (
    event: PointerEvent,
    selection: OverlaySelection,
    kind: 'move' | 'resize',
  ): void => {
    if (!this.active || event.button !== 0 || this.canvasGesture) return;
    const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
    if (!(live instanceof HTMLElement) || live === document.body || live === document.documentElement) return;
    const computed = getComputedStyle(live);
    if (computed.getPropertyValue('--hardlyui-locked').trim() === '1') return;
    const translation = parsePixelTranslation(computed.translate);
    if (!translation) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement) {
      try { handle.setPointerCapture(event.pointerId); } catch { /* Window listeners still receive the gesture. */ }
    }
    const bounds = live.getBoundingClientRect();
    const targets = this.selections.length > 1 ? this.selections : [selection];
    const entries = targets.flatMap((candidate) => {
      const target = findElementForSnapshot(candidate.snapshot, candidate.snapshot.dom_path);
      if (!(target instanceof HTMLElement) || target === document.body || target === document.documentElement) return [];
      const targetStyle = getComputedStyle(target);
      if (targetStyle.getPropertyValue('--hardlyui-locked').trim() === '1') return [];
      const targetTranslation = parsePixelTranslation(targetStyle.translate);
      if (!targetTranslation) return [];
      const targetBounds = target.getBoundingClientRect();
      return [{
        element: target, snapshot: candidate.snapshot,
        beforeTranslate: target.style.getPropertyValue('translate') || null,
        beforeWidth: target.style.getPropertyValue('width') || null,
        beforeHeight: target.style.getPropertyValue('height') || null,
        baseX: targetTranslation[0], baseY: targetTranslation[1],
        baseWidth: Number.parseFloat(targetStyle.width) || targetBounds.width,
        baseHeight: Number.parseFloat(targetStyle.height) || targetBounds.height,
      }];
    });
    if (!entries.some((entry) => entry.element === live)) return;
    const moving = kind === 'move' ? entries.filter((entry) =>
      !entries.some((other) => other.element !== entry.element && other.element.contains(entry.element))) : entries;
    const left = Math.min(...moving.map(({ element }) => element.getBoundingClientRect().left));
    const top = Math.min(...moving.map(({ element }) => element.getBoundingClientRect().top));
    const right = Math.max(...moving.map(({ element }) => element.getBoundingClientRect().right));
    const bottom = Math.max(...moving.map(({ element }) => element.getBoundingClientRect().bottom));
    const guideBounds = new DOMRect(left, top, right - left, bottom - top);
    this.canvasGesture = {
      pointerId: event.pointerId,
      kind,
      element: live,
      snapshot: selection.snapshot,
      startX: event.clientX,
      startY: event.clientY,
      bounds,
      beforeTranslate: live.style.getPropertyValue('translate') || null,
      beforeWidth: live.style.getPropertyValue('width') || null,
      beforeHeight: live.style.getPropertyValue('height') || null,
      baseX: translation[0],
      baseY: translation[1],
      baseWidth: Number.parseFloat(computed.width) || bounds.width,
      baseHeight: Number.parseFloat(computed.height) || bounds.height,
      entries: moving,
      guideBounds,
    };
    this.overlay.setHover(null);
  };

  private updateCanvasGesture(event: PointerEvent): void {
    const gesture = this.canvasGesture;
    if (!gesture) return;
    let dx = event.clientX - gesture.startX;
    let dy = event.clientY - gesture.startY;
    const snapScreen = (value: number) => event.altKey
      ? Math.round(value * 100) / 100
      : Math.round(value / (8 * this.zoomFactor)) * 8 * this.zoomFactor;
    const snapSize = (value: number) => event.altKey ? Math.round(value * 100) / 100 : Math.round(value / 8) * 8;
    if (gesture.kind === 'move') {
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const rawLeft = gesture.guideBounds.left + dx;
      const rawTop = gesture.guideBounds.top + dy;
      const findGuide = (axis: 'x' | 'y', proposed: number): number | null => {
        if (event.altKey) return null;
        const parent = gesture.element.parentElement;
        if (!parent) return null;
        const size = axis === 'x' ? gesture.guideBounds.width : gesture.guideBounds.height;
        const candidates: number[] = [];
        for (const sibling of Array.from(parent.children)) {
          if (gesture.entries.some(({ element }) => sibling === element || element.contains(sibling)) || !(sibling instanceof HTMLElement)) continue;
          const bounds = sibling.getBoundingClientRect();
          if (!bounds.width || !bounds.height) continue;
          const start = axis === 'x' ? bounds.left : bounds.top;
          const otherSize = axis === 'x' ? bounds.width : bounds.height;
          candidates.push(
            start,
            start + otherSize / 2 - size / 2,
            start + otherSize - size,
          );
        }
        const viewportSize = axis === 'x' ? window.innerWidth : window.innerHeight;
        candidates.push(0, (viewportSize - size) / 2, viewportSize - size);
        let closest: number | null = null;
        let distance = 6.01;
        for (const candidate of candidates) {
          const offset = Math.abs(candidate - proposed);
          if (offset < distance) { closest = candidate; distance = offset; }
        }
        return closest;
      };
      const guideX = this.selections.length ? findGuide('x', rawLeft) : null;
      const guideY = this.selections.length ? findGuide('y', rawTop) : null;
      const nextLeft = guideX ?? snapScreen(rawLeft);
      const nextTop = guideY ?? snapScreen(rawTop);
      this.overlay.setGuides(guideX === null ? null : guideX, guideY === null ? null : guideY);
      const deltaX = (nextLeft - gesture.guideBounds.left) / this.zoomFactor;
      const deltaY = (nextTop - gesture.guideBounds.top) / this.zoomFactor;
      for (const entry of gesture.entries) {
        entry.element.style.setProperty('translate', `${roundPixel(entry.baseX + deltaX)} ${roundPixel(entry.baseY + deltaY)}`);
      }
      return;
    }
    this.overlay.setGuides(null, null);
    for (const entry of gesture.entries) {
      entry.element.style.setProperty('width', roundPixel(Math.max(16, snapSize(entry.baseWidth + dx / this.zoomFactor))));
      entry.element.style.setProperty('height', roundPixel(Math.max(16, snapSize(entry.baseHeight + dy / this.zoomFactor))));
    }
  }

  private async finishCanvasGesture(): Promise<void> {
    const gesture = this.canvasGesture;
    if (!gesture) return;
    this.canvasGesture = null;
    this.overlay.setGuides(null, null);
    const operations: SetStyleOperation[] = [];
    if (gesture.kind === 'move') {
      for (const entry of gesture.entries) {
        const after = entry.element.style.getPropertyValue('translate') || null;
        if (after !== entry.beforeTranslate) operations.push({
          operation: 'set_style', identity: stableIdentity(entry.element, this.options.webviewId),
          property: 'translate', before: entry.beforeTranslate, after,
        });
      }
    } else {
      for (const entry of gesture.entries) {
        const identity = stableIdentity(entry.element, this.options.webviewId);
        const afterWidth = entry.element.style.getPropertyValue('width') || null;
        const afterHeight = entry.element.style.getPropertyValue('height') || null;
        if (afterWidth !== entry.beforeWidth) operations.push({ operation: 'set_style', identity, property: 'width', before: entry.beforeWidth, after: afterWidth });
        if (afterHeight !== entry.beforeHeight) operations.push({ operation: 'set_style', identity, property: 'height', before: entry.beforeHeight, after: afterHeight });
      }
    }
    if (operations.length) {
      const transaction = {
        id: globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: gesture.kind === 'move'
          ? (operations.length > 1 ? `Move ${gesture.entries.length} elements` : `Move ${gesture.snapshot.tag}`)
          : (gesture.entries.length > 1 ? `Resize ${gesture.entries.length} elements` : `Resize ${gesture.snapshot.tag}`),
        operations,
      };
      try {
        await invoke('plugin:visual-editor|commit_edit', { transaction });
      } catch {
        for (const entry of gesture.entries) {
          if (gesture.kind === 'move') {
            if (entry.beforeTranslate === null) entry.element.style.removeProperty('translate');
            else entry.element.style.setProperty('translate', entry.beforeTranslate);
          } else {
            if (entry.beforeWidth === null) entry.element.style.removeProperty('width');
            else entry.element.style.setProperty('width', entry.beforeWidth);
            if (entry.beforeHeight === null) entry.element.style.removeProperty('height');
            else entry.element.style.setProperty('height', entry.beforeHeight);
          }
        }
      }
    }
    this.selections = this.selections.map((selection) => {
      const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
      return live ? { ...selection, snapshot: this.measure(live) } : selection;
    });
    this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
  }

  private cancelCanvasGesture(): void {
    const gesture = this.canvasGesture;
    if (!gesture) return;
    this.canvasGesture = null;
    for (const entry of gesture.entries) {
      if (gesture.kind === 'move') {
        if (entry.beforeTranslate === null) entry.element.style.removeProperty('translate');
        else entry.element.style.setProperty('translate', entry.beforeTranslate);
      } else {
        if (entry.beforeWidth === null) entry.element.style.removeProperty('width');
        else entry.element.style.setProperty('width', entry.beforeWidth);
        if (entry.beforeHeight === null) entry.element.style.removeProperty('height');
        else entry.element.style.setProperty('height', entry.beforeHeight);
      }
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.active) {
      return;
    }
    if (eventHitsInspectorUi(event)) {
      this.hoverTarget = null;
      return;
    }
    if (this.passthrough || event.altKey) {
      return;
    }

    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = resolveHoverTarget(hit);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const snapshot = this.measure(target);
    const action = event.shiftKey ? 'toggle' : 'add';
    void this.options.reportSelection(snapshot, action).then(() => {
      const existing = this.selections.findIndex(
        (s) => s.snapshot.dom_path === snapshot.dom_path,
      );
      if (action === 'add') {
        if (existing < 0) {
          const id = `sel-${this.nextId++}`;
          this.selections.push({ id, label: id, snapshot });
        }
      } else if (existing >= 0) {
        this.selections.splice(existing, 1);
      } else {
        const id = `sel-${this.nextId++}`;
        this.selections.push({ id, label: id, snapshot });
      }
      this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) {
      return;
    }
    if (event.code === 'Space') {
      this.passthrough = true;
      this.overlay.setHover(null);
    }
    if (event.code === 'Escape') {
      this.hoverTarget = null;
      this.overlay.setHover(null);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.passthrough = false;
    }
  };
}
