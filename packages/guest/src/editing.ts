/** Framework-agnostic DOM operations shared by manual and agent edits. */

import { ownTextNodes } from './text-nodes.js';

export type ElementIdentity = {
  webview_id: string;
  inspector_id: string | null;
  html_id: string | null;
  semantic_selector: string | null;
  generated_id: string | null;
};

export type SetStyleOperation = {
  operation: 'set_style';
  identity: ElementIdentity;
  property: string;
  before: string | null;
  after: string | null;
};

export type SetResponsiveStyleOperation = {
  operation: 'set_responsive_style';
  identity: ElementIdentity;
  property: string;
  breakpoint: 'phone' | 'tablet' | 'desktop';
  before: string | null;
  after: string | null;
};

export type SetTextOperation = {
  operation: 'set_text';
  identity: ElementIdentity;
  before: string;
  after: string;
  /** Which of the element's own text nodes to change; defaults to the first. */
  text_index?: number;
};

export type SetAttributeOperation = {
  operation: 'set_attribute';
  identity: ElementIdentity;
  name: string;
  before: string | null;
  after: string | null;
};

export type SetTextBindingOperation = {
  operation: 'set_text_binding';
  identity: ElementIdentity;
  before: ElementIdentity | null;
  after: ElementIdentity | null;
  before_text: string;
};

export type InsertElementOperation = {
  operation: 'insert_element';
  identity: ElementIdentity;
  parent: ElementIdentity;
  tag: 'div' | 'p' | 'span' | 'button' | 'img';
  text: string;
  class_names: string[];
  slot_name?: string | null;
  image_url?: string | null;
};

export type RemoveElementOperation = {
  operation: 'remove_element';
  identity: ElementIdentity;
  parent: ElementIdentity;
  position: number;
  outer_html: string;
};

export type MoveElementOperation = {
  operation: 'move_element';
  identity: ElementIdentity;
  before_parent: ElementIdentity;
  before_position: number;
  after_parent: ElementIdentity;
  after_position: number;
};

export type EditOperation = SetStyleOperation | SetResponsiveStyleOperation | SetTextOperation | SetAttributeOperation | SetTextBindingOperation | InsertElementOperation | RemoveElementOperation | MoveElementOperation;

const TEXT_BINDING_ATTRIBUTE = 'data-hardlyui-bind-text';
let textBindingObserver: MutationObserver | null = null;
let textBindingEventsInstalled = false;
const responsiveStyleRules = new Map<string, { selector: string; property: string; breakpoint: string; value: string }>();

const ALLOWED_PROPERTIES = new Set([
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'color', 'background-color', 'display', 'flex-direction', 'flex-wrap',
  'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'order', 'align-items', 'justify-content', 'gap',
  'align-self',
  'translate', 'font-size', 'font-weight', 'line-height',
  'border-radius', 'border-width', 'border-color', '--hardlyui-locked',
]);

function targetForIdentity(identity: ElementIdentity): HTMLElement | null {
  const choices: Array<[string, string | null]> = [
    ['data-inspector-id', identity.inspector_id],
    ['id', identity.html_id],
    ['data-hardlyui-id', identity.generated_id],
  ];
  for (const [attribute, value] of choices) {
    if (!value) continue;
    const match = Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === value,
    );
    if (match) return match;
  }
  if (!identity.semantic_selector) return null;
  try {
    const matches = document.querySelectorAll<HTMLElement>(identity.semantic_selector);
    const match = matches.length === 1 ? matches.item(0) : null;
    if (match && identity.generated_id) match.setAttribute('data-hardlyui-id', identity.generated_id);
    return match;
  } catch {
    return null;
  }
}

function identityFromBinding(element: HTMLElement): ElementIdentity | null {
  try {
    const value = element.getAttribute(TEXT_BINDING_ATTRIBUTE);
    return value ? JSON.parse(value) as ElementIdentity : null;
  } catch {
    return null;
  }
}

function textValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value;
  }
  return element.textContent ?? '';
}

function sourceWouldCycle(target: HTMLElement, source: HTMLElement): boolean {
  const visited = new Set<HTMLElement>();
  let current: HTMLElement | null = source;
  while (current && !visited.has(current)) {
    if (current === target || current.contains(target) || target.contains(current)) return true;
    visited.add(current);
    const parentIdentity = identityFromBinding(current);
    current = parentIdentity ? targetForIdentity(parentIdentity) : null;
  }
  return false;
}

