/**
 * Guest measurement constants.
 * Location: packages/guest/src/constants.ts
 */

/** Curated computed-style keys (max 28) exported to the hub. */
export const CURATED_CSS_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'padding',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'grid-template-columns',
  'order',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'z-index',
  'overflow',
  'pointer-events',
  'opacity',
  'transform',
  'translate',
  'color',
  'background-color',
  'font-size',
  'border-radius',
  'border-width',
  'border-color',
] as const;

export const MAX_CSS_PROPERTIES = 40;

/** Controlled failure when element capture is requested off-viewport. */
export const OFF_VIEWPORT_CAPTURE_ERROR =
  'Element is outside the viewport. Scroll it into view before capture.';

/** Appended to dom_path when a closed shadow root blocks traversal. */
export const CLOSED_SHADOW_HINT = ' [closed shadow root — outer host only]';
