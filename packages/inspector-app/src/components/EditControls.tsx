/** Persistent style and structural editing controls for the selected host element. */

import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import * as api from '../api.js';
import type { EditVersion, PublishedEntry, SavedComponent, SavedComponentNode } from '../api.js';
import type { EditHistory, EditOperation, SelectedElement, SetResponsiveStyleOperation, SetStyleOperation, SetTextOperation } from '../types.js';
import { availableInsertPresets, type InsertPresetNode } from './insert-catalog.js';
import { exportSavedComponentMarkup } from './component-export.js';
import { collectTokenScales, cssVariable, nearestToken, normalizeShorthand } from '../lib/designTokens.js';
import { diffVersionCss, type CssVersionDiff } from '../lib/cssVersionDiff.js';
import { cssHint, GLOSSARY_PROMISE } from '../lib/cssGlossary.js';
import { back, forward, getSnapshot as actionLogSnapshot, peekRedo, peekUndo, record as recordAction, subscribe as subscribeActionLog } from '../lib/actionLog.js';
import { Tooltip } from './Tooltip.js';
import { StructureNavigator } from './StructureNavigator.js';
import { ErrorNotice } from './ErrorNotice.js';
import { userMessage } from '../lib/messages.js';
import { MediaPanel } from './MediaPanel.js';
import { ConfirmDialog, useConfirm } from './ConfirmDialog.js';

type Props = {
  element?: SelectedElement;
  selectedElements?: SelectedElement[];
  sourceBaseUrl?: string;
  editHistory: EditHistory;
  canUndo: boolean;
  canRedo: boolean;
};

const viewportProfiles = [
  { label: 'iPhone 17 Pro Max', width: 440, height: 956, group: 'Phone' },
  { label: 'iPhone 17 Pro Max · landscape', width: 956, height: 440, group: 'Phone' },
  { label: 'iPhone 17 Pro', width: 402, height: 874, group: 'Phone' },
  { label: 'iPhone 17 Pro · landscape', width: 874, height: 402, group: 'Phone' },
  { label: 'Pixel 11 Pro XL', width: 448, height: 997, group: 'Phone' },
  { label: 'Pixel 11 Pro XL · landscape', width: 997, height: 448, group: 'Phone' },
  { label: 'iPad Air 11', width: 820, height: 1180, group: 'Tablet' },
  { label: 'iPad Air 11 · landscape', width: 1180, height: 820, group: 'Tablet' },
  { label: 'iPad Pro 13', width: 1032, height: 1376, group: 'Tablet' },
  { label: 'iPad Pro 13 · landscape', width: 1376, height: 1032, group: 'Tablet' },
  { label: 'Laptop', width: 1366, height: 768, group: 'Desktop' },
  { label: 'Desktop', width: 1440, height: 900, group: 'Desktop' },
  { label: 'Wide desktop', width: 1920, height: 1080, group: 'Desktop' },
] as const;
type ViewportProfile = (typeof viewportProfiles)[number];

type Gesture = {
  id: string;
  before: string | null;
  startingValue: string;
  latest: string;
  operation: SetStyleOperation;
};

type FixSuggestion = {
  title: string;
  detail: string;
  property: string;
  value: string;
  kind: 'layout' | 'token';
};

function attribute(element: SelectedElement, name: string): string | null {
  return element.snapshot.attributes.find(([key]) => key === name)?.[1] ?? null;
}

function widthValue(element?: SelectedElement): number {
  const width = element?.snapshot.css_bounds.width ?? 120;
  return Number.isFinite(width) ? Math.max(0, Math.round(width)) : 120;
}

function cssPixels(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}

function inlineWidth(element: SelectedElement): string | null {
  return inlineStyle(element, 'width');
}

function inlineStyle(element: SelectedElement, property: string): string | null {
  const style = document.createElement('span').style;
  style.cssText = attribute(element, 'style') ?? '';
  return style.getPropertyValue(property).trim() || null;
}

function computedStyle(element: SelectedElement, property: string): string {
  return element.snapshot.computed_layout.find(([key]) => key === property)?.[1] ?? '';
}

function pixelOffset(value: string): { x: number; y: number } | null {
  if (!value || value === 'none') return { x: 0, y: 0 };
  const parts = value.trim().split(/\s+/);
  const parse = (raw: string | undefined) => {
    if (!raw || raw === '0') return 0;
    const match = raw.match(/^(-?(?:\d+\.?\d*|\.\d+))px$/);
    return match ? Number(match[1]) : Number.NaN;
  };
  const x = parse(parts[0]);
  const y = parse(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function gridTrackCount(value: string): number {
  const repeat = value.match(/^repeat\((\d+)\s*,/i);
  if (repeat) return Number(repeat[1]);
  if (/^repeat\((?:auto-fit|auto-fill)\s*,/i.test(value)) return 0;
  if (!value || value === 'none') return 2;
  let depth = 0;
  let tracks = 0;
  let inTrack = false;
  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) inTrack = false;
    else if (!inTrack) { tracks += 1; inTrack = true; }
  }
  return Math.max(1, tracks);
}

function identityKey(identity: SetStyleOperation['identity']): string {
  const stable = identity.inspector_id
    ? `inspector:${identity.inspector_id}`
    : identity.html_id
      ? `id:${identity.html_id}`
      : identity.generated_id
        ? `generated:${identity.generated_id}`
        : `selector:${identity.semantic_selector ?? ''}`;
  return `${identity.webview_id}:${stable}`;
}

function editedStyleValue(
  element: SelectedElement,
  property: string,
  editHistory: EditHistory,
): string {
  const key = identityKey(identityFor(element));
  const viewportWidth = Number(element.snapshot.computed_layout.find(([name]) => name === '--hardlyui-viewport-width')?.[1] ?? 0);
  const currentBreakpoint = viewportWidth > 0 ? viewportWidth <= 600 ? 'phone' : viewportWidth <= 1024 ? 'tablet' : 'desktop' : null;
  if (currentBreakpoint) {
    for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
      for (const operation of [...transaction.operations].reverse()) {
        if (operation.operation === 'set_responsive_style' && operation.property === property
          && operation.breakpoint === currentBreakpoint && identityKey(operation.identity) === key) {
          if (operation.after !== null) return operation.after;
          return baseEditedStyleValue(element, property, editHistory);
        }
      }
    }
  }
  return baseEditedStyleValue(element, property, editHistory);
}

function baseEditedStyleValue(element: SelectedElement, property: string, editHistory: EditHistory): string {
  const key = identityKey(identityFor(element));
  for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
    for (const operation of [...transaction.operations].reverse()) {
      if (
        operation.operation === 'set_style' &&
        operation.property === property &&
        identityKey(operation.identity) === key
      ) {
        return operation.after ?? '';
      }
    }
  }
  return computedStyle(element, property);
}

function editedResponsiveStyleValue(element: SelectedElement, property: string, breakpoint: 'phone' | 'tablet' | 'desktop', editHistory: EditHistory): string | null {
  const key = identityKey(identityFor(element));
  for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
    for (const operation of [...transaction.operations].reverse()) {
      if (operation.operation === 'set_responsive_style' && operation.property === property
        && operation.breakpoint === breakpoint && identityKey(operation.identity) === key) return operation.after;
    }
  }
  return null;
}

function editedInlineStyleValue(
  element: SelectedElement,
  property: string,
  editHistory: EditHistory,
): string | null {
  const key = identityKey(identityFor(element));
  for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
    for (const operation of [...transaction.operations].reverse()) {
      if (
        operation.operation === 'set_style' &&
        operation.property === property &&
        identityKey(operation.identity) === key
      ) return operation.after;
    }
  }
  return inlineStyle(element, property);
}

function editedTextValue(element: SelectedElement, editHistory: EditHistory, index = 0): string {
  const key = identityKey(identityFor(element));
  for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
    for (const operation of [...transaction.operations].reverse()) {
      if (
        operation.operation === 'set_text'
        && identityKey(operation.identity) === key
        && (operation.text_index ?? 0) === index
      ) {
        return operation.after;
      }
    }
  }
  return element.snapshot.text_nodes?.[index] ?? element.snapshot.editable_text ?? '';
}

function textBindingValue(element: SelectedElement, editHistory: EditHistory): SetStyleOperation['identity'] | null {
  const key = identityKey(identityFor(element));
  for (const transaction of editHistory.transactions.slice(0, editHistory.cursor).reverse()) {
    for (const operation of [...transaction.operations].reverse()) {
      if (operation.operation === 'set_text_binding' && identityKey(operation.identity) === key) return operation.after;
    }
  }
  const raw = attribute(element, 'data-hardlyui-bind-text');
  if (!raw) return null;
  try { return JSON.parse(raw) as SetStyleOperation['identity']; } catch { return null; }
}

/** Label that explains the underlying CSS on hover when we have words for it. */
function FieldLabel({ label, property }: { label: string; property?: string }) {
  const hint = cssHint(property);
  if (!hint) return <span>{label}</span>;
  return (
    <Tooltip text={hint}>
      <span className="cursor-help border-b border-dotted border-[var(--inspector-muted)]">{label}</span>
    </Tooltip>
  );
}

