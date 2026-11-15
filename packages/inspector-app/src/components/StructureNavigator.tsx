import { useEffect, useMemo, useState, type JSX } from 'react';
import * as api from '../api.js';
import type { EditHistory, ElementIdentity, EditOperation, SelectedElement, SetStyleOperation } from '../types.js';
import { ErrorNotice } from './ErrorNotice.js';
import { userMessage } from '../lib/messages.js';

type TreeNode = {
  selector: string;
  label: string;
  name: string | null;
  tag: string;
  inlineDisplay: string | null;
  parentSelector: string | null;
  position: number;
  children: TreeNode[];
};

const SKIP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);

function segment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (sameTag.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

function label(element: Element): string {
  const id = element.getAttribute('id');
  const component = element.getAttribute('data-inspector-component');
  const name = element.getAttribute('data-hardlyui-name');
  const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() ?? '').filter(Boolean).join(' ').slice(0, 30);
  return [name || component || element.tagName.toLowerCase(), id ? `#${id}` : '', text ? `· ${text}` : ''].filter(Boolean).join(' ');
}

function identityKey(identity: ElementIdentity): string {
  const stable = identity.inspector_id ? `inspector:${identity.inspector_id}`
    : identity.html_id ? `id:${identity.html_id}`
      : identity.generated_id ? `generated:${identity.generated_id}`
        : `selector:${identity.semantic_selector ?? ''}`;
  return `${identity.webview_id}:${stable}`;
}

function identityFor(node: TreeNode, webviewId: string): ElementIdentity {
  return identityForSelector(node.selector, webviewId);
}

function identityForSelector(selector: string, webviewId: string): ElementIdentity {
  let hash = 2166136261;
  for (let index = 0; index < selector.length; index += 1) hash = Math.imul(hash ^ selector.charCodeAt(index), 16777619);
  return { webview_id: webviewId, inspector_id: null, html_id: null, semantic_selector: selector, generated_id: `hardlyui-${(hash >>> 0).toString(36)}` };
}

function buildTree(markup: string, rootSelector: string): TreeNode | null {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const root = rootSelector === 'body' ? parsed.body : parsed.body.firstElementChild;
  if (!root) return null;
  let count = 0;
  const build = (element: Element, selector: string, depth: number, parentSelector: string | null, position: number): TreeNode | null => {
    if (++count > 100 || depth > 10 || SKIP_TAGS.has(element.tagName.toLowerCase())) return null;
    const children = Array.from(element.children).flatMap((child) => {
      const childSelector = `${selector} > ${segment(child)}`;
      const node = build(child, childSelector, depth + 1, selector, Array.from(element.children).indexOf(child));
      return node ? [node] : [];
    });
    const inline = document.createElement('span');
    inline.style.cssText = element.getAttribute('style') ?? '';
    return { selector, label: label(element), name: element.getAttribute('data-hardlyui-name'), tag: element.tagName.toLowerCase(), inlineDisplay: inline.style.getPropertyValue('display') || null, parentSelector, position, children };
  };
  return build(root, rootSelector, 0, null, 0);
}

function findNode(node: TreeNode | null, selector: string): TreeNode | null {
  if (!node) return null;
  if (node.selector === selector) return node;
  for (const child of node.children) {
    const found = findNode(child, selector);
    if (found) return found;
  }
  return null;
}

