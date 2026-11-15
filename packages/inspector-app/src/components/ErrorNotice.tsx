/**
 * One error surface for the whole inspector: what happened, what to do, and the
 * original text one click away.
 */

import { explainError } from '../lib/messages.js';

type Props = {
  /** A thrown value: adapter text, or an already-written `userMessage`. */
  message: unknown;
  className?: string;
};

export function ErrorNotice({ message, className = '' }: Props) {
  if (!message) return null;
  const explained = explainError(message);
  const showDetail = explained.detail.trim() && explained.detail.trim() !== explained.title;
  return (
    <div className={`mt-2 rounded border border-[rgba(248,81,73,0.45)] bg-[rgba(248,81,73,0.08)] p-2 ${className}`} role="alert">
      <p className="text-[12px] font-semibold leading-snug text-[var(--inspector-danger)]">{explained.title}</p>
      {explained.action ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--inspector-text)]">{explained.action}</p>
      ) : null}
      {showDetail ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-[var(--inspector-muted)]">Details</summary>
          <p className="mt-1 select-text font-mono text-[11px] leading-snug text-[var(--inspector-muted)]">{explained.detail}</p>
        </details>
      ) : null}
    </div>
  );
}