function CssField({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
  property,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  property?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
      <FieldLabel label={label} property={property} />
      <input
        aria-label={label}
        className="min-w-0 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)] outline-none focus:border-[var(--inspector-accent)] disabled:opacity-40"
        type="text"
        list="hardlyui-css-token-values"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function pickerColor(value: string, cssVariables: Array<[string, string]>, seen = new Set<string>()): string {
  const variable = value.trim().match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (variable) {
    if (seen.has(variable[1]!)) return '#000000';
    seen.add(variable[1]!);
    return pickerColor(cssVariables.find(([name]) => name === variable[1])?.[1] ?? variable[2] ?? '#000000', cssVariables, seen);
  }
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) return hex.length === 3 ? `#${[...hex].map((digit) => `${digit}${digit}`).join('')}` : `#${hex}`;
  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i);
  if (rgb) return `#${rgb.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

function CssColorField({
  label,
  value,
  placeholder,
  disabled,
  cssVariables,
  onCommit,
  property,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  cssVariables: Array<[string, string]>;
  onCommit: (value: string) => void;
  property?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => onCommit(draft);
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
      <FieldLabel label={label} property={property} />
      <span className="flex min-w-0 items-center gap-1">
        <input
          aria-label={`${label} picker`}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-[var(--inspector-border)] bg-[#0d1117] p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          type="color"
          value={pickerColor(draft, cssVariables)}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
        />
        <input
          aria-label={label}
          className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)] outline-none focus:border-[var(--inspector-accent)] disabled:opacity-40"
          type="text"
          list="hardlyui-css-token-values"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
      </span>
    </label>
  );
}

function TextContentField({
  value,
  label = 'Text content',
  disabled,
  onCommit,
}: {
  value: string;
  label?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
      <span>{label}</span>
      <textarea
        aria-label="Selected element text"
        className="min-w-0 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)] outline-none focus:border-[var(--inspector-accent)] disabled:opacity-40"
        rows={2}
        maxLength={5_000}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => onCommit(draft)}
      />
    </label>
  );
}

function stableElementIdForPath(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash = Math.imul(hash ^ path.charCodeAt(index), 16777619);
  }
  return `hardlyui-${(hash >>> 0).toString(36)}`;
}

function identityFor(element: SelectedElement): SetStyleOperation['identity'] {
  return {
    webview_id: element.snapshot.webview_id,
    inspector_id: element.inspector_id ?? attribute(element, 'data-inspector-id'),
    html_id: attribute(element, 'id'),
    semantic_selector: element.snapshot.dom_path,
    generated_id: attribute(element, 'data-hardlyui-id') ?? stableElementIdForPath(element.snapshot.dom_path),
  };
}

function transactionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function identityForPath(webviewId: string, selector: string | null | undefined): SetStyleOperation['identity'] {
  return {
    webview_id: webviewId,
    inspector_id: null,
    html_id: null,
    semantic_selector: selector || null,
    generated_id: selector ? stableElementIdForPath(selector) : null,
  };
}

function elementId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `hardlyui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function collectComponentTextProps(node: SavedComponentNode, id: string, path: number[] = [], result: Record<string, string> = {}): Record<string, string> {
  result[`${id}:${path.join('.')}`] = node.text;
  node.children.forEach((child, index) => collectComponentTextProps(child, id, [...path, index], result));
  return result;
}

function safeArtworkUrl(value: string): boolean {
  if (!value || value.length > 2_048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
  return value.startsWith('https://') || value.startsWith('asset://') || value.startsWith('tauri://')
    || value.startsWith('http://localhost/') || value.startsWith('http://tauri.localhost/')
    || (!value.startsWith('//') && !value.includes(':') && !value.split('/').includes('..'));
}

export function EditControls({ element, selectedElements = [], sourceBaseUrl, editHistory, canUndo, canRedo }: Props) {
  const initialWidth = widthValue(element);
  const [width, setWidth] = useState(initialWidth);
  const [nudgeStep, setNudgeStep] = useState(8);
  const [spacingStep, setSpacingStep] = useState(4);
  const [snapGrid, setSnapGrid] = useState(8);
  const [moveConstraint, setMoveConstraint] = useState<'free' | 'horizontal' | 'vertical'>('free');
  const [breakpointMode, setBreakpointMode] = useState<'all' | 'phone' | 'tablet' | 'desktop'>('all');
  const [viewportPreview, setViewportPreview] = useState<ViewportProfile | null>(null);
  const viewportPreviewRef = useRef<{ webviewId: string; profile: ViewportProfile } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [layoutPreview, setLayoutPreview] = useState<SetStyleOperation | SetResponsiveStyleOperation | null>(null);
  const [sourceUndo, setSourceUndo] = useState<{ baseUrl: string; file: string; offset: number; before: string; after: string } | null>(null);
  const actionLog = useSyncExternalStore(subscribeActionLog, actionLogSnapshot);
  const [sourceRedo, setSourceRedo] = useState(false);
  const [sourceReview, setSourceReview] = useState<{ baseUrl: string; file: string; offset: number; before: string; after: string; revision: string; beforeCode: string; afterCode: string; property?: string; sourceKind?: 'insert' } | null>(null);
  const [componentLibrary, setComponentLibrary] = useState<SavedComponent[]>([]);
  const [componentName, setComponentName] = useState('Reusable element');
  const [componentSearch, setComponentSearch] = useState('');
  const [componentTextProps, setComponentTextProps] = useState<Record<string, string>>({});
  const [componentArtworkProps, setComponentArtworkProps] = useState<Record<string, string>>({});
  const [componentSvelteBindings, setComponentSvelteBindings] = useState<Record<string, string>>({});
  const [textBindingSource, setTextBindingSource] = useState<SelectedElement | null>(null);
  const confirm = useConfirm();
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const [published, setPublished] = useState<PublishedEntry[]>([]);
  const [publishLabel, setPublishLabel] = useState('');
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState('');
  const [previewVersion, setPreviewVersion] = useState<EditVersion | null>(null);
  const [versionDiff, setVersionDiff] = useState<CssVersionDiff | null>(null);
  const [versionThumbnail, setVersionThumbnail] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const previewQueue = useRef<Promise<void>>(Promise.resolve());
  const stableIdentity = element
    ? identityFor(element).inspector_id || identityFor(element).html_id || identityFor(element).generated_id || element.selector
    : null;
  const alignableElements = element
    ? selectedElements.filter((candidate) => candidate.status === 'valid' && candidate.snapshot.webview_id === element.snapshot.webview_id)
    : [];
  const utilityClasses = element
    ? (attribute(element, 'class') ?? '').split(/\s+/).filter(Boolean).slice(0, 24)
    : [];
  const cssVariables = element?.snapshot.css_variables ?? [];
  const rootFontPx = Number(element?.snapshot.computed_layout.find(([name]) => name === '--hardlyui-root-font-size')?.[1]?.replace(/px$/i, '')) || 16;
  const designTokens = collectTokenScales(cssVariables, rootFontPx);
  const dataAttributes = element
    ? element.snapshot.attributes.map(([name]) => name.toLowerCase()).filter((name) => name.startsWith('data-'))
    : [];
  const insertPresets = availableInsertPresets({ classNames: utilityClasses, cssVariables, dataAttributes });
  const styleValueForMode = (target: SelectedElement, property: string) => breakpointMode === 'all'
    ? editedStyleValue(target, property, editHistory)
    : editedResponsiveStyleValue(target, property, breakpointMode, editHistory) ?? baseEditedStyleValue(target, property, editHistory);
  const liveViewportWidth = Number(element?.snapshot.computed_layout.find(([name]) => name === '--hardlyui-viewport-width')?.[1] ?? 0);
  const liveViewportHeight = Number(element?.snapshot.computed_layout.find(([name]) => name === '--hardlyui-viewport-height')?.[1] ?? 0);
  const liveViewportLabel = liveViewportWidth > 0
    ? `${liveViewportWidth <= 600 ? 'Phone' : liveViewportWidth <= 1024 ? 'Tablet' : 'Desktop'} · ${Math.round(liveViewportWidth)} × ${Math.round(liveViewportHeight)} CSS px`
    : 'Current preview size unavailable';

  useEffect(() => {
    const targetId = element?.snapshot.webview_id;
    return () => {
      const activePreview = viewportPreviewRef.current;
      if (activePreview && activePreview.webviewId === targetId) {
        viewportPreviewRef.current = null;
        void api.setPreviewViewport(activePreview.webviewId, null, null);
      }
    };
  }, [element?.snapshot.webview_id]);

  useEffect(() => setViewportPreview(null), [element?.snapshot.webview_id]);

  const changeViewportPreview = async (profile: ViewportProfile | null) => {
    if (!element) return;
    const webviewId = element.snapshot.webview_id;
    try {
      await api.setPreviewViewport(webviewId, profile?.width ?? null, profile?.height ?? null);
      viewportPreviewRef.current = profile === null ? null : { webviewId, profile };
      setViewportPreview(profile);
      setError(null);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (element.snapshot.dom_path) await api.selectElement(webviewId, element.snapshot.dom_path);
    } catch (reason) {
      try { await api.setPreviewViewport(webviewId, null, null); } catch { /* Keep the original resize error visible. */ }
      setError(reason instanceof Error ? reason.message : 'Could not resize the app preview');
    }
  };
  const currentGap = element ? styleValueForMode(element, 'gap') : '';
  const hostSpacingTokens = cssVariables.filter(([name]) => /(?:space|spacing|gap)/i.test(name)).slice(0, 12);
  const spacingOptions = [...new Set(['0px', '4px', '8px', '12px', '16px', '24px', '32px', ...hostSpacingTokens.map(([name]) => `var(${name})`)])];
  const spacingOptionLabel = (option: string) => {
    const token = hostSpacingTokens.find(([name]) => `var(${name})` === option);
    return token ? `${token[0]} · ${token[1]}` : option;
  };

  useEffect(() => {
    void api.getComponentLibrary().then((components) => {
      setComponentLibrary(components);
      setComponentTextProps(components.reduce((props, component) => Object.assign(props, collectComponentTextProps(component, component.id)), {} as Record<string, string>));
      setComponentSvelteBindings(components.reduce((bindings, component) => {
        for (const [path, expression] of Object.entries(component.svelte_bindings ?? {})) bindings[`${component.id}:${path}`] = expression;
        return bindings;
      }, {} as Record<string, string>));
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load component library');
    });
  }, []);

  useEffect(() => {
    void api.listVersions().then(setVersions).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load edit versions');
    });
    void api.listPublished().then(setPublished).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!previewVersion?.has_preview) {
      setVersionThumbnail(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    void api.loadVersionPreviewUrl(previewVersion.id).then((created) => {
      url = created;
      if (active) setVersionThumbnail(created);
      else URL.revokeObjectURL(created);
    }).catch(() => {
      if (active) setVersionThumbnail(null);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewVersion]);

  useEffect(() => {
    if (!previewVersion) {
      setVersionDiff(null);
      return;
    }
    let active = true;
    void api.compareVersion(previewVersion.id).then((comparison) => {
      if (!active) return;
      setVersionDiff(diffVersionCss(comparison.version_css, comparison.current_css));
    }).catch((reason: unknown) => {
      if (!active) return;
      setVersionDiff(null);
      setError(reason instanceof Error ? reason.message : 'Could not compare that version');
    });
    return () => {
      active = false;
    };
  }, [previewVersion, editHistory]);

  useEffect(() => {
    const next = widthValue(element);
    setWidth(next);
    gesture.current = null;
    setError(null);
  }, [element?.id, element?.snapshot.css_bounds.width]);

  const beginGesture = () => {
    if (!element || gesture.current) return;
    const startingValue = cssPixels(widthValue(element));
    const before = inlineWidth(element);
    gesture.current = {
      id: transactionId(),
      before,
      startingValue,
      latest: startingValue,
      operation: {
        operation: 'set_style',
        identity: identityFor(element),
        property: 'width',
        before,
        after: before,
      },
    };
  };

  const preview = (value: number) => {
    if (!element) return;
    beginGesture();
    const active = gesture.current;
    if (!active) return;
    const after = `${Math.round(value)}px`;
    active.latest = after;
    const operation = { ...active.operation, after };
    previewQueue.current = previewQueue.current
      .then(() => api.previewStyle(operation))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Preview failed');
      });
  };

  const finishGesture = () => {
    const active = gesture.current;
    gesture.current = null;
    if (!active) return;
    if (active.startingValue === active.latest) {
      // The slider previews pixels, while the original width may be unset or
      // expressed in another unit. Restore the exact original declaration when
      // the user returns to the starting pixel value instead of leaving an
      // unsaved inline preview behind.
      const restore = { ...active.operation, after: active.before };
      void previewQueue.current
        .then(() => api.previewStyle(restore))
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'Could not restore width');
        });
      return;
    }
    const transaction = {
      id: active.id,
      label: 'Set width',
      operations: [{ ...active.operation, after: active.latest }],
    };
    void previewQueue.current
      .then(() => api.commitEdit(transaction))
      .then(() => setError(null))
      .catch(async (reason: unknown) => {
        await api.previewStyle({ ...active.operation, after: active.before }).catch(() => undefined);
        setError(reason instanceof Error ? reason.message : 'Could not save width');
      });
  };

  const commitOperations = (operations: EditOperation[], label: string) => {
    // The Rust transaction applies the group as one rollback-capable unit.
    // Previewing each operation separately could leave a partial insert behind
    // if a later operation fails.
    void api.commitEdit({ id: transactionId(), label, operations })
      .then(() => setError(null))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not save edit'));
  };

  const commitOperation = (operation: EditOperation, label: string) => {
    commitOperations([operation], label);
  };

  const commitCssValue = (property: string, rawValue: string) => {
    if (!element) return;
    const value = rawValue.trim();
    const after = value || null;
    if (breakpointMode !== 'all') {
      const before = editedResponsiveStyleValue(element, property, breakpointMode, editHistory);
      if (before === after) return;
      const operation: SetResponsiveStyleOperation = {
        operation: 'set_responsive_style', identity: identityFor(element), property,
        breakpoint: breakpointMode, before, after,
      };
      commitOperation(operation, `Set ${property} for ${breakpointMode}`);
      return;
    }
    const before = editedInlineStyleValue(element, property, editHistory);
    if (before === after) return;
    const operation: SetStyleOperation = {
      operation: 'set_style',
      identity: identityFor(element),
      property,
      before,
      after,
    };
    commitOperation(operation, `Set ${property}`);
  };

  const adjustSpacing = (property: string, delta: number) => {
    if (!element) return;
    const current = styleValueForMode(element, property).trim();
    const match = current.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/i);
    if (current && !match) {
      setError(userMessage(`The ${property} value uses “${current}”. Enter a pixel value before using the stepper.`));
      return;
    }
    const next = Math.max(0, Number(match?.[1] ?? 0) + delta);
    commitCssValue(property, cssPixels(next));
  };

  const adjustGridColumns = (delta: number) => {
    if (!element) return;
    const current = styleValueForMode(element, 'grid-template-columns');
    const currentCount = gridTrackCount(current);
    const count = Math.max(1, Math.min(12, (currentCount || 2) + delta));
    commitCssValue('grid-template-columns', `repeat(${count}, minmax(0, 1fr))`);
  };

  const commitCssValues = (values: Array<[string, string | null]>, label: string) => {
    if (!element) return;
    const operations = values.flatMap<EditOperation>(([property, after]) => {
      const before = breakpointMode === 'all'
        ? editedInlineStyleValue(element, property, editHistory)
        : editedResponsiveStyleValue(element, property, breakpointMode, editHistory);
      if (before === after) return [];
      if (breakpointMode === 'all') return [{ operation: 'set_style' as const, identity: identityFor(element), property, before, after }];
      return [{ operation: 'set_responsive_style' as const, identity: identityFor(element), property, breakpoint: breakpointMode, before, after }];
    });
    if (operations.length) commitOperations(operations, label);
  };

  const applyLayoutRecipe = (recipe: 'stack' | 'row' | 'grid' | 'spread') => {
    const recipes: Record<typeof recipe, Array<[string, string | null]>> = {
      stack: [
        ['display', 'flex'], ['flex-direction', 'column'], ['flex-wrap', 'nowrap'],
        ['align-items', 'stretch'], ['justify-content', 'flex-start'], ['gap', '12px'],
      ],
      row: [
        ['display', 'flex'], ['flex-direction', 'row'], ['flex-wrap', 'wrap'],
        ['align-items', 'center'], ['justify-content', 'flex-start'], ['gap', '12px'],
      ],
      grid: [
        ['display', 'grid'], ['grid-template-columns', 'repeat(2, minmax(0, 1fr))'], ['gap', '12px'],
      ],
      spread: [
        ['display', 'flex'], ['flex-direction', 'row'], ['flex-wrap', 'wrap'],
        ['align-items', 'center'], ['justify-content', 'space-evenly'], ['gap', '12px'],
      ],
    };
    const labels = { stack: 'Stack vertically', row: 'Place side by side', grid: 'Make a 2-column grid', spread: 'Space items evenly' };
    commitCssValues(recipes[recipe], labels[recipe]);
  };

  const nudgeSelected = (axis: 'x' | 'y', direction: -1 | 1) => {
    if (!element) return;
    if ((moveConstraint === 'horizontal' && axis === 'y') || (moveConstraint === 'vertical' && axis === 'x')) return;
    const current = styleValueForMode(element, 'translate');
    const offset = pixelOffset(current);
    if (!offset) {
      setError(userMessage('Precise nudges need a pixel-based Position offset. Clear its custom CSS value or edit it directly first.'));
      return;
    }
    const nextX = axis === 'x' ? offset.x + direction * nudgeStep : offset.x;
    const nextY = axis === 'y' ? offset.y + direction * nudgeStep : offset.y;
    commitCssValue('translate', `${cssPixels(nextX)} ${cssPixels(nextY)}`);
  };

  const snapSelectedPosition = () => {
    if (!element || !snapGrid) return;
    const offset = pixelOffset(styleValueForMode(element, 'translate'));
    if (!offset) {
      setError(userMessage('Grid snapping needs a pixel-based Position offset. Edit that value directly first.'));
      return;
    }
    const snap = (value: number) => Math.round(value / snapGrid) * snapGrid;
    commitCssValue('translate', `${cssPixels(snap(offset.x))} ${cssPixels(snap(offset.y))}`);
  };

  const centerSelectedOnPreview = () => {
    if (!element || !liveViewportWidth || !liveViewportHeight) {
      setError(userMessage('The preview size is not available yet. Refresh the selected element and try again.'));
      return;
    }
    const offset = pixelOffset(styleValueForMode(element, 'translate'));
    if (!offset) {
      setError(userMessage('Centering needs a pixel-based position offset. Clear its custom CSS value or edit it directly first.'));
      return;
    }
    const bounds = element.snapshot.css_bounds;
    const nextX = offset.x + liveViewportWidth / 2 - (bounds.x + bounds.width / 2);
    const nextY = offset.y + liveViewportHeight / 2 - (bounds.y + bounds.height / 2);
    commitCssValue('translate', `${cssPixels(nextX)} ${cssPixels(nextY)}`);
  };

  const alignSelectedElements = (axis: 'x' | 'y', mode: 'start' | 'center' | 'end' | 'distribute') => {
    if (alignableElements.length < (mode === 'distribute' ? 3 : 2)) return;
    const items = alignableElements.map((candidate) => {
      const bounds = candidate.snapshot.css_bounds;
      // Snapshot bounds are from when the element was selected; every alignment
      // moves it with `translate`, so earlier alignments must be included or a
      // second one works from the old positions and scatters the group.
      const shift = pixelOffset(editedStyleValue(candidate, 'translate', editHistory)) ?? { x: 0, y: 0 };
      const start = (axis === 'x' ? bounds.x + shift.x : bounds.y + shift.y);
      const size = axis === 'x' ? bounds.width : bounds.height;
      return { candidate, start, size, center: start + size / 2, end: start + size };
    });
    const targets = new Map<SelectedElement, number>();
    if (mode === 'distribute') {
      const sorted = [...items].sort((a, b) => a.start - b.start);
      const span = sorted[sorted.length - 1].end - sorted[0].start;
      const gap = (span - sorted.reduce((sum, item) => sum + item.size, 0)) / (sorted.length - 1);
      let cursor = sorted[0].start;
      for (const item of sorted) {
        targets.set(item.candidate, cursor);
        cursor += item.size + gap;
      }
    } else {
      const edge = mode === 'start'
        ? Math.min(...items.map((item) => item.start))
        : mode === 'end'
          ? Math.max(...items.map((item) => item.end))
          : (Math.min(...items.map((item) => item.start)) + Math.max(...items.map((item) => item.end))) / 2;
      for (const item of items) {
        targets.set(item.candidate, mode === 'start' ? edge : mode === 'end' ? edge - item.size : edge - item.size / 2);
      }
    }

    const operations: EditOperation[] = [];
    for (const item of items) {
      const offset = pixelOffset(editedStyleValue(item.candidate, 'translate', editHistory));
      if (!offset) {
        setError(userMessage('Aligning these items needs pixel-based position offsets. Edit the custom offsets first.'));
        return;
      }
      const delta = (targets.get(item.candidate) ?? item.start) - item.start;
      if (Math.abs(delta) < 0.01) continue;
      const before = editedInlineStyleValue(item.candidate, 'translate', editHistory);
      const afterX = axis === 'x' ? offset.x + delta : offset.x;
      const afterY = axis === 'y' ? offset.y + delta : offset.y;
      operations.push({
        operation: 'set_style',
        identity: identityFor(item.candidate),
        property: 'translate',
        before,
        after: `${cssPixels(afterX)} ${cssPixels(afterY)}`,
      });
    }
    if (operations.length) {
      const labels = {
        x: { start: 'Align left', center: 'Align horizontal centers', end: 'Align right', distribute: 'Distribute horizontally' },
        y: { start: 'Align top', center: 'Align vertical centers', end: 'Align bottom', distribute: 'Distribute vertically' },
      };
      commitOperations(operations, labels[axis][mode]);
    }
  };

  const commitText = (after: string, textIndex = 0) => {
    if (!element) return;
    const before = editedTextValue(element, editHistory, textIndex);
    if (before === after) return;
    const operation: SetTextOperation = {
      operation: 'set_text',
      identity: identityFor(element),
      before,
      after,
      text_index: textIndex,
    };
    commitOperation(operation, 'Edit text');
  };

  const currentTextBinding = element ? textBindingValue(element, editHistory) : null;
  const bindSelectedText = () => {
    if (!element || !textBindingSource || element.snapshot.editable_text == null) return;
    if (element.id === textBindingSource.id) {
      setError(userMessage('Choose a different element as the text source'));
      return;
    }
    const before = currentTextBinding;
    const after = identityFor(textBindingSource);
    if (before && JSON.stringify(before) === JSON.stringify(after)) return;
    commitOperation({ operation: 'set_text_binding', identity: identityFor(element), before, after, before_text: element.snapshot.editable_text }, 'Bind text to UI data');
  };
  const unlinkSelectedText = () => {
    if (!element || !currentTextBinding) return;
    commitOperation({ operation: 'set_text_binding', identity: identityFor(element), before: currentTextBinding, after: null, before_text: element.snapshot.editable_text ?? '' }, 'Unlink text source');
  };

  const sourceCoordinate = element ? attribute(element, 'data-hardlyui-source') : null;
  const sourceSeparator = sourceCoordinate?.lastIndexOf(':') ?? -1;
  const sourceFile = sourceSeparator > 0 ? sourceCoordinate!.slice(0, sourceSeparator) : null;
  const sourceOffset = sourceSeparator > 0 ? Number(sourceCoordinate!.slice(sourceSeparator + 1)) : NaN;
  const previewSourceChange = async (edit: { before: string; after: string; property?: string; sourceKind?: 'insert' }) => {
    if (!sourceBaseUrl || !sourceFile || !Number.isSafeInteger(sourceOffset)) return;
    try {
      const response = await fetch(new URL('/__hardlyui/source-text', sourceBaseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edit.sourceKind === 'insert'
          ? { action: 'preview', kind: 'insert', file: sourceFile, offset: sourceOffset, markup: edit.after }
          : edit.property
          ? { action: 'preview', kind: 'style', file: sourceFile, offset: sourceOffset, property: edit.property, expectedStyle: edit.before, value: edit.after }
          : { action: 'preview', kind: 'text', file: sourceFile, offset: sourceOffset, expected: edit.before, value: edit.after }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not preview source edit');
      setSourceReview({ baseUrl: sourceBaseUrl, file: sourceFile, offset: sourceOffset, ...edit, revision: result.revision, beforeCode: result.beforeCode ?? '', afterCode: result.afterCode ?? '' });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not preview source edit');
    }
  };
  const commitSourceText = async (value: string) => {
    if (!sourceBaseUrl || !sourceFile || !Number.isSafeInteger(sourceOffset) || !element) return;
    const before = element.snapshot.editable_text;
    if (before == null || before === value) return;
    await previewSourceChange({ before, after: value });
  };
  const commitSourceStyle = async (property: string, value: string) => {
    if (!sourceBaseUrl || !sourceFile || !Number.isSafeInteger(sourceOffset) || !element) return;
    const before = inlineStyle(element, property) ?? '';
    const after = value.trim();
    if (before === after) return;
    await previewSourceChange({ before, after, property });
  };
  const applySourceReview = async () => {
    if (!sourceReview) return;
    try {
      const response = await fetch(new URL('/__hardlyui/source-text', sourceReview.baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sourceReview.sourceKind === 'insert'
          ? { action: 'insert', file: sourceReview.file, offset: sourceReview.offset, markup: sourceReview.after, revision: sourceReview.revision }
          : sourceReview.property
          ? { action: 'style', file: sourceReview.file, offset: sourceReview.offset, property: sourceReview.property, expectedStyle: sourceReview.before, value: sourceReview.after, revision: sourceReview.revision }
          : { action: 'text', file: sourceReview.file, offset: sourceReview.offset, expected: sourceReview.before, value: sourceReview.after, revision: sourceReview.revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Source edit failed');
      setSourceUndo(sourceReview);
      setSourceRedo(false);
      setSourceReview(null);
      setError(null);
      recordAction('source', sourceReview.sourceKind === 'insert'
        ? 'Inserted markup into the source'
        : sourceReview.property
        ? `Wrote ${sourceReview.property} to the source`
        : 'Edited text in the source');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not write source');
    }
  };
  const undoSourceText = async () => {
    if (!sourceUndo) return;
    try {
      const response = await fetch(new URL('/__hardlyui/source-text', sourceUndo.baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Source undo failed');
      setSourceUndo(result.canUndo ? sourceUndo : null);
      setSourceRedo(Boolean(result.canRedo));
      setError(null);
      if (peekUndo()?.lane === 'source') back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not undo source edit');
    }
  };
  const redoSource = async () => {
    if (!sourceBaseUrl || !sourceRedo) return;
    try {
      const response = await fetch(new URL('/__hardlyui/source-text', sourceBaseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'redo' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Source redo failed');
      setSourceRedo(Boolean(result.canRedo));
      setError(null);
      if (peekRedo()?.lane === 'source') forward();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not redo source edit');
    }
  };

  /**
   * One Undo for both lanes: the session log says which lane owns the newest
   * action. With no log (a reloaded window) it falls back to the manifest
   * history, which the plugin keeps.
   */
  const undoAny = async () => {
    if (peekUndo()?.lane === 'source') {
      await undoSourceText();
      return;
    }
    try {
      const undone = await api.undoEdit();
      setError(undone ? null : 'Nothing left to undo in the saved edits');
    } catch (reason) {
      setError(String(reason));
    }
  };
  const redoAny = async () => {
    if (peekRedo()?.lane === 'source') {
      await redoSource();
      return;
    }
    try {
      const redone = await api.redoEdit();
      setError(redone ? null : 'Nothing left to redo in the saved edits');
    } catch (reason) {
      setError(String(reason));
    }
  };

  const undoLabel = peekUndo()?.label ?? null;
  const redoLabel = peekRedo()?.label ?? null;
  // Journal first, then the lanes: a reloaded window has no journal yet but
  // the manifest history (and its redo stack) is still there.
  const canUndoAny = canUndo || actionLog.cursor > 0;
  const canRedoAny = canRedo || actionLog.cursor < actionLog.entries.length;

  const insertPreset = (presetId: string) => {
    if (!element) return;
    const preset = insertPresets.find(({ id }) => id === presetId);
    if (!preset) return;
    const operations: EditOperation[] = [];
    const appendPreset = (node: InsertPresetNode, parent: SetStyleOperation['identity']) => {
      const identity: SetStyleOperation['identity'] = {
        webview_id: parent.webview_id,
        inspector_id: null,
        html_id: null,
        semantic_selector: null,
        generated_id: elementId(),
      };
      operations.push({
        operation: 'insert_element', parent, identity, tag: node.tag,
        text: node.text, class_names: node.classNames,
      });
      operations.push(...node.styles.map(([property, after]) => ({
        operation: 'set_style' as const, identity, property, before: null, after,
      })));
      node.children?.forEach((child) => appendPreset(child, identity));
    };
    appendPreset(preset, identityFor(element));
    commitOperations(operations, `Add ${preset.label}`);
  };

  const insertPicture = (url: string, name: string) => {
    if (!element) return;
    const identity: SetStyleOperation['identity'] = {
      webview_id: element.snapshot.webview_id,
      inspector_id: null,
      html_id: null,
      semantic_selector: null,
      generated_id: elementId(),
    };
    commitOperations([
      {
        operation: 'insert_element',
        parent: identityFor(element),
        identity,
        tag: 'img',
        text: name,
        class_names: [],
        image_url: url,
      },
    ], 'Insert picture');
  };

  const savePresetAsReusable = async (presetId: string) => {
    const preset = insertPresets.find(({ id }) => id === presetId);
    if (!preset) return;
    const toSavedNode = (node: InsertPresetNode): SavedComponentNode => ({
      tag: node.tag,
      text: node.text,
      class_names: node.classNames,
      styles: node.styles,
      children: node.children?.map(toSavedNode) ?? [],
    });
    const node = toSavedNode(preset);
    const component: SavedComponent = {
      id: elementId(),
      name: preset.label,
      ...node,
    };
    const next = [...componentLibrary, component].slice(-100);
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setComponentTextProps((current) => ({ ...current, ...collectComponentTextProps(component, component.id) }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not save ${preset.label}`);
    }
  };

  const saveSelectedComponent = async () => {
    const markup = element?.snapshot.reusable_html ?? element?.snapshot.outer_html;
    if (!element || !markup) {
      setError(userMessage('The selected element has no reusable markup snapshot'));
      return;
    }
    const styleProperties = [
      'display', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'grid-template-columns', 'order', 'align-items', 'align-self', 'justify-content', 'gap', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'translate',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'border-radius', 'border-width', 'border-color',
    ];
    const parsed = new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild;
    if (!parsed) {
      setError(userMessage('Could not read the selected element markup'));
      return;
    }
    let nodeCount = 0;
    const allowedTags = new Set(['div', 'p', 'span', 'button', 'img']);
    const buildNode = (source: Element, depth: number): SavedComponentNode => {
      nodeCount += 1;
      if (depth > 8 || nodeCount > 50) throw new Error('Reusable groups are limited to 50 elements and 8 levels');
      if (['script', 'style', 'iframe', 'object', 'embed'].includes(source.tagName.toLowerCase())) {
        throw new Error(`Cannot reuse active content: <${source.tagName.toLowerCase()}>`);
      }
      const sourceTag = source.tagName.toLowerCase();
      const imageUrl = sourceTag === 'img' ? source.getAttribute('src') : null;
      if (sourceTag === 'img' && (!imageUrl || !safeArtworkUrl(imageUrl))) {
        throw new Error('This image uses an unsupported address. Use HTTPS or a local app asset path.');
      }
      const tag = allowedTags.has(sourceTag)
        ? sourceTag as SavedComponentNode['tag']
        : depth === 0 ? 'div' : 'span';
      const classNames = [...source.classList].filter((name) => /^[\w:/\[\].#%-]{1,128}$/.test(name)).slice(0, 32);
      const styles = styleProperties.flatMap((property) => {
        const inlineValue = (source as HTMLElement).style?.getPropertyValue(property) ?? '';
        const value = (depth === 0 ? computedStyle(element, property) || inlineValue : inlineValue).trim();
        return value && !['auto', 'normal', 'none'].includes(value) ? [[property, value] as [string, string]] : [];
      });
      const directText = [...source.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? '')
        .join(' ')
        .trim();
      return {
        tag,
        text: tag === 'img' ? (source.getAttribute('alt') ?? '').slice(0, 500) : depth === 0 && element.snapshot.editable_text != null ? element.snapshot.editable_text.slice(0, 500) : directText.slice(0, 500),
        class_names: classNames,
        styles,
        ...(tag === 'img' ? { image_url: imageUrl! } : {}),
        children: [...source.children].map((child) => buildNode(child, depth + 1)),
      };
    };
    let node: SavedComponentNode;
    try {
      node = buildNode(parsed, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save reusable element');
      return;
    }
    const component: SavedComponent = {
      id: elementId(),
      name: componentName.trim().slice(0, 64) || `Reusable ${node.tag}`,
      ...node,
    };
    const next = [...componentLibrary, component].slice(-100);
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setComponentTextProps((current) => ({ ...current, ...collectComponentTextProps(component, component.id) }));
      setComponentSvelteBindings((current) => ({ ...current, ...Object.fromEntries(Object.entries(component.svelte_bindings ?? {}).map(([path, expression]) => [`${component.id}:${path}`, expression])) }));
      setComponentName(`${component.name} copy`);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save reusable element');
    }
  };

  const insertSavedComponent = (component: SavedComponent, textProp: string) => {
    if (!element) return;
    const operations: EditOperation[] = [];
    const textTargets: Array<{ identity: SetStyleOperation['identity']; text: string }> = [];
    const appendNode = (node: SavedComponentNode, parent: SetStyleOperation['identity'], path: number[] = []) => {
      const nodeIdentity: SetStyleOperation['identity'] = {
        webview_id: parent.webview_id, inspector_id: null, html_id: null,
        semantic_selector: null, generated_id: elementId(),
      };
      const text = (componentTextProps[`${component.id}:${path.join('.')}`] ?? node.text).slice(0, 500);
      operations.push({
        operation: 'insert_element', parent, identity: nodeIdentity,
        tag: node.tag, text, class_names: node.class_names, slot_name: node.slot_name ?? null, image_url: node.image_url ?? null,
      });
      operations.push(...node.styles.map(([property, after]) => ({
        operation: 'set_style' as const, identity: nodeIdentity, property, before: null, after,
      })));
      if (node.children.length === 0) textTargets.push({ identity: nodeIdentity, text });
      node.children.forEach((child, index) => appendNode(child, nodeIdentity, [...path, index]));
      return nodeIdentity;
    };
    appendNode(component, identityFor(element));
    if (textBindingSource && component.children.length === 0 && textTargets.length > 0) {
      const target = textTargets[0];
      operations.push({
        operation: 'set_text_binding', identity: target.identity, before: null,
        after: identityFor(textBindingSource), before_text: target.text,
      });
    }
    commitOperations(operations, `Insert ${component.name}`);
  };

  const removeSavedComponent = async (id: string) => {
    const next = componentLibrary.filter((component) => component.id !== id);
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove reusable element');
    }
  };

  const renameSavedComponent = async (id: string, rawName: string) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) return;
    const next = componentLibrary.map((component) => component.id === id ? { ...component, name } : component);
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename reusable element');
    }
  };

  const saveComponentTextProp = async (id: string, path: number[], rawValue: string) => {
    const text = rawValue.slice(0, 500);
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const updateNode = (node: SavedComponentNode, depth: number): SavedComponentNode => {
        if (depth >= path.length) return { ...node, text };
        const childIndex = path[depth];
        return { ...node, children: node.children.map((child, index) => index === childIndex ? updateNode(child, depth + 1) : child) };
      };
      return updateNode(component, 0) as SavedComponent;
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save component text property');
    }
  };

  const saveComponentArtworkProp = async (id: string, path: number[], rawValue: string) => {
    const imageUrl = rawValue.trim();
    if (!safeArtworkUrl(imageUrl)) {
      setError(userMessage('Use an HTTPS image address or a local app asset path'));
      return;
    }
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const updateNode = (node: SavedComponentNode, depth: number): SavedComponentNode => {
        if (depth >= path.length) return { ...node, image_url: imageUrl };
        const childIndex = path[depth];
        return { ...node, children: node.children.map((child, index) => index === childIndex ? updateNode(child, depth + 1) : child) };
      };
      return updateNode(component, 0) as SavedComponent;
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setComponentArtworkProps((current) => ({ ...current, [`${id}:${path.join('.')}`]: imageUrl }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save artwork');
    }
  };

  const saveComponentClassProp = async (id: string, path: number[], rawValue: string) => {
    const classNames = [...new Set(rawValue.split(/\s+/).filter(Boolean))].slice(0, 32);
    if (classNames.some((name) => !/^[\w:/\[\].#%-]{1,128}$/.test(name))) {
      setError(userMessage('Class names can use letters, numbers, spaces, _ - : / [ ] . # %'));
      return;
    }
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const updateNode = (node: SavedComponentNode, depth: number): SavedComponentNode => {
        if (depth >= path.length) return { ...node, class_names: classNames };
        const childIndex = path[depth];
        return { ...node, children: node.children.map((child, index) => index === childIndex ? updateNode(child, depth + 1) : child) };
      };
      return updateNode(component, 0) as SavedComponent;
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save component classes');
    }
  };

  const saveComponentStyleProp = async (id: string, path: number[], property: string, rawValue: string) => {
    const allowed = new Set(['background-color', 'color', 'border-radius', 'padding']);
    if (!allowed.has(property) || rawValue.length > 256 || /[{};]/.test(rawValue)) {
      setError(userMessage('That appearance setting is not supported'));
      return;
    }
    const value = rawValue.trim();
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const updateNode = (node: SavedComponentNode, depth: number): SavedComponentNode => {
        if (depth >= path.length) {
          const styles = node.styles.filter(([name]) => name !== property);
          if (value) styles.push([property, value]);
          return { ...node, styles };
        }
        const childIndex = path[depth];
        return { ...node, children: node.children.map((child, index) => index === childIndex ? updateNode(child, depth + 1) : child) };
      };
      return updateNode(component, 0) as SavedComponent;
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save component appearance');
    }
  };

  const saveComponentSlot = async (id: string, path: number[], rawValue: string) => {
    const slotName = rawValue.trim();
    if (slotName && !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(slotName)) {
      setError(userMessage('Slot name must start with a letter and use only letters, numbers, _ or -'));
      return;
    }
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const updateNode = (node: SavedComponentNode, depth: number): SavedComponentNode => {
        if (depth >= path.length) {
          const { slot_name: _previous, ...withoutSlot } = node;
          return slotName ? { ...withoutSlot, slot_name: slotName } : withoutSlot;
        }
        const childIndex = path[depth];
        return { ...node, children: node.children.map((child, index) => index === childIndex ? updateNode(child, depth + 1) : child) };
      };
      return updateNode(component, 0) as SavedComponent;
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save component slot');
    }
  };

  const saveComponentSvelteBinding = async (id: string, path: number[], rawValue: string) => {
    const expression = rawValue.trim();
    if (expression && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression)) {
      setError(userMessage('Use a Svelte variable or dotted property path, such as book.title'));
      return;
    }
    const key = path.length ? path.join('.') : '$';
    const next = componentLibrary.map((component) => {
      if (component.id !== id) return component;
      const bindings = { ...(component.svelte_bindings ?? {}) };
      if (expression) bindings[key] = expression;
      else delete bindings[key];
      return { ...component, svelte_bindings: bindings };
    });
    try {
      await api.saveComponentLibrary(next);
      setComponentLibrary(next);
      setComponentSvelteBindings((current) => {
        const values = { ...current };
        const propKey = `${id}:${key}`;
        if (expression) values[propKey] = expression;
        else delete values[propKey];
        return values;
      });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save Svelte binding');
    }
  };

  const componentWithTextProps = (component: SavedComponent): SavedComponent => {
    const apply = (node: SavedComponentNode, path: number[] = []): SavedComponentNode => ({
      ...node,
      text: componentTextProps[`${component.id}:${path.join('.')}`] ?? node.text,
      children: node.children.map((child, index) => apply(child, [...path, index])),
    });
    const bindings = Object.fromEntries(Object.entries(componentSvelteBindings)
      .filter(([key]) => key.startsWith(`${component.id}:`))
      .map(([key, expression]) => [key.slice(component.id.length + 1), expression]));
    return { ...component, ...apply(component), svelte_bindings: bindings };
  };

  const componentMarkupFor = (component: SavedComponent, includeSvelteBindings = false) => {
    const customized = componentWithTextProps(component);
    return exportSavedComponentMarkup(customized, includeSvelteBindings ? customized.svelte_bindings : undefined);
  };

  const insertComponentIntoSource = async (component: SavedComponent) => {
    if (!sourceBaseUrl || !sourceFile || !Number.isSafeInteger(sourceOffset)) {
      setError(userMessage('Select a source-mapped Svelte element before inserting component markup'));
      return;
    }
    await previewSourceChange({
      before: '',
      after: componentMarkupFor(component, true),
      sourceKind: 'insert',
    });
  };

  const copyComponentSource = async (component: SavedComponent) => {
    try {
      await navigator.clipboard.writeText(componentMarkupFor(component));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not copy component source');
    }
  };

  const createVersion = async () => {
    const label = versionLabel.trim();
    if (!label) return;
    try {
      const version = await api.saveVersion(label);
      setVersions((current) => [version, ...current]);
      setPreviewVersion(version);
      setVersionLabel('');
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save edit version');
    }
  };

  const restoreVersion = async (version: EditVersion) => {
    const ok = await confirm.ask({
      title: `Restore the checkpoint “${version.label}”?`,
      body: 'Your current edits are saved as a recovery checkpoint first, so the restore can be undone.',
      confirmLabel: 'Restore checkpoint',
    });
    if (!ok) return;
    try {
      await api.restoreVersion(version.id);
      setVersions(await api.listVersions());
      setPreviewVersion(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not restore edit version');
    }
  };

  const deleteVersion = async (version: EditVersion) => {
    const ok = await confirm.ask({
      title: `Delete the checkpoint “${version.label}”?`,
      body: 'This removes its snapshot file, including the captured picture. It cannot be undone and published versions are not affected.',
      confirmLabel: 'Delete checkpoint',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteVersion(version.id);
      setVersions((current) => current.filter((item) => item.id !== version.id));
      setPreviewVersion((current) => (current?.id === version.id ? null : current));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete edit version');
    }
  };

  const pruneVersions = async () => {
    const keep = 20;
    const ok = await confirm.ask({
      title: `Keep only the newest ${keep} checkpoints?`,
      body: 'Every older checkpoint and its snapshot file is deleted. Published versions are always kept.',
      confirmLabel: 'Delete older checkpoints',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.pruneVersions(keep);
      setVersions(await api.listVersions());
      setPreviewVersion(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prune edit versions');
    }
  };

  /** Publishes the current draft and refreshes both lists around it. */
  const publishDraft = async () => {
    try {
      const result = await api.publishProject(publishLabel);
      setPublishLabel('');
      setVersions(await api.listVersions());
      setPublished(await api.listPublished());
      setPreviewVersion(null);
      setError(null);
      setPublishNote(
        result.media.length === 0
          ? `Published “${result.version.label}”. No pictures were used.`
          : result.media_url_works
          ? `Published “${result.version.label}”. ${result.media.length} picture${result.media.length === 1 ? '' : 's'} copied into ${result.media_folder}.`
          : `Published “${result.version.label}”. ${result.media.length} picture${result.media.length === 1 ? '' : 's'} kept in ${result.media_folder}; this project has no folder the built site serves, so those addresses will not resolve until you move them into one.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : userMessage('Could not publish the draft'));
    }
  };

  /** Restores a published restore point by its version id. */
  const restorePublished = async (entry: PublishedEntry) => {
    const version = versions.find((item) => item.id === entry.id);
    if (!version) {
      setError(userMessage('That published version is no longer on disk, so it cannot be restored. Publish the current draft again to make a new restore point.'));
      return;
    }
    await restoreVersion(version);
  };

  const removeElement = () => {
    if (!element) return;
    const parentPath = element.snapshot.parent_dom_path;
    const outerHtml = element.snapshot.outer_html;
    if (!parentPath || !outerHtml) {
      setError('This element cannot be safely removed');
      return;
    }
    const operation: EditOperation = {
      operation: 'remove_element',
      identity: identityFor(element),
      parent: identityForPath(element.snapshot.webview_id, parentPath),
      position: Math.max(0, element.snapshot.parent_child_index ?? 0),
      outer_html: outerHtml,
    };
    commitOperation(operation, 'Remove element');
  };

  const layoutFacts = new Map(element?.snapshot.computed_layout ?? []);
  const childCount = (() => {
    if (!element?.snapshot.outer_html) return 0;
    const root = new DOMParser().parseFromString(element.snapshot.outer_html, 'text/html').body.firstElementChild;
    return root?.children.length ?? 0;
  })();
  const layoutSuggestions: FixSuggestion[] = [];
  const spacingTokenFor = (pixels: number) => nearestToken(designTokens.spacing, pixels, 2, 0);
  const display = layoutFacts.get('display') ?? '';
  const flexDirection = layoutFacts.get('flex-direction') ?? 'row';
  const isColumn = flexDirection.startsWith('column');
  const measuredChildren = element?.snapshot.layout_children?.filter((child) =>
    child.width > 0 && child.height > 0 && child.position !== 'absolute' && child.position !== 'fixed') ?? [];
  const fittedChildWidth = measuredChildren.reduce((total, child) => total + child.width, 0);
  const measuredRowWidth = element?.snapshot.css_bounds.width ?? 0;
  const measuredOverflow = element != null && !isColumn && measuredChildren.length >= 2
    && fittedChildWidth > measuredRowWidth;
  if (element && display === 'flex' && !isColumn && (layoutFacts.get('flex-wrap') ?? 'nowrap') === 'nowrap'
    && (measuredOverflow || (childCount >= 3 && element.snapshot.css_bounds.width <= 440))) {
    layoutSuggestions.push({
      title: 'Let this row wrap on narrow screens',
      detail: measuredOverflow
        ? `${measuredChildren.length} items need ${Math.round(fittedChildWidth)} px inside a ${Math.round(element.snapshot.css_bounds.width)} px row. Wrapping lets the extra items move to a new line.`
        : `${childCount} items share a ${Math.round(element.snapshot.css_bounds.width)} px row. Wrapping helps prevent crowding.`,
      property: 'flex-wrap', value: 'wrap', kind: 'layout',
    });
  }
  if (element && display === 'flex' && measuredChildren.length >= 2) {
    const centers = measuredChildren.map((child) => isColumn ? child.x + child.width / 2 : child.y + child.height / 2);
    const drift = Math.max(...centers) - Math.min(...centers);
    if (drift > 4 && layoutFacts.get('align-items') !== 'center') {
      layoutSuggestions.push({
        title: `Center these items on the ${isColumn ? 'horizontal' : 'vertical'} axis`,
        detail: `Measured item centers drift by ${Math.round(drift)} px. Center alignment evens out the group.`,
        property: 'align-items', value: 'center', kind: 'layout',
      });
    }
    const marginsAreClear = measuredChildren.every((child) => isColumn
      ? Math.abs(child.margin_top) < 1 && Math.abs(child.margin_bottom) < 1
      : Math.abs(child.margin_left) < 1 && Math.abs(child.margin_right) < 1);
    if (measuredChildren.length >= 3
      && ['0px', 'normal', ''].includes(layoutFacts.get('gap') ?? '')
      && marginsAreClear) {
      const crossAxisCenters = measuredChildren.map((child) => isColumn ? child.x + child.width / 2 : child.y + child.height / 2);
      if (Math.max(...crossAxisCenters) - Math.min(...crossAxisCenters) <= 4) {
        const ordered = [...measuredChildren].sort((a, b) => isColumn ? a.y - b.y : a.x - b.x);
        const gaps = ordered.slice(1).map((child, index) => isColumn
          ? child.y - (ordered[index]!.y + ordered[index]!.height)
          : child.x - (ordered[index]!.x + ordered[index]!.width));
        if (gaps.every((gap) => gap >= 0) && Math.max(...gaps) - Math.min(...gaps) >= 4) {
          const midpoint = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 8;
          const step = [4, 8, 12, 16, 24, 32].reduce((closest, candidate) => Math.abs(candidate - midpoint) < Math.abs(closest - midpoint) ? candidate : closest, 8);
          const token = spacingTokenFor(midpoint) ?? spacingTokenFor(step);
          const range = `Measured gaps vary from ${Math.round(Math.min(...gaps))} to ${Math.round(Math.max(...gaps))} px.`;
          layoutSuggestions.push({
            title: 'Even out the space between items',
            detail: token
              ? `${range} A shared ${token.token.name} (${token.token.value}) gap keeps this group on the project scale.`
              : `${range} A shared ${step} px gap is a tidy starting point.`,
            property: 'gap', value: token ? cssVariable(token.token) : `${step}px`, kind: 'layout',
          });
        }
      }
    }
  }
  if (element && (display === 'flex' || display === 'grid') && childCount >= 2 && ['0px', 'normal', ''].includes(layoutFacts.get('gap') ?? '')) {
    const token = nearestToken(designTokens.spacing, 8, 0.5, 0);
    layoutSuggestions.push({
      title: 'Add a consistent gap',
      detail: token
        ? `A shared gap gives these items clear, even spacing. Matches ${token.token.name} (${token.token.value}).`
        : 'A shared 8 px gap gives these items clear, even spacing.',
      property: 'gap', value: token ? cssVariable(token.token) : '8px', kind: 'layout',
    });
  }
  // Normalize literal spacing, radius, and type sizes onto the discovered host scales.
  const tokenSuggestions: FixSuggestion[] = [];
  if (element) {
    const scales = [
      ['gap', 'Item spacing', designTokens.spacing, 4],
      ['padding', 'Inside spacing', designTokens.spacing, 4],
      ['margin', 'Outside spacing', designTokens.spacing, 4],
      ['border-radius', 'Corner radius', designTokens.radius, 2],
      ['font-size', 'Text size', designTokens.typography, 1],
    ] as const;
    for (const [property, label, tokens, tolerance] of scales) {
      const current = styleValueForMode(element, property);
      if (!current) continue;
      const fix = normalizeShorthand(current, tokens, tolerance, rootFontPx);
      if (!fix) continue;
      tokenSuggestions.push({
        title: `Snap ${label.toLowerCase()} to the project scale`,
        detail: `${fix.before} → ${fix.after} · ${[...new Set(fix.labels)].slice(0, 2).join(', ')}`,
        property, value: fix.after, kind: 'token',
      });
    }
  }
  const fixSuggestions = [...layoutSuggestions, ...tokenSuggestions];

  const previewLayoutSuggestion = (property: string, value: string) => {
    if (!element) return;
    const before = breakpointMode === 'all'
      ? editedInlineStyleValue(element, property, editHistory)
      : editedResponsiveStyleValue(element, property, breakpointMode, editHistory);
    const operation: SetStyleOperation | SetResponsiveStyleOperation = breakpointMode === 'all'
      ? { operation: 'set_style', identity: identityFor(element), property, before, after: value }
      : { operation: 'set_responsive_style', identity: identityFor(element), property, breakpoint: breakpointMode, before, after: value };
    void api.previewStyle(operation).then(() => { setLayoutPreview(operation); setError(null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not preview this layout change'));
  };

  const cancelLayoutPreview = () => {
    if (!layoutPreview) return;
    void api.previewStyle({ ...layoutPreview, before: layoutPreview.after, after: layoutPreview.before })
      .then(() => setLayoutPreview(null))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not undo the preview'));
  };

  const applyLayoutPreview = () => {
    if (!layoutPreview) return;
    void api.commitEdit({ id: transactionId(), label: 'Apply layout suggestion', operations: [layoutPreview] })
      .then(() => { setLayoutPreview(null); setError(null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not save the layout suggestion'));
  };

  return (
    <section className="mb-3 max-h-[52vh] shrink-0 overflow-y-auto rounded-md border border-[var(--inspector-border)] bg-[#161b22] p-2">
      <ConfirmDialog request={confirm.request} onSettle={confirm.settle} />
      <StructureNavigator selected={selectedElements.at(-1) ?? element} editHistory={editHistory} />
      {fixSuggestions.length > 0 && <details className="mb-2 rounded border border-[var(--inspector-border)] p-1.5">
        <summary className="cursor-pointer text-[12px] font-semibold">Suggested fixes ({fixSuggestions.length})</summary>
        {layoutPreview ? <div className="mt-1 rounded bg-[#0d1117] p-1.5 text-[11px]">
          <p>Preview: {layoutPreview.property}{layoutPreview.operation === 'set_responsive_style' ? ` · ${layoutPreview.breakpoint}` : ''} → {layoutPreview.after}</p>
          <div className="mt-1 flex gap-1"><button type="button" className="rounded border border-[var(--inspector-accent)] px-1.5 py-0.5" onClick={applyLayoutPreview}>Apply</button><button type="button" className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5" onClick={cancelLayoutPreview}>Cancel preview</button></div>
        </div> : <div className="mt-1 grid gap-1">{fixSuggestions.map((suggestion) => <div className="rounded bg-[#0d1117] p-1.5" key={`${suggestion.kind}-${suggestion.property}-${suggestion.title}`}>
          <div className="text-[11px] uppercase tracking-wide text-[var(--inspector-muted)]">{suggestion.kind === 'token' ? <FieldLabel label="Design token" property="token" /> : 'Layout'}</div>
          <div className="text-[11px] font-medium">{suggestion.title}</div><div className="text-[11px] text-[var(--inspector-muted)]">{suggestion.detail}</div>
          <button type="button" className="mt-1 rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]" onClick={() => previewLayoutSuggestion(suggestion.property, suggestion.value)}>Preview fix</button>
        </div>)}</div>}
      </details>}
      <label className="mb-2 flex items-center gap-1 text-[11px] text-[var(--inspector-muted)]">
        <span className="shrink-0"><FieldLabel label="Property edits apply to" property="breakpoint" /></span>
        <select aria-label="Property edit breakpoint" className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" value={breakpointMode} onChange={(event) => setBreakpointMode(event.currentTarget.value as typeof breakpointMode)}>
          <option value="all">All screen sizes</option><option value="phone">Phone only · up to 600 px</option><option value="tablet">Tablet only · 601–1024 px</option><option value="desktop">Desktop only · 1025 px and up</option>
        </select>
      </label>
      <p className="-mt-1 mb-1 text-[11px] text-[var(--inspector-muted)]">Current view: {liveViewportLabel}. Property edits can be size-specific; canvas drag and resize apply to all sizes.</p>
      <div className="mb-2 rounded border border-[var(--inspector-border)] p-1.5">
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold">Device preview</span>
          <span className="text-[11px] text-[var(--inspector-muted)]">{viewportPreview ? `${viewportPreview.width} × ${viewportPreview.height}` : 'Current size'}</span>
        </div>
        <div className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
          {(['Phone', 'Tablet', 'Desktop'] as const).map((group) => <div key={group}>
            <span className="text-[11px] font-medium text-[var(--inspector-muted)]">{group}</span>
            <div className="mt-0.5 grid grid-cols-2 gap-1">{viewportProfiles.filter((profile) => profile.group === group).map((profile) => <button
              key={profile.label}
              type="button"
              disabled={!element}
              aria-pressed={viewportPreview?.label === profile.label}
              className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-left text-[11px] aria-pressed:border-[var(--inspector-accent)] aria-pressed:bg-[rgba(88,166,255,0.12)] disabled:opacity-40"
              onClick={() => void changeViewportPreview(profile)}
            ><span className="block truncate">{profile.label}</span><span className="text-[11px] text-[var(--inspector-muted)]">{profile.width} × {profile.height}</span></button>)}</div>
          </div>)}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button
            type="button"
            disabled={!element || viewportPreview === null}
            className="flex-1 rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40"
            onClick={() => void changeViewportPreview(null)}
          >Restore original size</button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Resizes the app window to each CSS viewport. Browser chrome and safe areas are not emulated.</p>
      </div>
      <div className="mb-1 flex items-center justify-between">
        <strong className="text-[11px]">Selected width</strong>
        <span className="font-mono text-[11px] text-[var(--inspector-muted)]">{width}px</span>
      </div>
      <input
        aria-label="Selected element width"
        className="w-full accent-[var(--inspector-accent)]"
        type="range"
        min={0}
        max={Math.max(1200, width)}
        step={1}
        value={width}
        disabled={!element || !stableIdentity || breakpointMode !== 'all'}
        onPointerDown={beginGesture}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onKeyDown={beginGesture}
        onKeyUp={finishGesture}
        onBlur={finishGesture}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setWidth(next);
          preview(next);
        }}
      />
      {element && (element.snapshot.text_nodes?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1">
          {element.snapshot.text_nodes!.map((_, index, all) => (
            <TextContentField
              key={index}
              value={editedTextValue(element, editHistory, index)}
              label={all.length > 1 ? `Text ${index + 1} of ${all.length}` : 'Text content'}
              disabled={!stableIdentity}
              onCommit={(value) => commitText(value, index)}
            />
          ))}
          {(element.snapshot.text_nodes?.length ?? 0) > 1 && (
            <p className="text-[11px] text-[var(--inspector-muted)]">
              This element has more than one run of text. Each box edits one of them; anything nested inside stays as it is.
            </p>
          )}
        </div>
      )}
      {element && <div className="mt-1 flex flex-wrap items-center gap-1">
        <button className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px]" type="button" onClick={() => setTextBindingSource(element)}>Use selected as text source</button>
        {textBindingSource && <>
          <span className="max-w-28 truncate text-[11px] text-[var(--inspector-muted)]" title={textBindingSource.snapshot.text ?? ''}>Source: {textBindingSource.snapshot.text || textBindingSource.snapshot.tag}</span>
          <span className="w-full text-[11px] text-[var(--inspector-muted)]">New saved leaf inserts follow this source. Existing leaves can be bound below.</span>
          <button className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40" type="button" disabled={element.snapshot.editable_text == null || element.id === textBindingSource.id} onClick={bindSelectedText}>Bind selected text</button>
          <button className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px]" type="button" onClick={() => setTextBindingSource(null)}>Clear source</button>
        </>}
        {currentTextBinding && <><span className="text-[11px] text-[var(--inspector-accent)]">Text follows a live UI element</span><button className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px]" type="button" onClick={unlinkSelectedText}>Unlink</button></>}
      </div>}
      {sourceFile && sourceBaseUrl && (
        <div className="mt-2 rounded border border-[var(--inspector-border)] p-2">
          <div className="mb-1 truncate font-mono text-[11px] text-[var(--inspector-muted)]">Source: {sourceFile}</div>
          {element?.snapshot.editable_text != null && <TextContentField value={element.snapshot.editable_text} disabled={false} onCommit={(value) => void commitSourceText(value)} />}
          {sourceReview && <div className="mt-2 rounded bg-[#0d1117] p-2 text-[11px]"><div>Review {sourceReview.sourceKind === 'insert' ? 'component insertion' : sourceReview.property ? `style: ${sourceReview.property}` : 'text'} source change</div><div className="mt-1 grid grid-cols-2 gap-1"><div><div className="text-rose-300">Before</div><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-rose-200">{sourceReview.beforeCode || '(unchanged)'}</pre></div><div><div className="text-emerald-300">After</div><pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-emerald-200">{sourceReview.afterCode || '(unchanged)'}</pre></div></div>{sourceReview.sourceKind !== 'insert' && <div className="mt-1 text-[11px] text-[var(--inspector-muted)]">Value: {sourceReview.before || '(unset)'} → {sourceReview.after || '(unset)'}</div>}<div className="mt-2 flex gap-2"><button className="rounded border px-2 py-1" onClick={() => void applySourceReview()}>Apply reviewed diff</button><button className="rounded border px-2 py-1" onClick={() => setSourceReview(null)}>Cancel</button></div></div>}
          {sourceUndo && <button className="mt-1 rounded border px-2 py-1 text-[11px]" onClick={() => void undoSourceText()}>Undo source edit</button>}
          {sourceRedo && <button className="mt-1 rounded border px-2 py-1 text-[11px]" onClick={() => void redoSource()}>Redo source edit</button>}
        </div>
      )}
      {element && <details open className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold">Layout</summary>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Choose a tidy starting layout. Each recipe is one undoable change.</p>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">{GLOSSARY_PROMISE}</p>
        <div className="mt-1">
          <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label="Container type" property="display" /></span>
          <div className="mt-0.5 grid grid-cols-3 gap-1" role="group" aria-label="Container layout type">
            {([['block', 'Block'], ['flex', 'Flex'], ['grid', 'Grid']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={styleValueForMode(element, 'display') === value} className={`rounded border px-1 py-1 text-[11px] ${styleValueForMode(element, 'display') === value ? 'border-[var(--inspector-accent)] bg-[rgba(88,166,255,0.12)]' : 'border-[var(--inspector-border)]'}`} disabled={!stableIdentity} onClick={() => commitCssValue('display', value)}>{label}</button>)}
          </div>
        </div>
        {styleValueForMode(element, 'display') === 'flex' && <div className="mt-1">
          <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label="Direction" property="flex-direction" /></span>
          <div className="mt-0.5 grid grid-cols-2 gap-1" role="group" aria-label="Flex direction">
            {([['row', 'Side by side'], ['column', 'Stack vertically']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={styleValueForMode(element, 'flex-direction') === value} className={`rounded border px-1 py-1 text-[11px] ${styleValueForMode(element, 'flex-direction') === value ? 'border-[var(--inspector-accent)] bg-[rgba(88,166,255,0.12)]' : 'border-[var(--inspector-border)]'}`} disabled={!stableIdentity} onClick={() => commitCssValue('flex-direction', value)}>{label}</button>)}
          </div>
        </div>}
        {styleValueForMode(element, 'display') === 'grid' && <div className="mt-1">
          <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label="Grid columns" property="grid-template-columns" /></span>
          <div className="mt-0.5 flex items-center gap-1" role="group" aria-label="Grid column count">
            <button type="button" aria-label="Remove a grid column" title="Fewer columns" className="rounded border border-[var(--inspector-border)] px-2 py-1 text-sm disabled:opacity-40" disabled={!stableIdentity || gridTrackCount(styleValueForMode(element, 'grid-template-columns')) === 1} onClick={() => adjustGridColumns(-1)}>−</button>
            <span className="min-w-16 text-center text-[11px]">{gridTrackCount(styleValueForMode(element, 'grid-template-columns')) || 'Auto-fit'} columns</span>
            <button type="button" aria-label="Add a grid column" title="More columns" className="rounded border border-[var(--inspector-border)] px-2 py-1 text-sm disabled:opacity-40" disabled={!stableIdentity || gridTrackCount(styleValueForMode(element, 'grid-template-columns')) >= 12} onClick={() => adjustGridColumns(1)}>+</button>
          </div>
          <button type="button" className="mt-1 rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => commitCssValue('grid-template-columns', 'repeat(auto-fit, minmax(160px, 1fr))')}>Fit as many cards as possible</button>
        </div>}
        <button type="button" className="mt-1 w-full rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={centerSelectedOnPreview}>Center on preview</button>
        <p className="mt-0.5 text-[11px] text-[var(--inspector-muted)]">Centers the selected element in the visible app window. Saved as an undoable position change.</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {([
            ['stack', 'Stack vertically'], ['row', 'Side by side'],
            ['grid', '2-column grid'], ['spread', 'Space evenly'],
          ] as const).map(([recipe, label]) => (
            <button key={recipe} className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] hover:bg-[#21262d] disabled:opacity-40" type="button" disabled={!stableIdentity} onClick={() => applyLayoutRecipe(recipe)}>{label}</button>
          ))}
        </div>
        <div className="mt-2 rounded border border-[var(--inspector-border)] p-1.5">
          <span className="text-[11px] font-medium text-[var(--inspector-muted)]"><FieldLabel label="Position inside parent" property="margin" /></span>
          <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Align selected element inside its parent">
            <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => commitCssValues([['margin-left', '0px'], ['margin-right', 'auto']], 'Align element left in parent')}>Left</button>
            <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => commitCssValues([['margin-left', 'auto'], ['margin-right', 'auto']], 'Center element in parent')}>Center horizontally</button>
            <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => commitCssValues([['margin-left', 'auto'], ['margin-right', '0px']], 'Align element right in parent')}>Right</button>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Align selected element vertically inside its parent">
            {([['flex-start', 'Top'], ['center', 'Middle'], ['flex-end', 'Bottom']] as const).map(([value, label]) => <button key={value} type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => commitCssValue('align-self', value)}>{label}</button>)}
          </div>
          <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Top, middle, and bottom work when the parent uses flex or grid.</p>
        </div>
        <div className="mt-2 grid gap-1.5">
          {([
            ['align-items', styleValueForMode(element, 'flex-direction') === 'column' ? 'Horizontal alignment' : 'Vertical alignment', [['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'], ['stretch', 'Stretch']]],
            ['justify-content', styleValueForMode(element, 'flex-direction') === 'column' ? 'Vertical spacing' : 'Horizontal spacing', [['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'], ['space-between', 'Between'], ['space-around', 'Around'], ['space-evenly', 'Evenly']]],
          ] as const).map(([property, label, options]) => {
            const value = element ? styleValueForMode(element, property) : '';
            return <div key={property}>
              <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label={label} property={property} /></span>
              <div className="mt-0.5 grid grid-cols-4 gap-1">{options.map(([option, optionLabel]) => (
                <button key={option} aria-label={`${label}: ${optionLabel}`} aria-pressed={value === option} className={`rounded border px-1 py-1 text-[11px] disabled:opacity-40 ${value === option ? 'border-[var(--inspector-accent)] bg-[rgba(88,166,255,0.12)] text-[var(--inspector-text)]' : 'border-[var(--inspector-border)]'}`} type="button" disabled={!stableIdentity} onClick={() => commitCssValue(property, option)}>{optionLabel}</button>
              ))}</div>
            </div>;
          })}
          <div className="flex items-end gap-1">
            <div className="min-w-0 flex-1"><CssField label="Item spacing" property="gap" value={currentGap} placeholder="0px" disabled={!stableIdentity} onCommit={(value) => commitCssValue('gap', value)} /></div>
            <button type="button" aria-label={`Decrease item spacing by ${spacingStep} pixels`} title={`Decrease by ${spacingStep}px`} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" disabled={!stableIdentity} onClick={() => adjustSpacing('gap', -spacingStep)}>−</button>
            <button type="button" aria-label={`Increase item spacing by ${spacingStep} pixels`} title={`Increase by ${spacingStep}px`} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" disabled={!stableIdentity} onClick={() => adjustSpacing('gap', spacingStep)}>+</button>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--inspector-muted)]">Step
            {[1, 4, 8, 16].map((step) => <button key={step} type="button" aria-pressed={spacingStep === step} className={`rounded border px-1.5 py-0.5 ${spacingStep === step ? 'border-[var(--inspector-accent)] text-[var(--inspector-text)]' : 'border-[var(--inspector-border)]'}`} onClick={() => setSpacingStep(step)}>{step}px</button>)}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {([
            ['order', 'Item order', ['0', '1', '2', '3']],
          ] as const).map(([property, label, options]) => {
            const value = element ? styleValueForMode(element, property) : '';
            return <label key={property} className="flex min-w-0 flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
              <FieldLabel label={label} property={property} />
              <select aria-label={label} className="min-w-0 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)] disabled:opacity-40" disabled={!stableIdentity} value={value || ''} onChange={(event) => commitCssValue(property, event.currentTarget.value)}>
                <option value="">Default</option>
                {value && !options.includes(value as never) && <option value={value}>Current: {value}</option>}
                {options.map((option, index) => <option key={option} value={option}>{`Position ${index + 1}`}</option>)}
              </select>
            </label>;
          })}
        </div>
        {styleValueForMode(element, 'display') === 'flex' && <div className="mt-2">
          <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label="When items do not fit" property="flex-wrap" /></span>
          <div className="mt-0.5 grid grid-cols-2 gap-1" role="group" aria-label="Flex wrapping">
            {([['nowrap', 'Keep in one line'], ['wrap', 'Wrap to next line']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={styleValueForMode(element, 'flex-wrap') === value} className={`rounded border px-1 py-1 text-[11px] ${styleValueForMode(element, 'flex-wrap') === value ? 'border-[var(--inspector-accent)] bg-[rgba(88,166,255,0.12)]' : 'border-[var(--inspector-border)]'}`} disabled={!stableIdentity} onClick={() => commitCssValue('flex-wrap', value)}>{label}</button>)}
          </div>
          <div className="mt-2 rounded border border-[var(--inspector-border)] p-1.5">
            <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label="As an item in a flex row" property="flex-item" /></span>
            <div className="mt-1 grid grid-cols-3 gap-1">{([
              ['flex-grow', 'Grow', '0'], ['flex-shrink', 'Shrink', '1'], ['flex-basis', 'Starting size', 'auto'],
            ] as const).map(([property, label, placeholder]) => <CssField key={property} label={label} property={property} value={styleValueForMode(element, property)} placeholder={placeholder} disabled={!stableIdentity} onCommit={(value) => commitCssValue(property, value)} />)}</div>
          </div>
        </div>}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {([
            ['width', 'Width', [['fit-content', 'Fit content'], ['100%', 'Fill available'], ['auto', 'Automatic']]],
            ['height', 'Height', [['fit-content', 'Fit content'], ['100%', 'Fill available'], ['auto', 'Automatic']]],
          ] as const).map(([property, label, options]) => (
            <div key={property} className="min-w-0">
              <span className="text-[11px] text-[var(--inspector-muted)]"><FieldLabel label={label} property={property} /></span>
              <div className="mt-0.5 flex flex-wrap gap-1">{options.map(([value, optionLabel]) => (
                <button key={value} className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40" type="button" disabled={!stableIdentity} onClick={() => commitCssValue(property, value)}>{optionLabel}</button>
              ))}</div>
            </div>
          ))}
        </div>
      </details>}
      {alignableElements.length > 1 && <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold">Align selected elements</summary>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Aligns {alignableElements.length} selected items in this app as one undoable change.</p>
        <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Align selected items horizontally">
          {([['start', 'Left'], ['center', 'Center'], ['end', 'Right']] as const).map(([mode, label]) => <button key={mode} type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px]" onClick={() => alignSelectedElements('x', mode)}>{label}</button>)}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Align selected items vertically">
          {([['start', 'Top'], ['center', 'Middle'], ['end', 'Bottom']] as const).map(([mode, label]) => <button key={mode} type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px]" onClick={() => alignSelectedElements('y', mode)}>{label}</button>)}
        </div>
        {alignableElements.length > 2 && <div className="mt-1 grid grid-cols-2 gap-1">
          <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px]" onClick={() => alignSelectedElements('x', 'distribute')}>Space evenly sideways</button>
          <button type="button" className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px]" onClick={() => alignSelectedElements('y', 'distribute')}>Space evenly vertically</button>
        </div>}
      </details>}
      {element && <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold">Move selected element</summary>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
            <span>Lock movement axis</span>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label="Lock movement axis">
              {([
                ['free', 'Free', 'Move in any direction'],
                ['horizontal', 'Lock Y', 'Lock vertical movement; move horizontally'],
                ['vertical', 'Lock X', 'Lock horizontal movement; move vertically'],
              ] as const).map(([value, label, title]) => <button key={value} type="button" aria-pressed={moveConstraint === value} title={title} className={`rounded border px-1 py-1 text-[11px] ${moveConstraint === value ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-[var(--inspector-border)] text-[var(--inspector-text)]'}`} onClick={() => setMoveConstraint(value)}>{label}</button>)}
            </div>
          </div>
          <label className="flex flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
            <span>Nudge distance</span>
            <select aria-label="Nudge distance" className="rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]" value={nudgeStep} onChange={(event) => setNudgeStep(Number(event.currentTarget.value))}>
              {[1, 4, 8, 16].map((step) => <option key={step} value={step}>{step}px</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-[var(--inspector-muted)]">
            <span>Snap offset to grid</span>
            <select aria-label="Position snap grid" className="rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]" value={snapGrid} onChange={(event) => setSnapGrid(Number(event.currentTarget.value))}>
              {[0, 4, 8, 16].map((step) => <option key={step} value={step}>{step ? `${step}px` : 'Off'}</option>)}
            </select>
          </label>
          <button type="button" disabled={!snapGrid || !stableIdentity} className="self-end rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40" onClick={snapSelectedPosition}>Snap position</button>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1" role="group" aria-label="Nudge selected element">
          <button type="button" aria-label="Move left" title="Move left" disabled={moveConstraint === 'vertical'} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" onClick={() => nudgeSelected('x', -1)}>←</button>
          <div className="flex flex-col gap-1"><button type="button" aria-label="Move up" title="Move up" disabled={moveConstraint === 'horizontal'} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" onClick={() => nudgeSelected('y', -1)}>↑</button><button type="button" aria-label="Move down" title="Move down" disabled={moveConstraint === 'horizontal'} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" onClick={() => nudgeSelected('y', 1)}>↓</button></div>
          <button type="button" aria-label="Move right" title="Move right" disabled={moveConstraint === 'vertical'} className="rounded border border-[var(--inspector-border)] px-2 py-1 text-xs disabled:opacity-40" onClick={() => nudgeSelected('x', 1)}>→</button>
        </div>
        <div className="mt-2"><CssField label="Position offset" property="translate" value={styleValueForMode(element, 'translate')} placeholder="0px 0px" disabled={!stableIdentity} onCommit={(value) => commitCssValue('translate', value)} /></div>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Offsets are saved to the project and can be undone. Nudge distance is independent of layout spacing.</p>
      </details>}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[
          ['height', 'Height', 'auto, 240px'],
          ['min-width', 'Minimum width', '180px'],
          ['max-width', 'Maximum width', '100%'],
          ['min-height', 'Minimum height', '80px'],
          ['max-height', 'Maximum height', '400px'],
          ['font-size', 'Font size', '16px'],
          ['color', 'Text color', '#f5f5f5'],
          ['background-color', 'Background', '#20242b'],
          ['border-radius', 'Corner radius', '8px'],
        ].map(([property, label, placeholder]) => {
          const value = element ? styleValueForMode(element, property) : '';
          return (
            <div key={property} className="flex min-w-0 items-end gap-1">
              <div className="min-w-0 flex-1">{property === 'color' || property === 'background-color' ? <CssColorField
                label={label}
                property={property}
                value={value}
                placeholder={placeholder}
                disabled={!element || !stableIdentity}
                cssVariables={cssVariables}
                onCommit={(next) => commitCssValue(property, next)}
              /> : <CssField
                label={label}
                property={property}
                value={value}
                placeholder={placeholder}
                disabled={!element || !stableIdentity}
                onCommit={(next) => commitCssValue(property, next)}
              />}</div>
              {sourceFile && sourceBaseUrl && <button disabled={breakpointMode !== 'all'} className="rounded border border-[var(--inspector-border)] px-1 py-1 text-[11px] text-[var(--inspector-muted)] disabled:opacity-40" title={breakpointMode === 'all' ? `Write ${label} into the Svelte source` : 'Switch to All screen sizes to write this value to source'} onClick={() => commitSourceStyle(property, value)}>Source</button>}
            </div>
          );
        })}
      </div>
      {element && <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold">Typography</summary>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            ['font-family', 'Font family', 'inherit'],
            ['font-weight', 'Font weight', '400'],
            ['line-height', 'Line height', '1.5'],
            ['letter-spacing', 'Letter spacing', 'normal'],
          ].map(([property, label, placeholder]) => <CssField
            key={property}
            label={label}
            property={property}
            value={styleValueForMode(element, property)}
            placeholder={placeholder}
            disabled={!stableIdentity}
            onCommit={(value) => commitCssValue(property, value)}
          />)}
        </div>
      </details>}
      {element && <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold">Margins and padding</summary>
        {(['margin', 'padding'] as const).map((group) => {
          const labels = ['top', 'right', 'bottom', 'left'] as const;
          const values = [...new Set([...spacingOptions, '48px'])];
          return <div key={group} className="mt-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold capitalize text-[var(--inspector-muted)]"><FieldLabel label={group} property={group} /></span>
              <select aria-label={`Set all ${group}`} className="rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" value="" onChange={(event) => {
                if (!event.currentTarget.value) return;
                commitCssValues(labels.map((side) => [`${group}-${side}`, event.currentTarget.value]), `Set ${group} on all sides`);
                event.currentTarget.value = '';
              }}>
                <option value="">Set all sides…</option>
                {values.map((value) => <option key={value} value={value}>{spacingOptionLabel(value)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">{labels.map((side) => {
              const property = `${group}-${side}`;
              const value = styleValueForMode(element, property);
              return <div key={side} className="min-w-0">
                <CssField label={`${group} ${side}`} property={property} value={value} placeholder="0px" disabled={!stableIdentity} onCommit={(next) => commitCssValue(property, next)} />
                <div className="mt-0.5 flex gap-1">
                  <button type="button" aria-label={`Decrease ${group} ${side} by ${spacingStep} pixels`} className="flex-1 rounded border border-[var(--inspector-border)] px-1 py-0.5 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => adjustSpacing(property, -spacingStep)}>− {spacingStep}px</button>
                  <button type="button" aria-label={`Increase ${group} ${side} by ${spacingStep} pixels`} className="flex-1 rounded border border-[var(--inspector-border)] px-1 py-0.5 text-[11px] disabled:opacity-40" disabled={!stableIdentity} onClick={() => adjustSpacing(property, spacingStep)}>+ {spacingStep}px</button>
                </div>
              </div>;
            })}</div>
          </div>;
        })}
      </details>}
      <datalist id="hardlyui-css-token-values">
        {cssVariables.map(([name, value]) => (
          <option key={name} value={`var(${name})`} label={`${name}: ${value}`} />
        ))}
      </datalist>
      {(utilityClasses.length > 0 || cssVariables.length > 0) && (
        <details className="mt-2 rounded border border-[var(--inspector-border)] px-2 py-1">
          <summary className="cursor-pointer text-[12px] font-semibold text-[var(--inspector-muted)]">
            Detected classes and CSS tokens
          </summary>
          {utilityClasses.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1" aria-label="Element CSS classes">
              {utilityClasses.map((name) => (
                <code className="rounded bg-[#0d1117] px-1 py-0.5 text-[11px]" key={name}>{name}</code>
              ))}
            </div>
          )}
          {cssVariables.length > 0 && (
            <div className="mt-1 grid gap-1">
              {cssVariables.slice(0, 16).map(([name, value]) => (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[11px]" key={name}>
                  <code className="truncate text-[var(--inspector-accent)]" title={name}>{name}</code>
                  <code className="truncate" title={value}>{value}</code>
                </div>
              ))}
            </div>
          )}
        </details>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded border border-[var(--inspector-border)] px-2 py-1 text-[13px] disabled:opacity-40"
          type="button"
          disabled={!canUndoAny}
          title={undoLabel ? `Undo: ${undoLabel}` : 'Undo the last change'}
          onClick={() => void undoAny()}
        >
          {undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        </button>
        <button
          className="rounded border border-[var(--inspector-border)] px-2 py-1 text-[13px] disabled:opacity-40"
          type="button"
          disabled={!canRedoAny}
          title={redoLabel ? `Redo: ${redoLabel}` : 'Redo the last change'}
          onClick={() => void redoAny()}
        >
          Redo
        </button>
        <button
          className="ml-auto rounded border border-[var(--inspector-border)] px-2 py-1 text-[13px] text-[var(--inspector-danger)] disabled:opacity-40"
          type="button"
          disabled={editHistory.transactions.length === 0}
          onClick={() => {
            void (async () => {
              const ok = await confirm.ask({
                title: 'Reset all HardlyUI edits for this project?',
                body: 'Every saved edit and override stylesheet entry for this project is discarded and the app reloads its unedited appearance. Checkpoints that were already published are not kept either, so publish or export anything you want to keep first.',
                confirmLabel: 'Reset every edit',
                danger: true,
              });
              if (!ok) return;
              void api.resetEdits().catch((reason: unknown) => setError(String(reason)));
            })();
          }}
        >
          Reset edits
        </button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">
        Undo and Redo cover everything you changed, style edits and source-file edits alike.
        {actionLog.entries.length === 0 ? ' This window has no change list yet, so Undo uses the saved edit history.' : ''}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="w-full text-[12px] font-semibold text-[var(--inspector-muted)]">Add inside selected</span>
        {insertPresets.map((preset) => (
          <div className="flex items-center gap-0.5" key={preset.id}>
            <button
              className={`rounded border px-2 py-1 text-[11px] disabled:opacity-40 ${preset.id.startsWith('daisyui-') || preset.id.startsWith('flowbite-') ? 'border-[var(--inspector-accent)]' : 'border-[var(--inspector-border)]'}`}
              type="button"
              disabled={!element || !stableIdentity}
              onClick={() => insertPreset(preset.id)}
            >
              {preset.label}
            </button>
            {preset.children?.length ? <button
              className="rounded border border-[var(--inspector-border)] px-1.5 py-1 text-[11px] disabled:opacity-40"
              type="button"
              disabled={!stableIdentity}
              aria-label={`Save ${preset.label} as reusable`}
              title={`Save ${preset.label} in this project's reusable elements`}
              onClick={() => void savePresetAsReusable(preset.id)}
            >Save</button> : null}
          </div>
        ))}
        <button className="rounded border border-[var(--inspector-border)] px-2 py-1 text-[11px] text-[var(--inspector-danger)] disabled:opacity-40" type="button" disabled={!element || ['html', 'body'].includes(element.snapshot.tag) || !element.snapshot.outer_html || !element.snapshot.parent_dom_path || element.snapshot.parent_child_index == null} onClick={removeElement}>Remove selected</button>
      </div>
      <div className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <div className="mb-1 text-[12px] font-semibold text-[var(--inspector-muted)]">Reusable elements · saved in this project</div>
        <div className="flex gap-1">
          <input
            aria-label="Reusable element name"
            className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]"
            value={componentName}
            maxLength={64}
            onChange={(event) => setComponentName(event.currentTarget.value)}
          />
          <button className="rounded border border-[var(--inspector-border)] px-2 py-1 text-[11px] disabled:opacity-40" type="button" disabled={!element || !element.snapshot.outer_html} title="Save the selected element and its supported children, classes, and styles" onClick={() => void saveSelectedComponent()}>Save selected</button>
        </div>
        {componentLibrary.length > 0 && <div className="mt-2 grid gap-1">
          {componentLibrary.length > 3 && <input aria-label="Search reusable elements" className="rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]" placeholder="Search saved elements" value={componentSearch} onChange={(event) => setComponentSearch(event.currentTarget.value)} />}
          {componentLibrary.filter((component) => `${component.name} ${component.text}`.toLowerCase().includes(componentSearch.trim().toLowerCase())).map((component) => <div className="flex min-w-0 flex-wrap items-center gap-1" key={component.id}>
            <button className="cursor-grab rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] active:cursor-grabbing" type="button" draggable title={`Drag ${component.name} onto the app preview to insert it`} aria-label={`Drag ${component.name} onto the app preview`} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-hardlyui-component+json', JSON.stringify(componentWithTextProps(component))); event.dataTransfer.setData('text/plain', component.name); }}>⠿</button>
            <input className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] focus:border-[var(--inspector-border)]" aria-label={`Rename ${component.name}`} title={`${component.tag}: ${component.text}`} defaultValue={component.name} maxLength={64} onBlur={(event) => { if (event.currentTarget.value !== component.name) void renameSavedComponent(component.id, event.currentTarget.value); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <button className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] disabled:opacity-40" type="button" disabled={!element || !stableIdentity} onClick={() => insertSavedComponent(component, componentTextProps[`${component.id}:`] ?? component.text)}>Insert</button>
            <button className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] text-[var(--inspector-danger)]" type="button" aria-label={`Remove ${component.name} from reusable elements`} onClick={() => void removeSavedComponent(component.id)}>×</button>
            <details className="basis-full text-[11px] text-[var(--inspector-muted)]"><summary className="cursor-pointer">Node props ({Object.keys(collectComponentTextProps(component, component.id)).length})</summary><div className="mt-1 grid gap-1 pl-2">{(() => {
              const fields = (node: SavedComponentNode, path: number[] = []): JSX.Element[] => {
                const pathKey = path.length ? path.join('.') : '$';
                return [
                <div className="grid min-w-0 gap-1" key={pathKey}>
                  <div className="flex min-w-0 items-center gap-1"><span className="w-14 shrink-0 truncate">{path.length ? `${node.tag} ${path.join('.')}` : `Root (${node.tag})`}</span><input className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} ${node.tag === 'img' ? 'alt text' : 'text prop'} ${path.join('.') || 'root'}`} value={componentTextProps[`${component.id}:${path.join('.')}`] ?? node.text} maxLength={500} onChange={(event) => {
                    const value = event.currentTarget.value;
                    const key = `${component.id}:${path.join('.')}`;
                    setComponentTextProps((current) => ({ ...current, [key]: value }));
                  }} onBlur={(event) => { if (event.currentTarget.value !== node.text) void saveComponentTextProp(component.id, path, event.currentTarget.value); }} /><input className="w-16 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} ${node.tag} slot name ${pathKey}`} placeholder="slot name" defaultValue={node.slot_name ?? ''} maxLength={32} title="Mark this element as a named drop target for reusable content" onBlur={(event) => { if (event.currentTarget.value !== (node.slot_name ?? '')) void saveComponentSlot(component.id, path, event.currentTarget.value); }} /></div>
                  {node.tag === 'img' && <div className="flex min-w-0 items-center gap-1"><span className="w-14 shrink-0">Artwork</span><input className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} artwork URL ${pathKey}`} placeholder="HTTPS or app asset path" value={componentArtworkProps[`${component.id}:${path.join('.')}`] ?? node.image_url ?? ''} onChange={(event) => {
                    const value = event.currentTarget.value;
                    const key = `${component.id}:${path.join('.')}`;
                    setComponentArtworkProps((current) => ({ ...current, [key]: value }));
                  }} onBlur={(event) => { if (event.currentTarget.value !== (node.image_url ?? '')) void saveComponentArtworkProp(component.id, path, event.currentTarget.value); }} /></div>}
                  <div className="flex min-w-0 items-center gap-1"><span className="w-14 shrink-0">Classes</span><input className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} classes ${pathKey}`} placeholder="space-separated class names" defaultValue={node.class_names.join(' ')} maxLength={512} onBlur={(event) => { if (event.currentTarget.value.trim() !== node.class_names.join(' ')) void saveComponentClassProp(component.id, path, event.currentTarget.value); }} /></div>
                  <details className="pl-1 text-[11px] text-[var(--inspector-muted)]"><summary className="cursor-pointer">Appearance settings</summary><div className="mt-1 grid grid-cols-2 gap-1">{([
                    ['background-color', 'Background color', '#20242b'], ['color', 'Text color', '#f5f5f5'],
                    ['border-radius', 'Corner shape', '8px'], ['padding', 'Inside spacing', '12px'],
                  ] as const).map(([property, label, placeholder]) => <CssField key={property} label={label} value={node.styles.find(([name]) => name === property)?.[1] ?? ''} placeholder={placeholder} disabled={false} onCommit={(value) => void saveComponentStyleProp(component.id, path, property, value)} />)}</div></details>
                  <input className="w-full rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1 py-0.5 font-mono text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} Svelte text binding ${pathKey}`} placeholder="Svelte binding · book.title" value={componentSvelteBindings[`${component.id}:${pathKey}`] ?? ''} onChange={(event) => {
                    const value = event.currentTarget.value;
                    setComponentSvelteBindings((current) => ({ ...current, [`${component.id}:${pathKey}`]: value }));
                  }} onBlur={(event) => { if (event.currentTarget.value.trim() !== (component.svelte_bindings?.[pathKey] ?? '')) void saveComponentSvelteBinding(component.id, path, event.currentTarget.value); }} />
                </div>,
                ...node.children.flatMap((child, index) => fields(child, [...path, index])),
              ];
              };
              return fields(component);
            })()}</div></details>
            <details className="basis-full text-[11px] text-[var(--inspector-muted)]"><summary className="cursor-pointer">Portable HTML / Svelte source</summary><textarea className="mt-1 min-h-12 w-full resize-y rounded border border-[var(--inspector-border)] bg-[#0d1117] p-1 font-mono text-[11px] text-[var(--inspector-text)]" aria-label={`${component.name} exported source`} readOnly value={componentMarkupFor(component)} /><div className="mt-1 flex flex-wrap items-center justify-between gap-1"><span>Static HTML uses defaults; Svelte insertion applies bindings.</span><button className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]" type="button" onClick={() => void copyComponentSource(component)}>Copy source</button>{sourceBaseUrl && sourceFile && <button className="rounded border border-[var(--inspector-accent)] px-1.5 py-0.5 text-[11px]" type="button" title={`Preview inserting ${component.name} at the selected source element`} onClick={() => void insertComponentIntoSource(component)}>Review source insertion</button>}</div></details>
          </div>)}
        </div>}
        {componentLibrary.length === 0 && <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Save an element or small group to insert it again in another screen.</p>}
      </div>
      <MediaPanel
        sourceBaseUrl={sourceBaseUrl}
        canInsert={Boolean(element && stableIdentity)}
        onInsert={insertPicture}
      />
      <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--inspector-muted)]">Publish and drafts</summary>
        <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">
          Every change is a draft and is saved as you make it. Publishing turns the current draft into a named
          restore point you can come back to later, and keeps it safe from tidying up old checkpoints.
        </p>
        <div className="mt-2 flex gap-1">
          <input
            aria-label="Name this published version"
            className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]"
            placeholder="What is this version called?"
            value={publishLabel}
            maxLength={80}
            onChange={(event) => setPublishLabel(event.currentTarget.value)}
          />
          <button
            className="rounded border border-[var(--inspector-accent)] px-2 py-1 text-[11px] disabled:opacity-40"
            type="button"
            disabled={!publishLabel.trim()}
            title={publishLabel.trim() ? 'Publish the current draft' : 'Give this version a name first'}
            onClick={() => void publishDraft()}
          >
            Publish
          </button>
        </div>
        {publishNote ? <p className="mt-1 text-[11px] text-[var(--inspector-accent)]">{publishNote}</p> : null}
        {published.length === 0 ? (
          <p className="mt-2 text-[11px] text-[var(--inspector-muted)]">Nothing published yet.</p>
        ) : (
          <div className="mt-2 grid gap-1">
            {published.map((entry) => (
              <div className="flex min-w-0 items-center gap-1" key={entry.id}>
                <span className="min-w-0 flex-1 truncate text-[11px]" title={entry.label}>{entry.label}</span>
                <span className="shrink-0 text-[11px] text-[var(--inspector-muted)]">
                  {new Date(entry.published_at).toLocaleDateString()}
                </span>
                <button
                  className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]"
                  type="button"
                  title="Restore this published version"
                  onClick={() => void restorePublished(entry)}
                >
                  Go back to this
                </button>
              </div>
            ))}
          </div>
        )}
      </details>
      <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--inspector-muted)]">Edit versions ({versions.length})</summary>
        <div className="mt-2 flex gap-1">
          <input aria-label="Version name" className="min-w-0 flex-1 rounded border border-[var(--inspector-border)] bg-[#0d1117] px-1.5 py-1 text-[11px] text-[var(--inspector-text)]" placeholder="Name this checkpoint" value={versionLabel} maxLength={80} onChange={(event) => setVersionLabel(event.currentTarget.value)} />
          <button className="rounded border border-[var(--inspector-border)] px-2 py-1 text-[11px] disabled:opacity-40" type="button" disabled={!versionLabel.trim()} onClick={() => void createVersion()}>Save</button>
        </div>
        {previewVersion && <div className="mt-2 rounded bg-[#0d1117] p-2 text-[11px]">
          <div className="font-semibold">{previewVersion.label}</div>
          <div>{new Date(previewVersion.created_at).toLocaleString()}</div>
          <div>{previewVersion.cursor} applied of {previewVersion.transaction_count} transactions</div>
          {versionThumbnail
            ? <img alt={`Captured look of ${previewVersion.label}`} className="mt-2 w-full rounded border border-[var(--inspector-border)]" src={versionThumbnail} />
            : <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">No captured picture for this checkpoint.</p>}
          {previewVersion.recent_transactions.length > 0 && <ul className="mt-1 list-inside list-disc text-[var(--inspector-muted)]">{previewVersion.recent_transactions.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul>}
          <div className="mt-2 border-t border-[var(--inspector-border)] pt-1">
            <div className="font-semibold text-[var(--inspector-muted)]">Restoring would change</div>
            {versionDiff === null && <div className="text-[var(--inspector-muted)]">Loading style comparison…</div>}
            {versionDiff?.unchanged && <div className="text-[var(--inspector-muted)]">No stylesheet difference from the current edits.</div>}
            {versionDiff && !versionDiff.unchanged && <div className="mt-1 grid max-h-24 gap-0.5 overflow-y-auto font-mono text-[11px]">
              {versionDiff.added.map((line, index) => <div className="text-emerald-400" key={`add-${index}`}>+ {line}</div>)}
              {versionDiff.removed.map((line, index) => <div className="text-[var(--inspector-danger)]" key={`remove-${index}`}>− {line}</div>)}
            </div>}
          </div>
          <button className="mt-1 rounded border border-[var(--inspector-border)] px-1.5 py-0.5" type="button" onClick={() => void restoreVersion(previewVersion)}>Restore this version</button>
        </div>}
        {versions.length > 0 && <div className="mt-2 grid max-h-32 gap-1 overflow-y-auto">
          {versions.map((version) => <div className="flex min-w-0 items-center gap-1" key={version.id}>
            <span className="min-w-0 flex-1 truncate text-[11px]" title={version.label}>{version.label}</span>
            {version.published ? <span className="shrink-0 rounded border border-[var(--inspector-accent)] px-1 text-[11px] text-[var(--inspector-accent)]" title="Published restore point; delete and pruning leave it alone">Published</span> : null}
            <button className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]" type="button" onClick={() => setPreviewVersion(version)}>Preview</button>
            <button className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]" type="button" onClick={() => void restoreVersion(version)}>Restore</button>
            <button aria-label={`Delete ${version.label}`} className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] text-[var(--inspector-danger)] disabled:opacity-40" type="button" disabled={version.published} title={version.published ? 'Published restore points cannot be deleted' : `Delete ${version.label}`} onClick={() => void deleteVersion(version)}>Delete</button>
          </div>)}
        </div>}
        {versions.length > 20 && <button className="mt-2 rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]" type="button" title="Published versions are always kept" onClick={() => void pruneVersions()}>Keep newest 20</button>}
        {versions.length === 0 && <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">Save a named checkpoint before a larger visual change.</p>}
      </details>
      {error ? <ErrorNotice message={error} className="mt-1" /> : null}
    </section>
  );
}
