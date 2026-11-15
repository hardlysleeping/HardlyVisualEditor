/**
 * DOM measurement: bounds, visibility, curated computedStyle, attributes.
 * Location: packages/guest/src/measure.ts
 */

import {
  CURATED_CSS_PROPERTIES,
  MAX_CSS_PROPERTIES,
  OFF_VIEWPORT_CAPTURE_ERROR,
} from './constants.js';
import { buildDomPath } from './dom-path.js';
import type { Bounds, ElementSnapshot, Visibility } from './types.js';
import { ownTextNodes } from './text-nodes.js';

export { OFF_VIEWPORT_CAPTURE_ERROR };

export type MeasureContext = {
  webviewId: string;
  devicePixelRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
};

const REUSABLE_LAYOUT_PROPERTIES = [
  'display', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'order', 'align-items', 'align-self', 'justify-content', 'gap',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'border-radius', 'border-width', 'border-color', 'translate',
] as const;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rectToBounds(rect: DOMRect): Bounds {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function reusableMarkup(element: Element): string | undefined {
  const raw = element.outerHTML;
  if (raw.length > 100_000) return undefined;
  const sources = [element, ...Array.from(element.querySelectorAll('*'))];
  if (sources.length > 50) return raw;
  for (const source of sources) {
    let depth = 0;
    for (let parent = source.parentElement; parent && parent !== element; parent = parent.parentElement) depth += 1;
    if (depth > 8) return raw;
  }
  const clone = element.cloneNode(true) as Element;
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  sources.forEach((source, index) => {
    const target = copies[index];
    if (!(target instanceof HTMLElement)) return;
    const computed = globalThis.getComputedStyle(source);
    for (const property of REUSABLE_LAYOUT_PROPERTIES) {
      const value = computed.getPropertyValue(property).trim();
      if (value && !['auto', 'normal', 'none'].includes(value)) target.style.setProperty(property, value);
    }
  });
  const markup = clone.outerHTML;
  return markup.length <= 100_000 ? markup : raw;
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1) };
}

export function resolveViewport(ctx: MeasureContext): Bounds {
  const width = ctx.viewportWidth ?? globalThis.innerWidth ?? 0;
  const height = ctx.viewportHeight ?? globalThis.innerHeight ?? 0;
  return { x: 0, y: 0, width, height };
}

export function computeVisibility(
  cssBounds: Bounds,
  viewport: Bounds,
): { visibility: Visibility; visibleBounds: Bounds | null; fullBounds: Bounds | null } {
  if (cssBounds.width <= 0 || cssBounds.height <= 0) {
    return {
      visibility: 'outside_viewport',
      visibleBounds: null,
      fullBounds: cssBounds,
    };
  }

  const intersection = intersectBounds(cssBounds, viewport);
  if (!intersection) {
    return {
      visibility: 'outside_viewport',
      visibleBounds: null,
      fullBounds: cssBounds,
    };
  }

  const fullyVisible =
    intersection.x <= cssBounds.x + 0.001 &&
    intersection.y <= cssBounds.y + 0.001 &&
    intersection.width >= cssBounds.width - 0.001 &&
    intersection.height >= cssBounds.height - 0.001;

  if (fullyVisible) {
    return { visibility: 'visible', visibleBounds: null, fullBounds: null };
  }

  return {
    visibility: 'partially_visible',
    visibleBounds: intersection,
    fullBounds: cssBounds,
  };
}

export function collectAttributes(element: Element): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const attr of Array.from(element.attributes)) {
    pairs.push([attr.name, attr.value]);
  }
  return pairs;
}

export function collectComputedLayout(element: Element): Array<[string, string]> {
  const style = globalThis.getComputedStyle(element);
  const layout: Array<[string, string]> = [];
  for (const key of CURATED_CSS_PROPERTIES) {
    if (layout.length >= MAX_CSS_PROPERTIES) {
      break;
    }
    const value = style.getPropertyValue(key);
    if (value) {
      layout.push([key, value]);
    }
  }
  layout.push(['--hardlyui-viewport-width', String(document.documentElement?.clientWidth || globalThis.innerWidth || 0)]);
  layout.push(['--hardlyui-viewport-height', String(document.documentElement?.clientHeight || globalThis.innerHeight || 0)]);
  layout.push(['--hardlyui-root-font-size', globalThis.getComputedStyle(document.documentElement).fontSize]);
  return layout;
}

