/**
 * Design-token normalization derived from discovered host CSS variables.
 * Location: packages/inspector-app/src/lib/designTokens.ts
 */

export type TokenKind = 'spacing' | 'radius' | 'typography' | 'color';

export type DesignToken = {
  name: string;
  value: string;
  pixels: number | null;
};

export type TokenScales = Record<TokenKind, DesignToken[]>;

export type TokenMatch = {
  token: DesignToken;
  delta: number;
};

export type ShorthandFix = {
  before: string;
  after: string;
  labels: string[];
};

/** Fallback root font size for hosts that do not report their computed root. */
const DEFAULT_ROOT_FONT_PX = 16;
const PIXEL_VALUE = /^(-?(?:\d+(?:\.\d*)?|\.\d+))px$/i;
const REM_VALUE = /^(-?(?:\d+(?:\.\d*)?|\.\d+))rem$/i;
const COLOR_VALUE = /^(?:#[\da-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;
const SPACING_NAME = /(?:space|spacing|gap|inset|gutter|padding|margin|stack|rhythm)/i;
const RADIUS_NAME = /(?:radius|corner|round)/i;
const TYPOGRAPHY_NAME = /(?:font-size|font-scale|type-scale|text-(?:size|sm|md|lg|xl)|^--fs-|^--font-)/i;
const COLOR_NAME = /(?:color|colour|surface|background|foreground|text|accent|border|fill|stroke)/i;
const UNSAFE_SHORTHAND = /auto|inherit|initial|unset|revert|calc\(|var\(|clamp\(|min\(|max\(/i;

/** Resolve a plain px/rem token value to CSS pixels. */
export function pixelValue(value: string, rootFontPx = DEFAULT_ROOT_FONT_PX): number | null {
  const trimmed = value.trim();
  const px = PIXEL_VALUE.exec(trimmed);
  if (px) return Number(px[1]);
  const rem = REM_VALUE.exec(trimmed);
  if (rem) return Number(rem[1]) * rootFontPx;
  return trimmed === '0' ? 0 : null;
}

/** Classify a detected CSS variable into a normalized token scale. */
export function tokenKind(name: string, value: string, rootFontPx = DEFAULT_ROOT_FONT_PX): TokenKind | null {
  const size = pixelValue(value, rootFontPx);
  if (size !== null && size >= 0) {
    if (RADIUS_NAME.test(name)) return 'radius';
    if (TYPOGRAPHY_NAME.test(name)) return 'typography';
    if (SPACING_NAME.test(name)) return 'spacing';
  }
  if (COLOR_VALUE.test(value.trim()) && COLOR_NAME.test(name)) return 'color';
  return null;
}

/** Group and sort the host CSS variables into usable token scales. */
export function collectTokenScales(
  cssVariables: Array<[string, string]>,
  rootFontPx = DEFAULT_ROOT_FONT_PX,
): TokenScales {
  const scales: TokenScales = { spacing: [], radius: [], typography: [], color: [] };
  const seen = new Set<string>();
  for (const [name, value] of cssVariables) {
    if (seen.has(name)) continue;
    seen.add(name);
    const kind = tokenKind(name, value, rootFontPx);
    if (!kind) continue;
    scales[kind].push({ name, value: value.trim(), pixels: pixelValue(value, rootFontPx) });
  }
  for (const kind of ['spacing', 'radius', 'typography', 'color'] as TokenKind[]) {
    scales[kind] = scales[kind]
      .sort((left, right) => (left.pixels ?? 0) - (right.pixels ?? 0) || left.name.localeCompare(right.name))
      .slice(0, 24);
  }
  return scales;
}

/**
 * Nearest token to a pixel size. Values already on the scale are skipped so
 * guidance only proposes real normalization, never noise.
 */
export function nearestToken(
  tokens: DesignToken[],
  size: number,
  tolerance = 4,
  minDelta = 0.5,
): TokenMatch | null {
  let best: TokenMatch | null = null;
  for (const token of tokens) {
    if (token.pixels === null) continue;
    const delta = Math.abs(token.pixels - size);
    if (delta < minDelta || delta > tolerance) continue;
    if (!best || delta < best.delta) best = { token, delta };
  }
  return best;
}

export function cssVariable(token: DesignToken): string {
  return `var(${token.name})`;
}

export function formatPixels(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}

/**
 * Normalize a one-to-four-part CSS value (gap, padding, margin, radius) to the
 * nearest project tokens. Returns null when nothing changes.
 */
export function normalizeShorthand(
  value: string,
  tokens: DesignToken[],
  tolerance = 4,
  rootFontPx = DEFAULT_ROOT_FONT_PX,
): ShorthandFix | null {
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/);
  if (!tokens.length || parts.length === 0 || parts.length > 4) return null;
  if (UNSAFE_SHORTHAND.test(trimmed)) return null;
  let changed = false;
  const labels: string[] = [];
  const next = parts.map((part) => {
    const size = pixelValue(part, rootFontPx);
    if (size === null || size === 0) return part;
    const match = nearestToken(tokens, size, tolerance, 0);
    // A value already on the scale is left alone; normalization only replaces drift.
    if (!match || match.delta < 0.5) return part;
    changed = true;
    labels.push(`${match.token.name} (${match.token.value}) replaces ${formatPixels(size)}`);
    return cssVariable(match.token);
  });
  return changed ? { before: trimmed, after: next.join(' '), labels } : null;
}
