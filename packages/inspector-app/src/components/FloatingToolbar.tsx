/**
 * Vertical icon toolbar for the floating inspector overlay.
 * Location: packages/inspector-app/src/components/FloatingToolbar.tsx
 */

import type { ReactNode } from 'react';
import { IconContext, IconDevtools, IconInspectPicker, IconReload, IconScreenshot, IconSettings } from '../lib/icons.js';
import { Tooltip } from './Tooltip.js';

type Props = {
  pickerActive: boolean;
  panelOpen: boolean;
  devtoolsActive?: boolean;
  busy: boolean;
  onHardReload: () => void;
  onScreenshot: () => void;
  onTogglePicker: () => void;
  onTogglePanel: () => void;
  onToggleDevtools: () => void;
  onOpenSettings: () => void;
};

function IconButton({
  label,
  tooltip,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip text={tooltip}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={[
          'flex h-11 w-11 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-[var(--inspector-accent)] bg-[var(--inspector-accent)] text-white'
          : 'border-[var(--inspector-border)] bg-[#2a2a2a] text-[var(--inspector-text)] hover:border-[var(--inspector-accent)] hover:bg-[#3d444d] active:scale-95',
          disabled ? 'opacity-50' : '',
        ].join(' ')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function FloatingToolbar({
  pickerActive,
  panelOpen,
  devtoolsActive = false,
  busy,
  onHardReload,
  onScreenshot,
  onTogglePicker,
  onTogglePanel,
  onToggleDevtools,
  onOpenSettings,
}: Props) {
  return (
    <nav className="flex flex-col gap-2" aria-label="Visual Inspector">
      <IconButton
        label="Hard reload"
        tooltip="Hard Reload (Clear Cache)"
        disabled={busy}
        onClick={onHardReload}
      >
        <IconReload />
      </IconButton>
      <IconButton
        label="Screenshot"
        tooltip="Take a Screenshot"
        disabled={busy}
        onClick={onScreenshot}
      >
        <IconScreenshot />
      </IconButton>
      <IconButton
        label="Element picker"
        tooltip="Visual Inspector (Inspect Elements in UI)"
        active={pickerActive}
        disabled={busy}
        onClick={onTogglePicker}
      >
        <IconInspectPicker />
      </IconButton>
      <IconButton
        label="Context panel"
        tooltip="Context Box (Write Text, Edit Screenshots, Analyze inspected UI)"
        active={panelOpen}
        disabled={busy}
        onClick={onTogglePanel}
      >
        <IconContext />
      </IconButton>
      <IconButton
        label="Console"
        tooltip="Devtools (Elements, Console, Network etc..)"
        active={devtoolsActive}
        disabled={busy}
        onClick={onToggleDevtools}
      >
        <IconDevtools />
      </IconButton>
      <IconButton
        label="Settings"
        tooltip="Editor Settings (Overlay Colour, Crop Padding, Screenshot Folder)"
        disabled={busy}
        onClick={onOpenSettings}
      >
        <IconSettings />
      </IconButton>
    </nav>
  );
}
