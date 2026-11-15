/**
 * Plain-language explanations for the CSS vocabulary the inspector exposes.
 *
 * The rule is that the real CSS name stays on screen (so a developer is not
 * lied to, and copy/paste keeps working) but hovering the label explains what
 * it does in words a designer already uses.
 *
 * Location: packages/inspector-app/src/lib/cssGlossary.ts
 */

type Entry = { plain: string; css: string };

const ENTRIES: Record<string, Entry> = {
  display: {
    plain: 'How this container arranges what sits inside it.',
    css: 'Block stacks children, flex lines them up in a row or column, grid places them in columns.',
  },
  'flex-direction': {
    plain: 'Which way items line up.',
    css: 'flex-direction: row puts them side by side, column stacks them.',
  },
  'flex-wrap': {
    plain: 'What happens when the items no longer fit on one line.',
    css: 'flex-wrap: nowrap squeezes them; wrap moves the extra ones to the next line.',
  },
  'flex-grow': {
    plain: 'How much of the spare room this item takes when there is space left over. 0 means it keeps its own size.',
    css: 'flex-grow',
  },
  'flex-shrink': {
    plain: 'Whether this item is allowed to shrink when there is not enough room. 1 means yes, 0 means never shrink.',
    css: 'flex-shrink',
  },
  'flex-basis': {
    plain: 'The size this item starts at before the container shares out the space.',
    css: 'flex-basis, for example 200px or auto',
  },
  order: {
    plain: 'Changes the position of this item without moving it in the code. Lower numbers come first.',
    css: 'order',
  },
  gap: {
    plain: 'The empty space between items in this container.',
    css: 'gap',
  },
  'grid-template-columns': {
    plain: 'How many columns the grid has, and how wide each one is.',
    css: 'grid-template-columns, for example repeat(3, 1fr)',
  },
  'align-items': {
    plain: 'How items line up across the container, for example all centred or all stretched to the same height.',
    css: 'align-items',
  },
  'align-self': {
    plain: 'Overrides the alignment for this one item only.',
    css: 'align-self',
  },
  'justify-content': {
    plain: 'How the items are spread along the container, for example packed at the start or pushed to the edges.',
    css: 'justify-content',
  },
  translate: {
    plain: 'Moves this element from where the layout puts it, without disturbing anything around it.',
    css: 'translate',
  },
  'font-size': {
    plain: 'How large the text is.',
    css: 'font-size',
  },
  'font-family': {
    plain: 'Which typeface the text uses.',
    css: 'font-family',
  },
  'font-weight': {
    plain: 'How bold the text is. 400 is normal, 700 is bold.',
    css: 'font-weight',
  },
  'line-height': {
    plain: 'The height of each line of text, which controls how airy a paragraph feels.',
    css: 'line-height, usually a number like 1.5',
  },
  'letter-spacing': {
    plain: 'Extra space between letters, useful for small capital-letter labels.',
    css: 'letter-spacing',
  },
  color: {
    plain: 'The colour of the text.',
    css: 'color',
  },
  'background-color': {
    plain: 'The colour behind the text and content.',
    css: 'background-color',
  },
  'border-radius': {
    plain: 'How rounded the corners are. 0 is square.',
    css: 'border-radius',
  },
  'border-width': {
    plain: 'How thick the outline around this element is.',
    css: 'border-width',
  },
  'border-color': {
    plain: 'The colour of the outline around this element.',
    css: 'border-color',
  },
  width: {
    plain: 'How wide this element is. "Fit content" shrinks it to its contents, "Fill available" stretches it.',
    css: 'width',
  },
  height: {
    plain: 'How tall this element is.',
    css: 'height',
  },
  'min-width': {
    plain: 'The narrowest this element is allowed to become.',
    css: 'min-width',
  },
  'max-width': {
    plain: 'The widest this element is allowed to become.',
    css: 'max-width',
  },
  'min-height': {
    plain: 'The shortest this element is allowed to become.',
    css: 'min-height',
  },
  'max-height': {
    plain: 'The tallest this element is allowed to become.',
    css: 'max-height',
  },
  breakpoint: {
    plain: 'Which screen sizes this change applies to. Everything else keeps the size it already had.',
    css: 'a media query, for example @media (min-width: 1025px)',
  },
  token: {
    plain: 'A value the project already uses elsewhere, so this change matches the rest of the design.',
    css: 'a CSS custom property, for example var(--spacing-2)',
  },
  'flex-item': {
    plain: 'How this one item shares a row with its neighbours: whether it takes spare room, may shrink, and what size it starts at.',
    css: 'flex-grow, flex-shrink and flex-basis',
  },
  position: {
    plain: 'Whether the element stays in the normal flow or is placed freely on top of it.',
    css: 'position',
  },
  'z-index': {
    plain: 'Which overlapping element sits in front. Higher numbers come forward.',
    css: 'z-index',
  },
  opacity: {
    plain: 'How see-through the element is. 1 is solid, 0 is invisible.',
    css: 'opacity',
  },
  overflow: {
    plain: 'What happens when the contents are bigger than the box: spill out, be clipped, or scroll.',
    css: 'overflow',
  },
  'box-shadow': {
    plain: 'A shadow behind the element, which lifts it off the page.',
    css: 'box-shadow',
  },
  'border-style': {
    plain: 'Whether the outline is a solid line, dashed, dotted or absent.',
    css: 'border-style',
  },
};

/** Margin and padding are the same idea on different sides. */
for (const side of ['top', 'right', 'bottom', 'left'] as const) {
  ENTRIES[`margin-${side}`] = {
    plain: `Empty space outside this element on its ${side} side, pushing other elements away.`,
    css: `margin-${side}`,
  };
  ENTRIES[`padding-${side}`] = {
    plain: `Empty space inside this element on its ${side} side, between its edge and its content.`,
    css: `padding-${side}`,
  };
}

ENTRIES.margin = {
  plain: 'Empty space outside the element, pushing other elements away.',
  css: 'margin',
};
ENTRIES.padding = {
  plain: 'Empty space inside the element, between its edge and its content.',
  css: 'padding',
};

/** Tooltip text for a CSS property, or undefined when it needs no explaining. */
export function cssHint(property: string | undefined | null): string | undefined {
  if (!property) return undefined;
  const entry = ENTRIES[property.trim().toLowerCase()];
  if (!entry) return undefined;
  return `${entry.plain} (CSS: ${entry.css})`;
}

/** Shown once in the layout panel so the dotted labels are discoverable. */
export const GLOSSARY_PROMISE = 'Labels with a dotted underline explain themselves when you hover them.';