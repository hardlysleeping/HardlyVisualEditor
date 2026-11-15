/**
 * Confirmation dialog for destructive actions.
 * Location: packages/inspector-app/src/components/ConfirmDialog.tsx
 *
 * The window runs inside a Tauri webview, where `window.confirm` renders as an
 * unstyled WebKit box titled "JavaScript - tauri://localhost". Restoring a
 * checkpoint, deleting or pruning one, resetting every edit and removing a
 * picture all need a yes/no answer, so they ask here instead, in the same
 * dialog styling as the settings dialog.
 *
 * `useConfirm().ask(...)` resolves to true only when the person presses the
 * confirm button; Escape, the close button and the backdrop resolve to false.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ConfirmRequest = {
  title: string;
  /** What happens, in one or two sentences, including what is not touched. */
  body: string;
  confirmLabel: string;
  /** Destructive red instead of the accent colour. */
  danger?: boolean;
};

type DialogProps = {
  request: ConfirmRequest | null;
  onSettle: (confirmed: boolean) => void;
};

export function ConfirmDialog({ request, onSettle }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      dialog.showModal();
      confirmRef.current?.focus();
    }
    if (!request && dialog.open) {
      dialog.close();
    }
  }, [request]);

  if (!request) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={request.title}
      className="w-[min(92vw,420px)] rounded border border-[var(--inspector-border)] bg-[var(--inspector-bg)] p-4 text-[var(--inspector-text)] shadow-lg backdrop:bg-black/30"
      onCancel={(event) => {
        event.preventDefault();
        onSettle(false);
      }}
    >
      <h2 className="text-[13px] font-semibold">{request.title}</h2>
      <p className="mt-1 text-[12px] leading-5 text-[var(--inspector-muted)]">{request.body}</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded border border-[var(--inspector-border)] px-2.5 py-1 text-[12px]"
          onClick={() => onSettle(false)}
        >
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={`rounded border px-2.5 py-1 text-[12px] font-semibold ${
            request.danger
              ? 'border-[var(--inspector-danger)] text-[var(--inspector-danger)]'
              : 'border-[var(--inspector-accent)] text-[var(--inspector-accent)]'
          }`}
          onClick={() => onSettle(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** State plus the ask/settle pair; render `<ConfirmDialog>` next to the caller. */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const ask = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  return { request, ask, settle };
}