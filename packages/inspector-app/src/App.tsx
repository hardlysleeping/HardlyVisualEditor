/**
 * Floating overlay shell — toolbar + optional context panel.
 * Location: packages/inspector-app/src/App.tsx
 */

import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { ContextPanel } from './components/ContextPanel.js';
import { ErrorNotice } from './components/ErrorNotice.js';
import { FloatingToolbar } from './components/FloatingToolbar.js';
import { OverlayShell } from './components/OverlayShell.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { useInspectorState } from './hooks/useInspectorState.js';
import { explainErrorLine } from './lib/messages.js';
import { setOverlayExpanded } from './lib/overlaySize.js';

const MESSAGE_TTL_MS = 2500;

async function runAction(
  fn: () => Promise<unknown>,
  setBusy: (value: boolean) => void,
  setMessage: (value: string | null) => void,
  success: string,
  messageTimer: { current: ReturnType<typeof setTimeout> | null },
): Promise<void> {
  if (messageTimer.current) clearTimeout(messageTimer.current);
  setBusy(true);
  setMessage(null);
  try {
    await fn();
    setMessage(success);
    messageTimer.current = setTimeout(() => {
      setMessage(null);
      messageTimer.current = null;
    }, MESSAGE_TTL_MS);
  } catch (error) {
    setMessage(explainErrorLine(error));
    messageTimer.current = setTimeout(() => {
      setMessage(null);
      messageTimer.current = null;
    }, 6000);
  } finally {
    setBusy(false);
  }
}

export function App() {
  const { state, error } = useInspectorState();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [devtoolsActive, setDevtoolsActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [issueText, setIssueText] = useState('');
  const prevSelectionCount = useRef(0);
  const prevCaptureCount = useRef(0);
  const issueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state?.session.issue_text != null) {
      setIssueText(state.session.issue_text);
    }
  }, [state?.session.issue_text]);

  useEffect(() => {
    const count = state?.session.selected_elements.length ?? 0;
    if (count > 0 && count !== prevSelectionCount.current) {
      setPanelOpen(true);
    }
    prevSelectionCount.current = count;
  }, [state?.session.selected_elements.length]);

  useEffect(() => {
    const count = state?.session.captures.length ?? 0;
    if (count > 0 && count !== prevCaptureCount.current) {
      setPanelOpen(true);
    }
    prevCaptureCount.current = count;
  }, [state?.session.captures.length]);

  useEffect(() => {
    void setOverlayExpanded(panelOpen).catch(() => undefined);
  }, [panelOpen]);

  useEffect(() => {
    if (issueTimer.current) {
      clearTimeout(issueTimer.current);
    }
    issueTimer.current = setTimeout(() => {
      void api.setIssueText(issueText).catch(() => undefined);
    }, 400);
    return () => {
      if (issueTimer.current) {
        clearTimeout(issueTimer.current);
      }
    };
  }, [issueText]);

  if (error) {
    return (
      <main className="min-h-screen bg-transparent p-2">
        <ErrorNotice message={error} />
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen bg-transparent p-2 text-xs text-[var(--inspector-muted)]">Loading…</main>
    );
  }

  const handleToggleDevtools = async (): Promise<boolean> => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setBusy(true);
    setMessage(null);
    try {
      const open = await api.toggleDevtools();
      setDevtoolsActive(open);
      setMessage(open ? 'Developer tools opened' : 'Developer tools closed');
      messageTimer.current = setTimeout(() => {
        setMessage(null);
        messageTimer.current = null;
      }, MESSAGE_TTL_MS);
      return open;
    } catch (error) {
      setMessage(explainErrorLine(error));
      messageTimer.current = setTimeout(() => {
        setMessage(null);
        messageTimer.current = null;
      }, 4000);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-transparent">
      <OverlayShell panelOpen={panelOpen}>
        {panelOpen ? (
        <ContextPanel
          elements={state.session.selected_elements}
          webviews={state.webviews}
          editHistory={state.edit_history}
          captures={state.session.captures}
          issueText={issueText}
          busy={busy}
          message={message}
          onIssueChange={(value) => {
            setIssueText(value);
            if (value.trim() && state.enabled) {
              void api.disable().catch(() => undefined);
            }
          }}
          onCopy={(full, blocks) =>
            runAction(
              () => api.copyContextBundle(full, blocks),
              setBusy,
              setMessage,
              full ? 'Context bundle copied' : 'Composer prompt copied',
              messageTimer,
            )
          }
          onClear={async () => {
            setIssueText('');
            await runAction(api.clearSession, setBusy, setMessage, 'Selection cleared', messageTimer);
          }}
        />
        ) : null}

        <FloatingToolbar
          pickerActive={state.enabled}
          panelOpen={panelOpen}
          devtoolsActive={devtoolsActive}
          busy={busy}
          onHardReload={() =>
            void runAction(() => api.hardReload(), setBusy, setMessage, 'Page reloaded', messageTimer)
          }
          onScreenshot={() =>
            void runAction(() => api.capture({ mode: 'webview' }), setBusy, setMessage, 'Screenshot saved', messageTimer)
          }
          onTogglePicker={() => {
            if (state.enabled) {
              void runAction(api.disable, setBusy, setMessage, 'Picker off', messageTimer);
            } else {
              void runAction(api.enable, setBusy, setMessage, 'Picker on', messageTimer);
            }
          }}
          onTogglePanel={() => {
            if (messageTimer.current) clearTimeout(messageTimer.current);
            setMessage(null);
            setPanelOpen((open) => !open);
          }}
          onToggleDevtools={() => void handleToggleDevtools()}
          onOpenSettings={() => {
            setSettingsError(null);
            setSettingsOpen(true);
          }}
        />
      </OverlayShell>
      <SettingsDialog
        open={settingsOpen}
        settings={state.settings}
        busy={busy}
        error={settingsError}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsError(null);
        }}
        onSave={(patch) => {
          if (messageTimer.current) clearTimeout(messageTimer.current);
          setBusy(true);
          setSettingsError(null);
          void api
            .updateSettings(patch)
            .then(() => {
              setSettingsOpen(false);
              setMessage('Settings saved');
              messageTimer.current = setTimeout(() => {
                setMessage(null);
                messageTimer.current = null;
              }, MESSAGE_TTL_MS);
            })
            .catch((reason: unknown) => {
              setSettingsError(reason instanceof Error ? reason.message : String(reason));
            })
            .finally(() => setBusy(false));
        }}
      />
    </main>
  );
}
