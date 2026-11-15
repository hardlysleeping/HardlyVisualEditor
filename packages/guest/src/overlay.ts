/**
 * Thin overlay visuals — hover and numbered selection boxes.
 * Location: packages/guest/src/overlay.ts
 */

import type { ElementSnapshot } from './types.js';
import { markCaptureHideRoot } from './capture-ui.js';

const ROOT_ID = 'visual-editor-overlay-root';

export type OverlaySelection = {
  id: string;
  label: string;
  snapshot: ElementSnapshot;
};

export type OverlayGestureStart = (event: PointerEvent, selection: OverlaySelection, kind: 'move' | 'resize') => void;

function ensureRoot(): HTMLDivElement {
  let root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('data-visual-editor-overlay', 'true');
    markCaptureHideRoot(root);
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    document.documentElement.appendChild(root);
  }
  return root;
}

function boxStyle(bounds: ElementSnapshot['css_bounds'], color: string): Partial<CSSStyleDeclaration> {
  return {
    position: 'fixed',
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    border: `1px solid ${color}`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

function labelFor(snapshot: ElementSnapshot): string {
  const component = snapshot.attributes.find(([k]) => k === 'data-inspector-component')?.[1];
  return component ?? snapshot.tag;
}

export class OverlayRenderer {
  private hoverEl: HTMLDivElement | null = null;
  private hoverLabel: HTMLDivElement | null = null;
  private focusEl: HTMLDivElement | null = null;
  private focusLabel: HTMLDivElement | null = null;
  private overlayColor = '#3b82f6';
  private selectionColor = '#22c55e';
  private focusColor = '#f59e0b';
  private guideElements: HTMLDivElement[] = [];
  private zoomLabel: HTMLDivElement | null = null;

  configure(options: { overlayColor?: string }): void {
    if (options.overlayColor) {
      this.overlayColor = options.overlayColor;
    }
  }

  mount(): void {
    ensureRoot();
  }

  unmount(): void {
    document.getElementById(ROOT_ID)?.remove();
    this.hoverEl = null;
    this.hoverLabel = null;
    this.focusEl = null;
    this.focusLabel = null;
  }

  setHover(snapshot: ElementSnapshot | null): void {
    const root = ensureRoot();
    if (!snapshot) {
      this.hoverEl?.remove();
      this.hoverLabel?.remove();
      this.hoverEl = null;
      this.hoverLabel = null;
      return;
    }

    if (!this.hoverEl) {
      this.hoverEl = document.createElement('div');
      this.hoverLabel = document.createElement('div');
      Object.assign(this.hoverLabel.style, {
        position: 'fixed',
        font: '11px/1.2 system-ui, sans-serif',
        background: 'rgba(59,130,246,0.9)',
        color: '#fff',
        padding: '2px 4px',
        borderRadius: '2px',
        pointerEvents: 'none',
      });
      root.appendChild(this.hoverEl);
      root.appendChild(this.hoverLabel);
    }

    Object.assign(this.hoverEl!.style, boxStyle(snapshot.css_bounds, this.overlayColor));
    Object.assign(this.hoverLabel!.style, {
      left: `${snapshot.css_bounds.x}px`,
      top: `${Math.max(0, snapshot.css_bounds.y - 16)}px`,
    });
    this.hoverLabel!.textContent = labelFor(snapshot);
  }

  setFocus(snapshot: ElementSnapshot | null): void {
    const root = ensureRoot();
    if (!snapshot) {
      this.focusEl?.remove();
      this.focusLabel?.remove();
      this.focusEl = null;
      this.focusLabel = null;
      return;
    }

    if (!this.focusEl) {
      this.focusEl = document.createElement('div');
      this.focusLabel = document.createElement('div');
      Object.assign(this.focusLabel.style, {
        position: 'fixed',
        font: '11px/1.2 system-ui, sans-serif',
        background: 'rgba(245,158,11,0.95)',
        color: '#111',
        padding: '2px 6px',
        borderRadius: '2px',
        pointerEvents: 'none',
        fontWeight: '600',
      });
      root.appendChild(this.focusEl);
      root.appendChild(this.focusLabel);
    }

    Object.assign(this.focusEl!.style, {
      ...boxStyle(snapshot.css_bounds, this.focusColor),
      borderWidth: '2px',
      boxShadow: '0 0 0 2px rgba(245,158,11,0.35)',
    });
    Object.assign(this.focusLabel!.style, {
      left: `${snapshot.css_bounds.x}px`,
      top: `${Math.max(0, snapshot.css_bounds.y - 18)}px`,
    });
    this.focusLabel!.textContent = labelFor(snapshot);
  }

  setGuides(vertical: number | null, horizontal: number | null): void {
    this.guideElements.forEach((guide) => guide.remove());
    this.guideElements = [];
    const root = ensureRoot();
    if (vertical !== null) {
      const guide = document.createElement('div');
      guide.setAttribute('aria-hidden', 'true');
      Object.assign(guide.style, {
        position: 'fixed', left: `${vertical}px`, top: '0', bottom: '0', width: '1px',
        background: 'rgba(255,91,110,0.95)', boxShadow: '0 0 3px rgba(255,91,110,0.8)', pointerEvents: 'none',
      });
      root.appendChild(guide);
      this.guideElements.push(guide);
    }
    if (horizontal !== null) {
      const guide = document.createElement('div');
      guide.setAttribute('aria-hidden', 'true');
      Object.assign(guide.style, {
        position: 'fixed', left: '0', top: `${horizontal}px`, right: '0', height: '1px',
        background: 'rgba(255,91,110,0.95)', boxShadow: '0 0 3px rgba(255,91,110,0.8)', pointerEvents: 'none',
      });
      root.appendChild(guide);
      this.guideElements.push(guide);
    }
  }

  setZoom(zoom: number): void {
    if (zoom <= 0) {
      this.zoomLabel?.remove();
      this.zoomLabel = null;
      return;
    }
    const root = ensureRoot();
    if (!this.zoomLabel) {
      this.zoomLabel = document.createElement('div');
      Object.assign(this.zoomLabel.style, {
        position: 'fixed', right: '12px', bottom: '12px', padding: '4px 7px',
        border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
        background: 'rgba(15,18,24,0.9)', color: '#fff',
        font: '11px/1.2 system-ui,sans-serif', pointerEvents: 'none',
      });
      root.appendChild(this.zoomLabel);
    }
    this.zoomLabel.textContent = `Canvas ${Math.round(zoom * 100)}% · snap ${Math.round(8 * zoom)}px`;
  }

  renderSelections(selections: OverlaySelection[], onGestureStart?: OverlayGestureStart): void {
    const root = ensureRoot();
    root.querySelectorAll('[data-ve-selection]').forEach((el) => el.remove());

    selections.forEach((item, index) => {
      const box = document.createElement('div');
      box.setAttribute('data-ve-selection', item.id);
      const badge = document.createElement('div');
      badge.setAttribute('data-ve-selection', item.id);
      badge.textContent = `#${index + 1}`;
      Object.assign(box.style, boxStyle(item.snapshot.css_bounds, this.selectionColor));
      Object.assign(badge.style, {
        position: 'fixed',
        left: `${item.snapshot.css_bounds.x}px`,
        top: `${Math.max(0, item.snapshot.css_bounds.y - 16)}px`,
        font: '11px/1.2 system-ui, sans-serif',
        background: 'rgba(34,197,94,0.95)',
        color: '#fff',
        padding: '2px 4px',
        borderRadius: '2px',
        pointerEvents: 'none',
      });
      root.appendChild(box);
      root.appendChild(badge);

      const moveHandle = document.createElement('button');
      moveHandle.type = 'button';
      moveHandle.setAttribute('data-ve-selection', item.id);
      moveHandle.setAttribute('aria-label', selections.length > 1
        ? `Drag to move ${selections.length} selected items. Hold Shift to lock an axis.`
        : `Drag to move ${labelFor(item.snapshot)}. Hold Shift to lock an axis.`);
      moveHandle.title = selections.length > 1 ? `Drag ${selections.length} selected items · Shift locks an axis` : 'Drag to move · hold Shift to lock an axis';
      Object.assign(moveHandle.style, {
        position: 'fixed',
        left: `${Math.max(0, Math.min(window.innerWidth - 24, item.snapshot.css_bounds.x + item.snapshot.css_bounds.width - 22))}px`,
        top: `${Math.max(0, item.snapshot.css_bounds.y)}px`,
        width: '22px',
        height: '22px',
        display: 'grid',
        placeItems: 'center',
        padding: '0',
        border: `1px solid ${this.selectionColor}`,
        borderRadius: '5px',
        background: 'rgba(8,18,14,0.92)',
        color: '#fff',
        font: '14px/1 system-ui,sans-serif',
        cursor: 'move',
        pointerEvents: 'auto',
        touchAction: 'none',
      });
      moveHandle.textContent = '⠿';
      moveHandle.addEventListener('pointerdown', (event) => onGestureStart?.(event, item, 'move'));
      root.appendChild(moveHandle);

      const resizeHandle = document.createElement('button');
      resizeHandle.type = 'button';
      resizeHandle.setAttribute('data-ve-selection', item.id);
      resizeHandle.setAttribute('aria-label', selections.length > 1
        ? `Drag to resize ${selections.length} selected items`
        : `Drag to resize ${labelFor(item.snapshot)}`);
      resizeHandle.title = selections.length > 1 ? `Resize ${selections.length} selected items together` : 'Drag to resize';
      Object.assign(resizeHandle.style, {
        position: 'fixed',
        left: `${Math.max(0, Math.min(window.innerWidth - 12, item.snapshot.css_bounds.x + item.snapshot.css_bounds.width - 12))}px`,
        top: `${Math.max(0, Math.min(window.innerHeight - 12, item.snapshot.css_bounds.y + item.snapshot.css_bounds.height - 12))}px`,
        width: '12px',
        height: '12px',
        padding: '0',
        border: `2px solid ${this.selectionColor}`,
        borderRadius: '3px',
        background: '#fff',
        cursor: 'nwse-resize',
        pointerEvents: 'auto',
        touchAction: 'none',
      });
      resizeHandle.addEventListener('pointerdown', (event) => onGestureStart?.(event, item, 'resize'));
      root.appendChild(resizeHandle);
    });
  }
}
