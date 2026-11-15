/** Line-level comparison between a saved version stylesheet and the current one. */

export type CssVersionDiff = {
  added: string[];
  removed: string[];
  unchanged: boolean;
};

const MAX_LINES = 200;

function significantLines(css: string): string[] {
  return css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '{' && line !== '}')
    .map((line) => line.replace(/\s+/g, ' '))
    .slice(0, MAX_LINES);
}

/**
 * Lines that restoring the version would add (present in the version, absent
 * now) and remove (present now, absent in the version). Declarations are
 * compared literally; this is a summary, not a CSS parser.
 */
export function diffVersionCss(versionCss: string, currentCss: string): CssVersionDiff {
  const version = significantLines(versionCss);
  const current = significantLines(currentCss);
  const currentSet = new Set(current);
  const versionSet = new Set(version);
  const removed = current.filter((line) => !versionSet.has(line));
  const added = version.filter((line) => !currentSet.has(line));
  return { added, removed, unchanged: added.length === 0 && removed.length === 0 };
}