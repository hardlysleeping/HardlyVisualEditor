/**
 * DOM path builder with open shadow traversal and closed-root hints.
 * Location: packages/guest/src/dom-path.ts
 */

import { CLOSED_SHADOW_HINT } from './constants.js';

function segment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) {
    return `${tag}#${escapeId(element.id)}`;
  }
  const parent = element.parentElement;
  if (!parent) {
    return tag;
  }
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (siblings.length <= 1) {
    return tag;
  }
  const index = siblings.indexOf(element) + 1;
  return `${tag}:nth-of-type(${index})`;
}

function escapeId(value: string): string {
  return Array.from(value, (character, index) => {
    const code = character.codePointAt(0) ?? 0;
    if ((index === 0 && /[0-9]/.test(character)) || code === 0) return `\\${code.toString(16)} `;
    if (/[-_a-zA-Z0-9]/.test(character) || code >= 0x80) return character;
    return `\\${character}`;
  }).join('');
}

/**
 * Build a DOM path, traversing open shadow roots; closed roots get an outer-host hint.
 */
export function buildDomPath(element: Element): string {
  const parts: string[] = [];
  let closedHint = false;
  let current: Element | null = element;

  while (current) {
    parts.unshift(segment(current));
    const parent: Element | null = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }

    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      if (root.mode === 'closed') {
        closedHint = true;
      }
      current = root.host;
      continue;
    }
    break;
  }

  const path = parts.join(' > ');
  return closedHint ? `${path}${CLOSED_SHADOW_HINT}` : path;
}
