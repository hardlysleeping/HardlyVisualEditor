/**
 * The text an element owns directly, as opposed to text inside its children.
 *
 * Location: packages/guest/src/text-nodes.ts
 */

/**
 * Direct child text nodes in document order, with whitespace-only nodes
 * dropped so index 0 is the first run of visible text rather than the newline
 * between two tags. The editor uses this both to report what is editable and
 * to pick which node a text edit writes to.
 */
export function ownTextNodes(element: Element): Text[] {
  return Array.from(element.childNodes).filter(
    (node): node is Text => node instanceof Text && node.data.trim().length > 0,
  );
}