/** Return CSS custom properties available on the selected element and its root. */
export function collectCssVariables(element: Element): Array<[string, string]> {
  const values = new Map<string, string>();
  for (const source of [
    globalThis.getComputedStyle(document.documentElement),
    globalThis.getComputedStyle(element),
  ]) {
    for (let index = 0; index < source.length; index += 1) {
      const name = source.item(index);
      if (!name.startsWith('--')) continue;
      const value = source.getPropertyValue(name).trim();
      if (value && value.length <= 200) values.set(name, value);
    }
  }
  const designTokenPriority = /(?:color|colour|background|foreground|surface|text|space|spacing|gap|font|type|radius|round|shadow|border|accent)/i;
  return [...values.entries()]
    .sort(([left], [right]) => {
      const priority = Number(designTokenPriority.test(right)) - Number(designTokenPriority.test(left));
      return priority || left.localeCompare(right);
    })
    .slice(0, 40);
}

function toPhysical(bounds: Bounds, dpr: number): Bounds {
  return {
    x: round(bounds.x * dpr),
    y: round(bounds.y * dpr),
    width: round(bounds.width * dpr),
    height: round(bounds.height * dpr),
  };
}

function elementText(element: Element): string | null {
  const text = element.textContent?.trim() ?? '';
  if (!text) {
    return null;
  }
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function editableLeafText(element: Element): string | null {
  if (element.children.length > 0) return null;
  const text = element.textContent ?? '';
  return text.length <= 5_000 ? text : null;
}

/** The element's own text runs, capped like every other snapshot string. */
function ownTextNodeValues(element: Element): string[] {
  return ownTextNodes(element)
    .map((node) => node.data ?? '')
    .filter((value) => value.trim().length > 0)
    .slice(0, 32)
    .map((value) => (value.length > 5_000 ? value.slice(0, 5_000) : value));
}

/**
 * Measure a DOM element into an ElementSnapshot for the hub.
 */
export function measureElement(element: Element, ctx: MeasureContext): ElementSnapshot {
  const dpr = ctx.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
  const rect = element.getBoundingClientRect();
  const cssBounds = rectToBounds(rect);
  const viewport = resolveViewport(ctx);
  const { visibility, visibleBounds, fullBounds } = computeVisibility(cssBounds, viewport);

  return {
    webview_id: ctx.webviewId,
    tag: element.tagName.toLowerCase(),
    text: elementText(element),
    editable_text: editableLeafText(element),
    text_nodes: ownTextNodeValues(element),
    attributes: collectAttributes(element),
    dom_path: buildDomPath(element),
    outer_html: element.outerHTML.length <= 100_000 ? element.outerHTML : undefined,
    reusable_html: reusableMarkup(element),
    parent_dom_path: element.parentElement ? buildDomPath(element.parentElement) : null,
    parent_child_index: element.parentElement
      ? Array.from(element.parentElement.children).indexOf(element)
      : null,
    visibility,
    css_bounds: cssBounds,
    physical_bounds: toPhysical(cssBounds, dpr),
    visible_bounds: visibleBounds,
    full_bounds: fullBounds,
    computed_layout: collectComputedLayout(element),
    css_variables: collectCssVariables(element),
    layout_children: Array.from(element.children).slice(0, 20).map((child, index) => {
      const childBounds = child.getBoundingClientRect();
      const childStyle = globalThis.getComputedStyle(child);
      const margin = (side: 'Left' | 'Right' | 'Top' | 'Bottom') => childStyle[`margin${side}`] === 'auto'
        ? 1_000_000
        : round(Number.parseFloat(childStyle[`margin${side}`]) || 0);
      return {
        index,
        x: round(childBounds.left - rect.left),
        y: round(childBounds.top - rect.top),
        width: round(childBounds.width),
        height: round(childBounds.height),
        margin_left: margin('Left'),
        margin_right: margin('Right'),
        margin_top: margin('Top'),
        margin_bottom: margin('Bottom'),
        position: childStyle.position,
      };
    }),
  };
}

/** Returns an error when capture should be blocked for off-viewport elements. */
export function captureBlockedReason(snapshot: ElementSnapshot): string | null {
  if (snapshot.visibility === 'outside_viewport') {
    return OFF_VIEWPORT_CAPTURE_ERROR;
  }
  return null;
}
