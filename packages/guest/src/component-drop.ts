/** Cross-webview drag/drop for project-saved, framework-neutral components. */

import { invoke } from '@tauri-apps/api/core';
import { buildDomPath } from './dom-path.js';
import { eventHitsInspectorUi } from './inspector-ui-guard.js';
import type { EditOperation, ElementIdentity } from './editing.js';

export const COMPONENT_DRAG_TYPE = 'application/x-hardlyui-component+json';
const MAX_COMPONENT_STYLES = 40;

export type DroppableComponentNode = {
  tag: 'div' | 'p' | 'span' | 'button' | 'img';
  text: string;
  class_names: string[];
  styles: Array<[string, string]>;
  image_url?: string | null;
  slot_name?: string | null;
  children: DroppableComponentNode[];
};

export type DroppableComponent = DroppableComponentNode & { id: string; name: string };

const ALLOWED_STYLES = new Set([
  'width', 'height', 'display', 'flex-direction', 'flex-wrap',
  'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'order', 'align-items', 'justify-content',
  'align-self',
  'min-width', 'max-width', 'min-height', 'max-height', 'border-width', 'border-color',
  'gap', 'translate', 'padding', 'margin', 'color', 'background-color', 'font-size',
  'font-weight', 'line-height', 'border-radius',
]);

function validNode(value: unknown, depth: number, count: { value: number }): value is DroppableComponentNode {
  if (!value || typeof value !== 'object' || depth > 12 || ++count.value > 100) return false;
  const node = value as Partial<DroppableComponentNode>;
  if (!['div', 'p', 'span', 'button', 'img'].includes(node.tag ?? '') || typeof node.text !== 'string' || node.text.length > 500) return false;
  if (node.tag === 'img' && (typeof node.image_url !== 'string' || !safeArtworkUrl(node.image_url))) return false;
  if (!Array.isArray(node.class_names) || node.class_names.length > 32 || node.class_names.some((name) => typeof name !== 'string' || !/^[\w:/\[\].#%-]{1,128}$/.test(name))) return false;
  if (node.slot_name != null && (typeof node.slot_name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(node.slot_name))) return false;
  if (!Array.isArray(node.styles) || node.styles.length > MAX_COMPONENT_STYLES || node.styles.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !ALLOWED_STYLES.has(entry[0]) || typeof entry[1] !== 'string' || !entry[1].length || entry[1].length > 256 || /[{};]/.test(entry[1]))) return false;
  if (!Array.isArray(node.children) || node.children.length > 50) return false;
  return node.children.every((child) => validNode(child, depth + 1, count));
}

function safeArtworkUrl(value: string): boolean {
  if (!value || value.length > 2048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
  return value.startsWith('https://') || value.startsWith('asset://') || value.startsWith('tauri://')
    || value.startsWith('http://localhost/') || value.startsWith('http://tauri.localhost/')
    || (!value.startsWith('//') && !value.includes(':') && !value.split('/').includes('..'));
}

export function isDroppableComponent(value: unknown): value is DroppableComponent {
  if (!value || typeof value !== 'object') return false;
  const component = value as Partial<DroppableComponent>;
  return typeof component.id === 'string' && component.id.length <= 80
    && typeof component.name === 'string' && component.name.length <= 64
    && validNode(component, 0, { value: 0 });
}

function identityForElement(element: HTMLElement, webviewId: string, inserted = false): ElementIdentity {
  const htmlId = element.id || null;
  const inspectorId = element.getAttribute('data-inspector-id');
  return {
    webview_id: webviewId,
    inspector_id: inspectorId,
    html_id: htmlId,
    semantic_selector: buildDomPath(element),
    generated_id: inserted ? `hardlyui-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}` : element.getAttribute('data-hardlyui-id'),
  };
}

export function buildDropOperations(
  component: DroppableComponent,
  parent: ElementIdentity,
  textOverride = component.text,
): EditOperation[] {
  const operations: EditOperation[] = [];
  const appendNode = (node: DroppableComponentNode, parentIdentity: ElementIdentity, root = false) => {
    const identity: ElementIdentity = {
      webview_id: parentIdentity.webview_id,
      inspector_id: null,
      html_id: null,
      semantic_selector: null,
      generated_id: `hardlyui-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    };
    operations.push({
      operation: 'insert_element', identity, parent: parentIdentity,
      tag: node.tag, text: root ? textOverride.slice(0, 500) : node.text, class_names: node.class_names,
      slot_name: node.slot_name ?? null, image_url: node.image_url ?? null,
    });
    for (const [property, after] of node.styles) {
      operations.push({ operation: 'set_style', identity, property, before: null, after });
    }
    node.children.forEach((child) => appendNode(child, identity));
  };
  appendNode(component, parent, true);
  return operations;
}

export function installComponentDrop(webviewId: string): () => void {
  let highlighted: HTMLElement | null = null;
  let previousOutline = '';
  const clearHighlight = () => {
    if (highlighted) highlighted.style.outline = previousOutline;
    highlighted = null;
  };
  const dropTarget = (event: DragEvent): HTMLElement | null => {
    if (eventHitsInspectorUi(event) || !(event.target instanceof Element)) return null;
    return event.target.closest<HTMLElement>('[data-hardlyui-slot]') ?? event.target.closest<HTMLElement>('body *');
  };
  const onDragOver = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes(COMPONENT_DRAG_TYPE)) return;
    const target = dropTarget(event);
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (highlighted !== target) {
      clearHighlight();
      highlighted = target;
      previousOutline = target.style.outline;
      target.style.outline = target.hasAttribute('data-hardlyui-slot') ? '2px solid #a371f7' : '2px solid #58a6ff';
    }
  };
  const onDragLeave = (event: DragEvent) => {
    if (event.relatedTarget instanceof Node && highlighted?.contains(event.relatedTarget)) return;
    clearHighlight();
  };
  const onDrop = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes(COMPONENT_DRAG_TYPE)) return;
    const target = dropTarget(event);
    clearHighlight();
    if (!target || !event.dataTransfer) return;
    event.preventDefault();
    try {
      const component: unknown = JSON.parse(event.dataTransfer.getData(COMPONENT_DRAG_TYPE));
      if (!isDroppableComponent(component)) return;
      const transaction = {
        id: globalThis.crypto?.randomUUID?.() ?? `drop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: `Insert ${component.name}`,
        operations: buildDropOperations(component, identityForElement(target, webviewId)),
      };
      void invoke('plugin:visual-editor|commit_edit', { transaction });
    } catch {
      // Ignore malformed drag data; the inspector click-to-insert path remains available.
    }
  };
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragleave', onDragLeave, true);
  document.addEventListener('drop', onDrop, true);
  return () => {
    clearHighlight();
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('dragleave', onDragLeave, true);
    document.removeEventListener('drop', onDrop, true);
  };
}
