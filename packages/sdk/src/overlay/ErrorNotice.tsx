/**
 * One error surface for the whole overlay: what happened, what to do, and the
 * original text one click away.
 * Location: packages/sdk/src/overlay/ErrorNotice.tsx
 */

import { explainError } from './messages.js';

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
    <div className={['ve-error', className].filter(Boolean).join(' ')} role="alert">
      <p className="ve-error__title">{explained.title}</p>
      {explained.action ? <p className="ve-error__action">{explained.action}</p> : null}
      {showDetail ? (
        <details className="ve-error__details">
          <summary>Details</summary>
          <p className="ve-error__detail">{explained.detail}</p>
        </details>
      ) : null}
    </div>
  );
}