export function StructureNavigator({ selected, editHistory }: { selected?: SelectedElement; editHistory: EditHistory }) {
  const [rootElement, setRootElement] = useState<SelectedElement | undefined>(selected);
  const [error, setError] = useState<unknown>(null);
  const [groupedSelection, setGroupedSelection] = useState<string[]>([]);
  const [renamingSelector, setRenamingSelector] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectingPageRoot, setSelectingPageRoot] = useState(false);
  useEffect(() => {
    if (!selected) setRootElement(undefined);
    else if (selectingPageRoot && selected.snapshot.tag === 'body') {
      setRootElement(selected);
      setSelectingPageRoot(false);
    }
    else if (!rootElement || rootElement.snapshot.webview_id !== selected.snapshot.webview_id
      || (rootElement.snapshot.dom_path === selected.snapshot.dom_path
        && rootElement.snapshot.outer_html !== selected.snapshot.outer_html)) setRootElement(selected);
  }, [selected, rootElement, selectingPageRoot]);

  const tree = useMemo(() => {
    if (!rootElement?.snapshot.outer_html || !rootElement.snapshot.dom_path || rootElement.snapshot.dom_path.includes('[closed shadow root')) return null;
    return buildTree(rootElement.snapshot.outer_html, rootElement.snapshot.dom_path);
  }, [rootElement]);

  const currentStyle = (node: TreeNode, property: string): string | null => {
    if (!rootElement) return property === 'display' ? node.inlineDisplay : null;
    const key = identityKey(identityFor(node, rootElement.snapshot.webview_id));
    for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
      for (const operation of [...transaction.operations].reverse()) {
        if (operation.operation === 'set_style' && operation.property === property && identityKey(operation.identity) === key) return operation.after;
      }
    }
    return property === 'display' ? node.inlineDisplay : null;
  };

  const toggleVisibility = (node: TreeNode) => {
    if (!rootElement) return;
    const identity = identityFor(node, rootElement.snapshot.webview_id);
    const before = currentStyle(node, 'display');
    let restoreValue = node.inlineDisplay;
    if (before === 'none') {
      for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
        const hide = [...transaction.operations].reverse().find((operation) =>
          operation.operation === 'set_style' && operation.property === 'display' && operation.after === 'none' && identityKey(operation.identity) === identityKey(identity));
        if (hide?.operation === 'set_style') { restoreValue = hide.before; break; }
      }
    }
    const operation: SetStyleOperation = {
      operation: 'set_style', identity, property: 'display', before,
      after: before === 'none' ? restoreValue : 'none',
    };
    void api.commitEdit({
      id: globalThis.crypto?.randomUUID?.() ?? `visibility-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: before === 'none' ? `Show ${node.tag}` : `Hide ${node.tag}`,
      operations: [operation],
    }).then(() => setError(null)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not change visibility'));
  };

  const toggleLock = (node: TreeNode) => {
    if (!rootElement) return;
    const identity = identityFor(node, rootElement.snapshot.webview_id);
    const before = currentStyle(node, '--hardlyui-locked');
    const operation: SetStyleOperation = {
      operation: 'set_style', identity, property: '--hardlyui-locked', before,
      after: before === '1' ? null : '1',
    };
    void api.commitEdit({
      id: globalThis.crypto?.randomUUID?.() ?? `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: before === '1' ? `Unlock ${node.tag}` : `Lock ${node.tag}`,
      operations: [operation],
    }).then(() => setError(null)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not lock this item'));
  };

  const moveNode = (node: TreeNode, position: number) => {
    if (!rootElement || !node.parentSelector || position < 0) return;
    const siblings = findNode(tree, node.parentSelector)?.children ?? [];
    if (position >= siblings.length || position === siblings.findIndex(({ selector }) => selector === node.selector)) return;
    const parent = identityForSelector(node.parentSelector, rootElement.snapshot.webview_id);
    const operation: EditOperation = {
      operation: 'move_element',
      identity: identityFor(node, rootElement.snapshot.webview_id),
      before_parent: parent,
      before_position: node.position,
      after_parent: parent,
      after_position: position,
    };
    void api.commitEdit({
      id: globalThis.crypto?.randomUUID?.() ?? `move-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: `Move ${node.tag}`,
      operations: [operation],
    }).then(async () => {
      setError(null);
      if (rootElement.snapshot.dom_path) await api.selectElement(rootElement.snapshot.webview_id, rootElement.snapshot.dom_path);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not reorder this item'));
  };

  const saveName = (node: TreeNode) => {
    if (!rootElement) return;
    const value = renameValue.trim();
    if (!value || value.length > 80) {
      setError(userMessage('Enter a name between 1 and 80 characters'));
      return;
    }
    void api.commitEdit({
      id: globalThis.crypto?.randomUUID?.() ?? `rename-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: `Rename ${node.tag}`,
      operations: [{
        operation: 'set_attribute', identity: identityFor(node, rootElement.snapshot.webview_id),
        name: 'data-hardlyui-name', before: node.name, after: value,
      }],
    }).then(async () => {
      setRenamingSelector(null);
      setError(null);
      if (rootElement.snapshot.dom_path) await api.selectElement(rootElement.snapshot.webview_id, rootElement.snapshot.dom_path);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not rename this item'));
  };

  const selectedGroupNodes = groupedSelection.map((selector) => findNode(tree, selector)).filter((node): node is TreeNode => Boolean(node));
  const canGroup = selectedGroupNodes.length > 1
    && selectedGroupNodes.every((node) => node.parentSelector === selectedGroupNodes[0]?.parentSelector)
    && Boolean(selectedGroupNodes[0]?.parentSelector);

  const groupSelected = () => {
    if (!rootElement || !canGroup) return;
    // Move from the end so selectors for not-yet-moved siblings remain valid.
    const nodes = [...selectedGroupNodes].sort((a, b) => b.position - a.position);
    const parentSelector = nodes[0]!.parentSelector!;
    const webviewId = rootElement.snapshot.webview_id;
    const parent = identityForSelector(parentSelector, webviewId);
    const groupIdentity: ElementIdentity = {
      webview_id: webviewId, inspector_id: null, html_id: null, semantic_selector: null,
      generated_id: `hardlyui-group-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    };
    const operations: EditOperation[] = [
      { operation: 'insert_element', identity: groupIdentity, parent, tag: 'div', text: '', class_names: [] },
      ...[
        ['display', 'flex'], ['align-items', 'center'], ['flex-wrap', 'wrap'], ['gap', '8px'],
      ].map(([property, after]) => ({
        operation: 'set_style' as const, identity: groupIdentity, property, before: null, after,
      })),
    ];
    nodes.forEach((node) => operations.push({
      operation: 'move_element', identity: identityFor(node, webviewId),
      before_parent: parent, before_position: node.position,
      after_parent: groupIdentity, after_position: 0,
    }));
    void api.commitEdit({
      id: globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: `Group ${nodes.length} items`, operations,
    }).then(async () => {
      setGroupedSelection([]);
      setError(null);
      if (rootElement.snapshot.dom_path) await api.selectElement(rootElement.snapshot.webview_id, rootElement.snapshot.dom_path);
    })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not group these items'));
  };

  const renderNode = (node: TreeNode, depth = 0, siblings: TreeNode[] = [], siblingIndex = 0): JSX.Element => {
    const hidden = currentStyle(node, 'display') === 'none';
    const locked = currentStyle(node, '--hardlyui-locked') === '1';
    return (
    <li key={node.selector} className="min-w-0">
      <div className="flex min-w-0 items-center gap-0.5" style={{ marginLeft: `${Math.min(depth, 8) * 8}px` }}>
      <input type="checkbox" className="h-2.5 w-2.5 accent-[var(--inspector-accent)]" aria-label={`Select ${node.label} for grouping`} checked={groupedSelection.includes(node.selector)} onChange={(event) => {
        setGroupedSelection((current) => event.target.checked
          ? [...current, node.selector]
          : current.filter((selector) => selector !== node.selector));
      }} />
      {renamingSelector === node.selector ? <input autoFocus value={renameValue} maxLength={80} className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px]" aria-label={`New name for ${node.label}`} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter') saveName(node);
        if (event.key === 'Escape') setRenamingSelector(null);
      }} /> : <button
        type="button"
        title={node.selector}
        className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-[#252a33] ${selected?.snapshot.dom_path === node.selector ? 'bg-[rgba(88,166,255,0.16)] text-[var(--inspector-accent)]' : 'text-[var(--inspector-text)]'} ${hidden ? 'opacity-50 line-through' : ''}`}
        onClick={() => {
          if (!rootElement || hidden) return;
          void api.selectElement(rootElement.snapshot.webview_id, node.selector).then(() => setError(null))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not select this item'));
        }}
      >{node.label}</button>}
      {renamingSelector === node.selector ? <button type="button" className="rounded px-1 py-0.5 text-[11px] text-[var(--inspector-accent)]" aria-label={`Save name for ${node.label}`} onClick={() => saveName(node)}>✓</button> : <button type="button" className="rounded px-1 py-0.5 text-[11px] text-[var(--inspector-muted)]" aria-label={`Rename ${node.label}`} title="Rename" onClick={() => { setRenameValue(node.name ?? node.label); setRenamingSelector(node.selector); }}>✎</button>}
      <button type="button" className="rounded px-1 py-0.5 text-[11px] text-[var(--inspector-muted)] hover:bg-[#252a33]" aria-label={hidden ? `Show ${node.label}` : `Hide ${node.label}`} title={hidden ? 'Show element' : 'Hide element'} onClick={() => toggleVisibility(node)}>{hidden ? '◉' : '◌'}</button>
      <button type="button" className={`rounded px-1 py-0.5 text-[11px] ${locked ? 'text-[var(--inspector-accent)]' : 'text-[var(--inspector-muted)]'}`} aria-label={locked ? `Unlock ${node.label}` : `Lock ${node.label}`} title={locked ? 'Unlock element movement' : 'Lock element movement'} onClick={() => toggleLock(node)}>{locked ? '🔒' : '◇'}</button>
      {node.parentSelector && <>
        <button type="button" disabled={siblingIndex === 0} className="rounded px-1 py-0.5 text-[11px] text-[var(--inspector-muted)] disabled:opacity-30" aria-label={`Move ${node.label} up`} title="Move up" onClick={() => moveNode(node, Math.max(0, siblingIndex - 1))}>↑</button>
        <button type="button" disabled={siblingIndex === siblings.length - 1} className="rounded px-1 py-0.5 text-[11px] text-[var(--inspector-muted)] disabled:opacity-30" aria-label={`Move ${node.label} down`} title="Move down" onClick={() => moveNode(node, Math.min(siblings.length - 1, siblingIndex + 1))}>↓</button>
      </>}
      </div>
      {node.children.length > 0 && <ul>{node.children.map((child, index) => renderNode(child, depth + 1, node.children, index))}</ul>}
    </li>
    );
  };

  if (!selected) return null;
  return <details className="mb-2 shrink-0 rounded-md border border-[var(--inspector-border)] bg-[#161b22] p-2">
    <summary className="cursor-pointer text-[12px] font-semibold">Structure · {tree?.children.length ?? 0} sections</summary>
    <div className="mt-1 flex items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--inspector-muted)]" title={rootElement?.selector}>{rootElement?.snapshot.tag} tree root</span>
      <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-0.5 text-[11px]" onClick={() => {
        if (!rootElement) return;
        setSelectingPageRoot(true);
        void api.selectElement(rootElement.snapshot.webview_id, 'body')
          .then(() => setError(null))
          .catch((reason: unknown) => { setSelectingPageRoot(false); setError(reason instanceof Error ? reason.message : 'Could not load the page structure'); });
      }}>Full page</button>
      <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-0.5 text-[11px]" onClick={() => {
        if (rootElement?.snapshot.dom_path) {
          void api.selectElement(rootElement.snapshot.webview_id, rootElement.snapshot.dom_path)
            .then(() => setError(null))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not refresh this structure'));
        } else {
          setRootElement(selected);
        }
      }}>Refresh tree</button>
    </div>
    {groupedSelection.length > 0 && <div className="mt-1 flex items-center gap-1">
      <span className="flex-1 text-[11px] text-[var(--inspector-muted)]">{groupedSelection.length} selected</span>
      <button type="button" disabled={!canGroup} className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] disabled:opacity-40" title="Wrap selected siblings in a reusable layout container" onClick={groupSelected}>Group</button>
      <button type="button" className="rounded px-1 py-0.5 text-[11px]" onClick={() => setGroupedSelection([])}>Clear</button>
    </div>}
    {tree ? <ul className="mt-1 max-h-36 overflow-auto">{renderNode(tree, 0, [tree], 0)}</ul> : <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">This selection has no safe, searchable child structure.</p>}
    {error ? <ErrorNotice message={error} className="mt-1" /> : null}
  </details>;
}