function syncTextBindings(): void {
  for (const target of Array.from(document.querySelectorAll<HTMLElement>(`[${TEXT_BINDING_ATTRIBUTE}]`))) {
    const identity = identityFromBinding(target);
    if (!identity || target.children.length > 0) continue;
    const source = targetForIdentity(identity);
    if (!source || source === target || sourceWouldCycle(target, source)) continue;
    const value = textValue(source);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.value !== value) target.value = value;
    } else if (target.textContent !== value) {
      target.textContent = value;
    }
  }
}

function installTextBindingObserver(): void {
  if (!document.documentElement) return;
  if (!textBindingObserver) {
    textBindingObserver = new MutationObserver(() => syncTextBindings());
    textBindingObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  if (!textBindingEventsInstalled) {
    document.addEventListener('input', syncTextBindings, true);
    document.addEventListener('change', syncTextBindings, true);
    textBindingEventsInstalled = true;
  }
  syncTextBindings();
}

function safeArtworkUrl(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
  return value.startsWith('https://') || value.startsWith('asset://') || value.startsWith('tauri://')
    || value.startsWith('http://localhost/') || value.startsWith('http://tauri.localhost/')
    || (!value.startsWith('//') && !value.includes(':') && !value.split('/').includes('..'));
}

/** Apply an edit to the actual host DOM. Passing reverse=true undoes it. */
export function applyStyleOperation(
  operation: EditOperation,
  reverse = false,
): boolean {
  if (operation.operation === 'set_responsive_style') {
    if (!ALLOWED_PROPERTIES.has(operation.property) || !['phone', 'tablet', 'desktop'].includes(operation.breakpoint)) return false;
    const value = reverse ? operation.before : operation.after;
    if (value !== null && (value.length > 256 || /[{};]/.test(value))) return false;
    if (value !== null) {
      const probe = document.createElement('div').style;
      probe.setProperty(operation.property, value);
      if (!probe.getPropertyValue(operation.property)) return false;
    }
    const target = targetForIdentity(operation.identity);
    if (!target) return false;
    const identity = operation.identity;
    let selector: string;
    let selectorKey: string;
    if (identity.inspector_id) {
      selector = `[data-inspector-id="${identity.inspector_id.replace(/[\\"']/g, '\\$&')}"]`;
      selectorKey = `inspector:${identity.inspector_id}`;
    } else if (identity.html_id) {
      selector = `#${CSS.escape(identity.html_id)}`;
      selectorKey = `id:${identity.html_id}`;
    } else if (identity.generated_id) {
      target.setAttribute('data-hardlyui-id', identity.generated_id);
      selector = `[data-hardlyui-id="${identity.generated_id}"]`;
      selectorKey = `generated:${identity.generated_id}`;
    } else if (identity.semantic_selector) {
      selector = identity.semantic_selector;
      selectorKey = `selector:${identity.semantic_selector}`;
    } else return false;
    const key = `${selectorKey}\0${operation.breakpoint}\0${operation.property}`;
    if (value === null) responsiveStyleRules.delete(key);
    else responsiveStyleRules.set(key, { selector, property: operation.property, breakpoint: operation.breakpoint, value });
    let style = document.querySelector<HTMLStyleElement>('style[data-hardlyui-responsive-edits]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-hardlyui-responsive-edits', '');
      (document.head ?? document.documentElement).append(style);
    }
    const groups = new Map<string, typeof responsiveStyleRules extends Map<string, infer V> ? V[] : never>();
    for (const rule of responsiveStyleRules.values()) {
      const key = `${rule.breakpoint}\0${rule.selector}`;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    style.textContent = [...groups.entries()].map(([key, rules]) => {
      const breakpoint = key.split('\0', 1)[0];
      const media = breakpoint === 'phone' ? '(max-width: 600px)'
        : breakpoint === 'tablet' ? '(min-width: 601px) and (max-width: 1024px)' : '(min-width: 1025px)';
      return `@media ${media}{${rules[0]!.selector}{${rules.map((rule) => `${rule.property}:${rule.value} !important`).join(';')}}}`;
    }).join('\n');
    return true;
  }

  if (operation.operation === 'set_style') {
    if (!ALLOWED_PROPERTIES.has(operation.property)) return false;
    const value = reverse ? operation.before : operation.after;
    if (value !== null && (value.length > 256 || /[{};]/.test(value))) return false;
    if (value !== null) {
      const probe = document.createElement('div').style;
      probe.setProperty(operation.property, value);
      if (!probe.getPropertyValue(operation.property)) return false;
    }
    const target = targetForIdentity(operation.identity);
    if (!target) return false;
    if (value === null) target.style.removeProperty(operation.property);
    else target.style.setProperty(operation.property, value);
    return true;
  }

  if (operation.operation === 'set_text') {
    const value = reverse ? operation.before : operation.after;
    if (value.length > 5_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
    const target = targetForIdentity(operation.identity);
    if (!target) return false;
    const node = ownTextNodes(target)[operation.text_index ?? 0];
    if (!node) return false;
    // Only the chosen text node is written, so a heading with a <span> or <a>
    // inside it keeps those children intact.
    if (node.data !== value) node.data = value;
    return true;
  }

  if (operation.operation === 'set_attribute') {
    if (operation.name !== 'data-hardlyui-name') return false;
    const value = reverse ? operation.before : operation.after;
    if (value !== null && (value.length > 80 || /[\u0000-\u001f\u007f]/.test(value))) return false;
    const target = targetForIdentity(operation.identity);
    if (!target) return false;
    if (value === null) target.removeAttribute(operation.name);
    else target.setAttribute(operation.name, value);
    return true;
  }

  if (operation.operation === 'set_text_binding') {
    const target = targetForIdentity(operation.identity);
    if (!target || target.children.length > 0) return false;
    const sourceIdentity = reverse ? operation.before : operation.after;
    if (!sourceIdentity) {
      target.removeAttribute(TEXT_BINDING_ATTRIBUTE);
      if (reverse && target.textContent !== operation.before_text) target.textContent = operation.before_text;
      installTextBindingObserver();
      return true;
    }
    const source = targetForIdentity(sourceIdentity);
    if (!source || sourceWouldCycle(target, source)) return false;
    target.setAttribute(TEXT_BINDING_ATTRIBUTE, JSON.stringify(sourceIdentity));
    installTextBindingObserver();
    return true;
  }

  if (operation.operation === 'insert_element') {
    const existing = targetForIdentity(operation.identity);
    if (reverse) {
      existing?.remove();
      return Boolean(existing);
    }
    if (existing) return true;
    const parent = targetForIdentity(operation.parent);
    if (!parent) return false;
    if (operation.tag === 'img' && !operation.image_url) return false;
    if (operation.image_url && !safeArtworkUrl(operation.image_url)) return false;
    const element = document.createElement(operation.tag);
    for (const className of operation.class_names ?? []) {
      if (!/^[\w:/\[\].#%-]{1,128}$/.test(className)) return false;
      element.classList.add(className);
    }
    if (operation.identity.generated_id) {
      element.setAttribute('data-hardlyui-id', operation.identity.generated_id);
    }
    if (operation.slot_name) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(operation.slot_name)) return false;
      element.setAttribute('data-hardlyui-slot', operation.slot_name);
    }
    if (operation.tag === 'img' && operation.image_url) {
      element.setAttribute('src', operation.image_url);
      element.setAttribute('alt', operation.text);
    }
    if (operation.tag !== 'img') element.textContent = operation.text;
    parent.appendChild(element);
    return true;
  }

  if (operation.operation === 'move_element') {
    const target = targetForIdentity(operation.identity);
    const parent = targetForIdentity(reverse ? operation.before_parent : operation.after_parent);
    const position = reverse ? operation.before_position : operation.after_position;
    if (!target || !parent || target === parent || target.contains(parent)) return false;
    const siblings = Array.from(parent.children).filter((child) => child !== target);
    const anchor = siblings[Math.max(0, position)] ?? null;
    parent.insertBefore(target, anchor);
    return true;
  }

  const target = targetForIdentity(operation.identity);
  if (!reverse) {
    if (!target) return true;
    target.remove();
    return true;
  }
  if (target) return true;
  const parent = targetForIdentity(operation.parent);
  if (!parent || operation.outer_html.length > 100_000) return false;
  const template = document.createElement('template');
  template.innerHTML = operation.outer_html;
  const element = template.content.firstElementChild;
  if (!element) return false;
  const anchor = parent.children.item(Math.max(0, operation.position));
  parent.insertBefore(element, anchor);
  return true;
}
