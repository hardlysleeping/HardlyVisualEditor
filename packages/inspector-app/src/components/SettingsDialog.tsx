/**
 * Persistent settings editor dialog.
 * Location: packages/inspector-app/src/components/SettingsDialog.tsx
 *
 * Only controls the plugin actually reads are shown. `theme` and `shortcut`
 * are stored in visual-editor/settings.json but nothing reads them back (the
 * host registers its own shortcut), so editing them here would be a switch
 * that does nothing.
 */

import { useEffect, useRef, useState } from 'react';
import type { PersistentSettings, PersistentSettingsPatch, ScreenshotDirMode } from '../types.js';
import { ErrorNotice } from './ErrorNotice.js';

type Props = {
  open: boolean;
  settings: PersistentSettings;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: PersistentSettingsPatch) => void;
};

const PADDING_OPTIONS = [0, 8, 16, 24, 48] as const;

const SCREENSHOT_DIR_LABELS: Record<ScreenshotDirMode, string> = {
  appData: 'App data folder',
  project: 'Project folder',
  temp: 'Temporary folder',
  absolutePath: 'A folder I choose',
};

export function SettingsDialog({ open, settings, busy, error, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  // The backend refuses "a folder I choose" without a path; saying so here
  // saves the user a round trip that only ends in a generic failure.
  const missingPath =
    draft.screenshot_dir === 'absolutePath' && (draft.screenshot_absolute_path ?? '').trim() === '';

  const fieldClass =
    'w-full rounded border border-[var(--inspector-border)] bg-white px-2 py-1 text-[13px] dark:bg-[#2d2d2d]';

  return (
    <dialog
      ref={dialogRef}
      aria-label="Editor settings"
      className="w-[min(92vw,360px)] rounded border border-[var(--inspector-border)] bg-[var(--inspector-bg)] p-4 text-[var(--inspector-text)] shadow-lg backdrop:bg-black/30"
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            overlay_color: draft.overlay_color,
            crop_padding: draft.crop_padding,
            screenshot_dir: draft.screenshot_dir,
            screenshot_absolute_path:
              draft.screenshot_dir === 'absolutePath' ? draft.screenshot_absolute_path : null,
          });
        }}
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button type="button" className="text-[12px] text-[var(--inspector-muted)]" onClick={onClose}>
            Close
          </button>
        </header>

        <label className="block space-y-1 text-[12px]">
          <span className="font-semibold uppercase text-[var(--inspector-muted)]">Overlay colour</span>
          <input
            type="color"
            aria-label="Overlay colour"
            className="h-8 w-full cursor-pointer rounded border border-[var(--inspector-border)]"
            value={draft.overlay_color}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, overlay_color: event.target.value }))
            }
          />
        </label>

        <label className="block space-y-1 text-[12px]">
          <span className="font-semibold uppercase text-[var(--inspector-muted)]">Crop padding</span>
          <select
            aria-label="Crop padding"
            className={fieldClass}
            value={draft.crop_padding}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, crop_padding: Number(event.target.value) }))
            }
          >
            {PADDING_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}px
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-[12px]">
          <span className="font-semibold uppercase text-[var(--inspector-muted)]">Screenshot folder</span>
          <select
            aria-label="Screenshot folder"
            className={fieldClass}
            value={draft.screenshot_dir}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                screenshot_dir: event.target.value as ScreenshotDirMode,
              }))
            }
          >
            {(Object.keys(SCREENSHOT_DIR_LABELS) as ScreenshotDirMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SCREENSHOT_DIR_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        {draft.screenshot_dir === 'absolutePath' ? (
          <label className="block space-y-1 text-[12px]">
            <span className="font-semibold uppercase text-[var(--inspector-muted)]">Folder path</span>
            <input
              aria-label="Folder path"
              className={fieldClass}
              placeholder="/home/you/Pictures"
              aria-invalid={missingPath}
              value={draft.screenshot_absolute_path ?? ''}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  screenshot_absolute_path: event.target.value || null,
                }))
              }
            />
            {missingPath ? (
              <span className="text-[11px] text-[var(--inspector-danger,#f85149)]">
                Type the folder path, or choose one of the folders above.
              </span>
            ) : null}
          </label>
        ) : null}

        <p className="text-[11px] leading-snug text-[var(--inspector-muted)]">
          The overlay colour and crop padding apply straight away. The screenshot folder applies to
          the next screenshot you take.
        </p>

        {error ? <ErrorNotice message={error} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="rounded border border-[var(--inspector-border)] px-3 py-1 text-[12px]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-[var(--inspector-accent)] px-3 py-1 text-[12px] text-white disabled:opacity-50"
            disabled={busy || missingPath}
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}