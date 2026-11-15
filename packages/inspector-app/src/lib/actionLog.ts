/**
 * Session-ordered record of what the user did, across both edit lanes.
 *
 * HardlyUI has two places an edit can land: the manifest edit history (layout,
 * styles, structure — undone through the plugin) and the Svelte source file
 * (undone through the dev adapter). Both work, but a user expects one Undo
 * button that reverses the last thing they did, whichever lane it was.
 *
 * This log is that order. It is deliberately session-scoped: it starts empty on
 * reload and the panel says so. The lanes keep their own history underneath, so
 * nothing is lost — if the log is empty the editor falls back to the manifest
 * history, which does survive a reload.
 *
 * Location: packages/inspector-app/src/lib/actionLog.ts
 */

export type ActionLane = 'manifest' | 'source';

export type ActionEntry = {
  lane: ActionLane;
  /** What the user would call it, shown on the undo button. */
  label: string;
};

export type ActionLogSnapshot = {
  entries: ActionEntry[];
  /** How many entries are currently applied; the rest are redoable. */
  cursor: number;
};

const EMPTY: ActionLogSnapshot = { entries: [], cursor: 0 };

let state: ActionLogSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ActionLogSnapshot {
  return state;
}

/** Records a completed action. Anything redoable ahead of it is dropped. */
export function record(lane: ActionLane, label: string): void {
  const entries = state.entries.slice(0, state.cursor);
  entries.push({ lane, label: label.trim() || (lane === 'source' ? 'Source edit' : 'Edit') });
  state = { entries, cursor: entries.length };
  emit();
}

/** The action a unified Undo would reverse, or null when the log is empty. */
export function peekUndo(): ActionEntry | null {
  return state.entries[state.cursor - 1] ?? null;
}

/** The action a unified Redo would replay, or null. */
export function peekRedo(): ActionEntry | null {
  return state.entries[state.cursor] ?? null;
}

/** Marks the newest applied action as undone. */
export function back(): void {
  if (state.cursor === 0) return;
  state = { ...state, cursor: state.cursor - 1 };
  emit();
}

/** Marks the next redoable action as applied again. */
export function forward(): void {
  if (state.cursor >= state.entries.length) return;
  state = { ...state, cursor: state.cursor + 1 };
  emit();
}

/** Clears the log; used when the manifest history itself is discarded. */
export function reset(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  emit();
}

/** True when nothing has been done yet in this session. */
export function isEmpty(): boolean {
  return state.cursor === 0;
}