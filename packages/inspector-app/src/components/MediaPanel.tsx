/**
 * Project picture library: upload, preview, insert, remove.
 * Location: packages/inspector-app/src/components/MediaPanel.tsx
 */

import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { MediaItem } from '../api.js';
import { ErrorNotice } from './ErrorNotice.js';
import { userMessage } from '../lib/messages.js';
import { ConfirmDialog, useConfirm } from './ConfirmDialog.js';

type Props = {
  /** Base address of the running app, used to preview stored pictures. */
  sourceBaseUrl?: string;
  /** False when nothing is selected to insert into. */
  canInsert: boolean;
  busy?: boolean;
  onInsert: (url: string, name: string) => void;
};

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MIB = 1024 * 1024;

function readableSize(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Data URL, so the panel works in a host that has no dev server route. */
async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('that file could not be read'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

export function MediaPanel({ sourceBaseUrl, canInsert, busy = false, onInsert }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = () => {
    void api.listMedia()
      .then((next) => setItems(next))
      .catch((reason: unknown) => setError(String(reason instanceof Error ? reason.message : reason)));
  };
  useEffect(refresh, []);

  // Hosts without the dev server route have no address to show, so the panel
  // reads the stored bytes and previews them directly.
  useEffect(() => {
    if (sourceBaseUrl || items.length === 0) return;
    let active = true;
    for (const item of items) {
      if (previews[item.name]) continue;
      void api.readMedia(item.name).then((base64) => {
        if (!active) return;
        setPreviews((current) => ({ ...current, [item.name]: `data:image/${item.kind};base64,${base64}` }));
      }).catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [items, previews, sourceBaseUrl]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStatus(null);
    setWorking(true);
    try {
      if (file.size > 4 * MIB) throw new Error('pictures must be at most 4 MiB');
      const dataUrl = await readAsDataUrl(file);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const saved = await api.saveMedia(file.name, base64);
      refresh();
      setStatus(`${saved.name} is in the library.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const confirm = useConfirm();

  const remove = async (item: MediaItem) => {
    const ok = await confirm.ask({
      title: `Remove the picture “${item.name}”?`,
      body: 'The file is deleted from the project library. Elements that already use it keep their address and will show a broken picture until you insert another one.',
      confirmLabel: 'Remove picture',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setWorking(true);
    try {
      await api.deleteMedia(item.name);
      refresh();
      setStatus(`${item.name} removed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const copyAddress = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.url);
      setStatus(`${item.url} copied.`);
    } catch {
      setError(userMessage('The browser refused clipboard access. Select the address and copy it by hand.'));
    }
  };

  const disabled = busy || working;

  return (
    <details className="mt-2 rounded border border-[var(--inspector-border)] p-2">
      <ConfirmDialog request={confirm.request} onSettle={confirm.settle} />
      <summary className="cursor-pointer text-[12px] font-semibold">Pictures</summary>
      <p className="mt-1 text-[11px] text-[var(--inspector-muted)]">
        Upload a picture once, then insert it anywhere in the project. Files live in the project's
        <code className="mx-1">.hardlyui/media</code> folder.
      </p>
      <label className="mt-2 flex flex-col gap-1 text-[11px] text-[var(--inspector-muted)]">
        <span className="font-medium text-[var(--inspector-text)]">Add a picture</span>
        <input
          type="file"
          accept={ACCEPTED}
          disabled={disabled}
          className="text-[11px] file:mr-2 file:rounded file:border file:border-[var(--inspector-border)] file:bg-[#0d1117] file:px-2 file:py-1 file:text-[11px] file:text-[var(--inspector-text)]"
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <span>PNG, JPEG, WebP, GIF or SVG up to 4 MB.</span>
      </label>

      {status ? <p className="mt-1 text-[11px] text-[var(--inspector-accent)]">{status}</p> : null}
      <ErrorNotice message={error} />

      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--inspector-muted)]">No pictures yet.</p>
      ) : (
        <ul className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.name} className="min-w-0 rounded border border-[var(--inspector-border)] p-1">
              <img
                alt={item.name}
                className="h-16 w-full rounded bg-[#0d1117] object-contain"
                src={previews[item.name] ?? (sourceBaseUrl ? new URL(item.url, sourceBaseUrl).toString() : undefined)}
                onError={(event) => {
                  // The dev route can be missing even when an address exists.
                  const image = event.currentTarget;
                  if (image.dataset.fallback === '1') return;
                  image.dataset.fallback = '1';
                  void api.readMedia(item.name)
                    .then((base64) => {
                      image.src = `data:image/${item.kind};base64,${base64}`;
                    })
                    .catch(() => undefined);
                }}
              />
              <div className="mt-1 truncate text-[11px]" title={item.name}>{item.name}</div>
              <div className="text-[11px] text-[var(--inspector-muted)]">{readableSize(item.bytes)}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={!canInsert || disabled}
                  className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                  title={canInsert ? 'Insert this picture inside the selected element' : 'Select an element first'}
                  onClick={() => onInsert(item.url, item.name)}
                >
                  Insert
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px]"
                  onClick={() => void copyAddress(item)}
                >
                  Copy address
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className="rounded border border-[var(--inspector-border)] px-1.5 py-0.5 text-[11px] text-[var(--inspector-danger)] disabled:opacity-40"
                  onClick={() => void remove(item)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
