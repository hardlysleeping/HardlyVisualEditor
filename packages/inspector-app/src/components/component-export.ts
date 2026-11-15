import type { SavedComponentNode } from '../api.js';

const ALLOWED_STYLE_PROPERTIES = new Set([
  'width', 'height', 'display', 'flex-direction', 'flex-wrap',
  'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'order', 'align-items', 'justify-content',
  'align-self',
  'min-width', 'max-width', 'min-height', 'max-height', 'border-width', 'border-color',
  'gap', 'translate', 'padding', 'margin', 'color', 'background-color', 'font-size',
  'font-weight', 'line-height', 'border-radius',
]);

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"'{}]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    '{': '&#123;', '}': '&#125;',
  })[character] ?? character);
}

/** Render a validated saved tree as portable HTML/Svelte source markup. */
export function exportSavedComponentMarkup(node: SavedComponentNode, svelteBindings: Record<string, string> = {}): string {
  const render = (current: SavedComponentNode, path: number[] = []): string => {
    const attributes: string[] = [];
    const classes = current.class_names.filter((name) => /^[\w:/\[\].#%-]{1,128}$/.test(name));
    if (classes.length) attributes.push(`class="${escapeMarkup(classes.join(' '))}"`);
    if (current.tag === 'img' && current.image_url && safeArtworkUrl(current.image_url)) {
      attributes.push(`src="${escapeMarkup(current.image_url)}"`);
      attributes.push(`alt="${escapeMarkup(current.text)}"`);
    }
    const styles = current.styles.filter(([property, value]) =>
      ALLOWED_STYLE_PROPERTIES.has(property) && value.length <= 256 && !/[{};]/.test(value),
    );
    if (styles.length) attributes.push(`style="${escapeMarkup(styles.map(([property, value]) => `${property}: ${value}`).join('; '))}"`);
    if (current.slot_name && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(current.slot_name)) {
      attributes.push(`data-hardlyui-slot="${escapeMarkup(current.slot_name)}"`);
    }
    const opening = `<${current.tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
    if (current.tag === 'img') return opening;
    const expression = svelteBindings[path.length ? path.join('.') : '$'];
    const text = expression && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression)
      ? `{${expression}}`
      : escapeMarkup(current.text);
    const body = text + current.children.map((child, index) => render(child, [...path, index])).join('');
    return `${opening}${body}</${current.tag}>`;
  };
  return render(node);
}

function safeArtworkUrl(value: string): boolean {
  return value.length > 0 && value.length <= 2_048 && !/[\u0000-\u0020"'<>]/.test(value)
    && (value.startsWith('https://') || value.startsWith('asset://') || value.startsWith('tauri://')
      || value.startsWith('http://localhost/') || value.startsWith('http://tauri.localhost/')
      || (!value.startsWith('//') && !value.includes(':') && !value.split('/').includes('..')));
}
