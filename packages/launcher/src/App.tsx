import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  addProject,
  discoverProjects,
  discoverRoots,
  isDesktop,
  launchProject,
  listProjects,
  openProjectFolder,
  openProjectUrl,
  removeProject,
  runningProjects,
  stopProject,
  subscribeLogs,
  subscribeStatus,
  subscribeUrl,
  updateProject,
} from './api.js';
import type {
  AdapterKind,
  DiscoverRoot,
  LogEntry,
  Project,
  ProjectCandidate,
  RunStatus,
} from './types.js';

const MAX_LOG_LINES = 600;

const adapterLabel: Record<AdapterKind, string> = {
  svelte: 'Svelte adapter',
  'css-html': 'CSS/HTML adapter',
  unknown: 'No adapter',
};

function relativeTime(value: number | null): string {
  if (!value) return 'never launched';
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function StatusDot({ state }: { state: RunStatus['state'] | 'idle' }) {
  const color =
    state === 'running'
      ? 'var(--hui-ok)'
      : state === 'starting'
        ? 'var(--hui-warn)'
        : state === 'failed'
          ? 'var(--hui-danger)'
          : 'var(--hui-border-strong)';
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${state === 'running' ? 'hui-status-running' : ''}`}
      style={{ background: color }}
    />
  );
}

function Chip({ tone = 'muted', children }: { tone?: 'muted' | 'accent' | 'ok' | 'warn'; children: ReactNode }) {
  const palette =
    tone === 'accent'
      ? { border: 'var(--hui-accent)', color: 'var(--hui-accent)', background: 'var(--hui-accent-soft)' }
      : tone === 'ok'
        ? { border: '#3fb95055', color: 'var(--hui-ok)', background: '#3fb95012' }
        : tone === 'warn'
          ? { border: '#d2992255', color: 'var(--hui-warn)', background: '#d2992212' }
          : { border: 'var(--hui-border)', color: 'var(--hui-muted)', background: 'transparent' };
  return (
    <span
      className="rounded border px-1.5 py-[1px] text-[10px] leading-4"
      style={{ borderColor: palette.border, color: palette.color, background: palette.background }}
    >
      {children}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
      style={{
        borderColor: 'var(--hui-border)',
        color: danger ? 'var(--hui-danger)' : 'var(--hui-muted)',
        background: 'transparent',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = danger ? 'var(--hui-danger)' : 'var(--hui-border-strong)';
        event.currentTarget.style.color = danger ? 'var(--hui-danger)' : 'var(--hui-text)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--hui-border)';
        event.currentTarget.style.color = danger ? 'var(--hui-danger)' : 'var(--hui-muted)';
      }}
    >
      {children}
    </button>
  );
}

function ProjectCard({
  project,
  status,
  hasLogs,
  onLaunch,
  onStop,
  onLogs,
  onFolder,
  onOpenUrl,
  onRemove,
  onSave,
  launching,
}: {
  project: Project;
  status: RunStatus | undefined;
  hasLogs: boolean;
  onLaunch: () => void;
  onStop: () => void;
  onLogs: () => void;
  onFolder: () => void;
  onOpenUrl: () => void;
  onRemove: () => void;
  onSave: (patch: { devCommand?: string; name?: string; container?: string }) => Promise<void>;
  launching: boolean;
}) {
  const [command, setCommand] = useState(project.devCommand);
  const [editingCommand, setEditingCommand] = useState(false);
  const [container, setContainer] = useState(project.container ?? '');
  const [editingContainer, setEditingContainer] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = status?.state ?? 'idle';
  const running = state === 'running' || state === 'starting';
  const wired = project.initialized || project.overlayConfig;

  useEffect(() => {
    setCommand(project.devCommand);
  }, [project.devCommand]);

  useEffect(() => {
    setContainer(project.container ?? '');
  }, [project.container]);

  const commitContainer = async () => {
    if (container.trim() === (project.container ?? '')) {
      setEditingContainer(false);
      return;
    }
    setSaving(true);
    try {
      // An empty value is how a project goes back to running on the host.
      await onSave({ container: container.trim() });
      setEditingContainer(false);
    } catch {
      // Stay in edit mode; the app-level banner carries the reason.
    } finally {
      setSaving(false);
    }
  };

  const commit = async () => {
    if (command.trim() === project.devCommand) {
      setEditingCommand(false);
      return;
    }
    setSaving(true);
    try {
      await onSave({ devCommand: command.trim() });
      setEditingCommand(false);
    } catch {
      // Stay in edit mode; the app-level banner carries the reason.
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      className="flex min-h-[196px] flex-col gap-3 rounded-lg border p-3.5 transition-colors"
      style={{ borderColor: 'var(--hui-border)', background: 'var(--hui-panel)' }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = 'var(--hui-border-strong)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--hui-border)';
      }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 flex items-center gap-2">
          <StatusDot state={state} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-5" title={project.name}>
            {project.name}
          </h2>
          <p
            className="truncate font-mono text-[10px] leading-4"
            style={{ color: 'var(--hui-muted)' }}
            title={project.path}
          >
            {project.path}
          </p>
        </div>
        <span className="shrink-0 text-[10px]" style={{ color: 'var(--hui-muted)' }}>
          {relativeTime(project.lastOpened)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={project.adapter === 'unknown' ? 'muted' : 'accent'}>{adapterLabel[project.adapter]}</Chip>
        {project.webApp ? <Chip tone="muted">Web app</Chip> : null}
        <Chip tone={project.initialized ? 'ok' : 'warn'}>{project.initialized ? 'Initialized' : 'Not initialized'}</Chip>
        {project.overlayConfig ? <Chip tone="ok">Dev overlay</Chip> : <Chip tone="warn">No overlay config</Chip>}
        {project.container ? <Chip tone="muted">runs in {project.container}</Chip> : null}
        {status?.pid ? <Chip tone="muted">pid {status.pid}</Chip> : null}
      </div>

      <div className="min-w-0">
        <label className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--hui-muted)' }}>
          Dev command
        </label>
        {editingCommand ? (
          <div className="mt-1 flex items-center gap-1.5">
            <input
              autoFocus
              value={command}
              onChange={(event) => setCommand(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commit();
                if (event.key === 'Escape') {
                  setCommand(project.devCommand);
                  setEditingCommand(false);
                }
              }}
              spellCheck={false}
              className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-[11px]"
              style={{ borderColor: 'var(--hui-accent)', background: '#0d1117', color: 'var(--hui-text)' }}
              aria-label={`${project.name} dev command`}
            />
            <button
              type="button"
              onClick={() => void commit()}
              disabled={saving}
              className="rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ background: 'var(--hui-accent)', color: '#08121f' }}
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingCommand(true)}
            className="mt-1 block w-full truncate rounded border px-2 py-1 text-left font-mono text-[11px]"
            style={{ borderColor: 'var(--hui-border)', background: '#0d1117', color: 'var(--hui-text)' }}
            title={`Edit dev command — currently: ${project.devCommand}`}
          >
            {project.devCommand || 'No command set'}
          </button>
        )}
      </div>

      <div className="min-w-0">
        <label className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--hui-muted)' }}>
          Web address
        </label>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate rounded border px-2 py-1 font-mono text-[11px]"
            style={{ borderColor: 'var(--hui-border)', background: '#0d1117', color: project.webUrl ? 'var(--hui-text)' : 'var(--hui-muted)' }}
            title={project.webUrl ?? 'Launch once so the launcher can read the address from the dev output'}
          >
            {project.webUrl ?? 'not known yet — launch once'}
          </span>
          <button
            type="button"
            onClick={onOpenUrl}
            disabled={!project.webUrl}
            title={project.webUrl ? `Open ${project.webUrl} in the browser` : 'No address known yet'}
            className="shrink-0 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--hui-border-strong)', color: 'var(--hui-text)' }}
          >
            Open ↗
          </button>
        </div>
      </div>

      {project.webApp ? null : (
        <div className="min-w-0">
          <label className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--hui-muted)' }}>
            Runs in container
          </label>
          {editingContainer ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                autoFocus
                value={container}
                onChange={(event) => setContainer(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitContainer();
                  if (event.key === 'Escape') {
                    setContainer(project.container ?? '');
                    setEditingContainer(false);
                  }
                }}
                spellCheck={false}
                placeholder="host"
                className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-[11px]"
                style={{ borderColor: 'var(--hui-accent)', background: '#0d1117', color: 'var(--hui-text)' }}
                aria-label={`${project.name} container`}
              />
              <button
                type="button"
                onClick={() => void commitContainer()}
                disabled={saving}
                className="rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                style={{ background: 'var(--hui-accent)', color: '#08121f' }}
              >
                {saving ? 'Saving' : 'Save'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingContainer(true)}
              className="mt-1 block w-full truncate rounded border px-2 py-1 text-left font-mono text-[11px]"
              style={{ borderColor: 'var(--hui-border)', background: '#0d1117', color: 'var(--hui-text)' }}
              title={`Edit the container — clear it to run on the host`}
            >
              {project.container ?? 'host (this machine)'}
            </button>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5">
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="flex-1 rounded px-2 py-1.5 text-[11px] font-semibold"
            style={{ background: '#f8514918', color: 'var(--hui-danger)', border: '1px solid #f8514955' }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onLaunch}
            disabled={launching || !project.devCommand}
            title={
              project.webApp
                ? `Start ${project.name} and open it in the browser`
                : wired
                  ? `Start ${project.name} with the editor enabled`
                  : `${project.name} has no editor wiring yet; run \`hardlyui init\` in it to edit. Launching starts it without the editor.`
            }
            className="flex-1 rounded px-2 py-1.5 text-[11px] font-semibold transition-opacity disabled:opacity-50"
            style={
              wired || project.webApp
                ? { background: 'var(--hui-accent)', color: '#08121f' }
                : { background: '#d2992222', color: 'var(--hui-warn)', border: '1px solid #d2992255' }
            }
          >
            {launching
              ? 'Launching…'
              : project.webApp
                ? 'Launch & open'
                : wired
                  ? 'Launch to edit'
                  : 'Launch (no editor)'}
          </button>
        )}
        <IconButton label={`Show ${project.name} logs`} onClick={onLogs} disabled={!hasLogs && !running}>
          Logs
        </IconButton>
        <IconButton label={`Open ${project.name} folder`} onClick={onFolder}>
          Folder
        </IconButton>
        <IconButton label={`Remove ${project.name} from the launcher`} onClick={onRemove} danger>
          Remove
        </IconButton>
      </div>
    </article>
  );
}

function LogPanel({
  project,
  status,
  entries,
  onClose,
  onClear,
}: {
  project: Project;
  status: RunStatus | undefined;
  entries: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length]);

  return (
    <section
      className="flex h-[36vh] min-h-[180px] shrink-0 flex-col border-t"
      style={{ borderColor: 'var(--hui-border)', background: '#080a0c' }}
      aria-label={`${project.name} logs`}
    >
      <header
        className="flex items-center gap-2 border-b px-3 py-1.5"
        style={{ borderColor: 'var(--hui-border)' }}
      >
        <StatusDot state={status?.state ?? 'idle'} />
        <span className="text-[11px] font-semibold">{project.name}</span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--hui-muted)' }}>
          {status?.state ?? 'idle'}
          {status?.exitCode != null ? ` · exit ${status.exitCode}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClear}
            className="rounded border px-2 py-0.5 text-[10px]"
            style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-0.5 text-[10px]"
            style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
          >
            Hide
          </button>
        </div>
      </header>
      <div ref={bodyRef} className="hui-scroll min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-[11px] leading-[1.55]">
        {entries.length === 0 ? (
          <p style={{ color: 'var(--hui-muted)' }}>No output yet. Launch the project to stream its dev server here.</p>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.at}-${index}`}
              className="whitespace-pre-wrap break-words"
              style={{
                color:
                  entry.stream === 'stderr'
                    ? 'var(--hui-danger)'
                    : entry.stream === 'system'
                      ? 'var(--hui-muted)'
                      : 'var(--hui-text)',
              }}
            >
              {entry.line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RunStatus>>({});
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [logProjectId, setLogProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addPath, setAddPath] = useState('');
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [candidates, setCandidates] = useState<ProjectCandidate[]>([]);
  const [roots, setRoots] = useState<DiscoverRoot[]>([]);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    const start = async () => {
      try {
        const [nextProjects, running] = await Promise.all([listProjects(), runningProjects()]);
        if (!alive) return;
        setProjects(nextProjects);
        setStatuses(
          Object.fromEntries(
            nextProjects.map((project) => [
              project.id,
              running.find((entry) => entry.projectId === project.id) ?? { projectId: project.id, state: 'stopped' as const },
            ]),
          ),
        );
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void start();

    const unlisteners: Array<() => void> = [];
    let cancelled = false;
    const track = (unlisten: () => void) => {
      if (cancelled) unlisten();
      else unlisteners.push(unlisten);
    };
    void subscribeLogs((entry) => {
      setLogs((current) => {
        const next = [...(current[entry.projectId] ?? []), entry];
        return {
          ...current,
          [entry.projectId]: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next,
        };
      });
    }).then(track);
    void subscribeStatus((status) => {
      setStatuses((current) => ({ ...current, [status.projectId]: status }));
    }).then(track);
    void subscribeUrl((event) => {
      setProjects((current) =>
        current.map((entry) => (entry.id === event.projectId ? { ...entry, webUrl: event.url } : entry)),
      );
    }).then(track);

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    window.setTimeout(() => addInputRef.current?.focus(), 30);
  }, [addOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setAddOpen(true);
      }
      if (event.key === 'Escape') {
        setAddOpen(false);
        setDiscoverOpen(false);
        setRemoveTarget(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...projects].sort((left, right) => {
      const leftRunning = statuses[left.id]?.state === 'running' || statuses[left.id]?.state === 'starting';
      const rightRunning = statuses[right.id]?.state === 'running' || statuses[right.id]?.state === 'starting';
      if (leftRunning !== rightRunning) return leftRunning ? -1 : 1;
      return (right.lastOpened ?? 0) - (left.lastOpened ?? 0) || left.name.localeCompare(right.name);
    });
    if (!needle) return sorted;
    return sorted.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle),
    );
  }, [projects, query, statuses]);

  const logProject = projects.find((project) => project.id === logProjectId) ?? null;

  const handleAdd = async () => {
    if (!addPath.trim()) return;
    setAddBusy(true);
    setError(null);
    try {
      const project = await addProject(addPath.trim(), addName.trim() || undefined);
      setProjects((current) => [...current.filter((entry) => entry.id !== project.id), project]);
      setStatuses((current) => ({ ...current, [project.id]: { projectId: project.id, state: 'stopped' } }));
      setAddOpen(false);
      setAddPath('');
      setAddName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAddBusy(false);
    }
  };

  const handleDiscover = async () => {
    setDiscoverOpen(true);
    setDiscoverBusy(true);
    setError(null);
    try {
      const [found, scannedRoots] = await Promise.all([discoverProjects(), discoverRoots()]);
      setCandidates(found);
      setRoots(scannedRoots);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDiscoverBusy(false);
    }
  };

  const handleLaunch = async (project: Project) => {
    setLaunching(project.id);
    setError(null);
    setLogProjectId(project.id);
    try {
      const status = await launchProject(project.id);
      setStatuses((current) => ({ ...current, [project.id]: status }));
      setProjects((current) =>
        current.map((entry) => (entry.id === project.id ? { ...entry, lastOpened: Date.now() } : entry)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatuses((current) => ({
        ...current,
        [project.id]: { projectId: project.id, state: 'failed', message: String(reason) },
      }));
    } finally {
      setLaunching(null);
    }
  };

  const handleStop = async (project: Project) => {
    setError(null);
    try {
      await stopProject(project.id);
      setStatuses((current) => ({ ...current, [project.id]: { projectId: project.id, state: 'stopped' } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleRemove = async (project: Project) => {
    setRemoveBusy(true);
    setError(null);
    try {
      await removeProject(project.id);
      setProjects((current) => current.filter((entry) => entry.id !== project.id));
      if (logProjectId === project.id) setLogProjectId(null);
      setRemoveTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleSave = async (
    project: Project,
    patch: { devCommand?: string; name?: string; container?: string },
  ) => {
    setError(null);
    try {
      const next = await updateProject(project.id, patch);
      setProjects((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    }
  };

  const handleOpenFolder = async (project: Project) => {
    try {
      await openProjectFolder(project.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleOpenUrl = async (project: Project) => {
    setError(null);
    try {
      const url = await openProjectUrl(project.id, project.webUrl ?? undefined);
      setProjects((current) =>
        current.map((entry) => (entry.id === project.id ? { ...entry, webUrl: url } : entry)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const runningCount = projects.filter((project) => {
    const state = statuses[project.id]?.state;
    return state === 'running' || state === 'starting';
  }).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-4 pb-2.5 pt-3" style={{ borderColor: 'var(--hui-border)', background: '#0b0d10ee' }}>
        <div className="flex items-end gap-3">
          <div className="min-w-0">
            <h1 className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
              HardlyUI
              <span className="font-mono text-[10px] font-normal" style={{ color: 'var(--hui-muted)' }}>
                project launcher
              </span>
            </h1>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--hui-muted)' }}>
              {projects.length === 0
                ? 'Pick a Hardly project, start its dev build, edit it in place.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'}${
                    runningCount ? ` · ${runningCount} running` : ''
                  }${isDesktop ? '' : ' · browser preview (mock data)'}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Filter projects"
                spellCheck={false}
                className="w-44 rounded border py-1 pl-2 pr-9 text-[11px]"
                style={{ borderColor: 'var(--hui-border)', background: 'var(--hui-panel)', color: 'var(--hui-text)' }}
                aria-label="Filter projects"
              />
              <kbd
                className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded border px-1 font-mono text-[9px]"
                style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
              >
                ⌘K
              </kbd>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="rounded border px-2.5 py-1 text-[11px] font-medium"
              style={{ borderColor: 'var(--hui-border-strong)', color: 'var(--hui-text)' }}
            >
              Add project
            </button>
            <button
              type="button"
              onClick={() => void handleDiscover()}
              className="rounded px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'var(--hui-accent)', color: '#08121f' }}
            >
              Scan for projects
            </button>
          </div>
        </div>
        {error ? (
          <div
            className="mt-2 flex items-start gap-2 rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: '#f8514955', background: '#f8514910', color: 'var(--hui-danger)' }}
            role="alert"
          >
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              ✕
            </button>
          </div>
        ) : null}
      </header>

      {isDesktop ? null : (
        <div
          className="shrink-0 border-b px-4 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--hui-border)', background: '#d2992214', color: 'var(--hui-warn)' }}
          role="note"
        >
          Browser preview — sample projects and simulated launches. Nothing here starts a real app; run the installed
          HardlyUI window to launch one.
        </div>
      )}

      <main className="hui-scroll min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-[12px]" style={{ color: 'var(--hui-muted)' }}>
            Loading project registry…
          </p>
        ) : filtered.length === 0 ? (
          <div
            className="mx-auto mt-10 max-w-[420px] rounded-lg border border-dashed px-5 py-7 text-center"
            style={{ borderColor: 'var(--hui-border-strong)', background: 'var(--hui-panel)' }}
          >
            <h2 className="text-[13px] font-semibold">
              {projects.length === 0 ? 'No projects in the launcher yet' : 'No projects match that filter'}
            </h2>
            <p className="mt-1.5 text-[11px] leading-5" style={{ color: 'var(--hui-muted)' }}>
              {projects.length === 0
                ? 'Scan your app folders to find every Tauri project at once, or add one by path. The launcher only records the location and dev command — it never edits project files.'
                : 'Try a shorter filter, or clear it to see every project.'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void handleDiscover()}
                className="rounded px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: 'var(--hui-accent)', color: '#08121f' }}
              >
                Scan for projects
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="rounded border px-3 py-1.5 text-[11px]"
                style={{ borderColor: 'var(--hui-border-strong)', color: 'var(--hui-text)' }}
              >
                Add by path
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                status={statuses[project.id]}
                hasLogs={(logs[project.id]?.length ?? 0) > 0}
                launching={launching === project.id}
                onLaunch={() => void handleLaunch(project)}
                onStop={() => void handleStop(project)}
                onLogs={() => setLogProjectId(project.id)}
                onFolder={() => void handleOpenFolder(project)}
                onOpenUrl={() => void handleOpenUrl(project)}
                onRemove={() => setRemoveTarget(project)}
                onSave={(patch) => handleSave(project, patch)}
              />
            ))}
          </div>
        )}
      </main>

      {logProject ? (
        <LogPanel
          project={logProject}
          status={statuses[logProject.id]}
          entries={logs[logProject.id] ?? []}
          onClose={() => setLogProjectId(null)}
          onClear={() => setLogs((current) => ({ ...current, [logProject.id]: [] }))}
        />
      ) : null}

      {removeTarget ? (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center p-6 pt-[14vh]"
          style={{ background: '#000000a8' }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !removeBusy) setRemoveTarget(null);
          }}
        >
          <div
            className="w-full max-w-[430px] rounded-lg border p-4 shadow-2xl"
            style={{ borderColor: 'var(--hui-border-strong)', background: 'var(--hui-panel-raised)' }}
            role="dialog"
            aria-modal="true"
            aria-label={`Remove ${removeTarget.name} from the launcher`}
          >
            <h2 className="text-[13px] font-semibold">Remove {removeTarget.name}?</h2>
            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--hui-muted)' }}>
              The launcher forgets this path and dev command. Project files are not touched: nothing inside{' '}
              <span className="font-mono" style={{ color: 'var(--hui-text)' }}>
                {removeTarget.path}
              </span>{' '}
              is deleted or changed. Add it again by path whenever you want it back.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                disabled={removeBusy}
                className="rounded border px-3 py-1.5 text-[11px] disabled:opacity-50"
                style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRemove(removeTarget)}
                disabled={removeBusy}
                className="rounded border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--hui-danger)', color: 'var(--hui-danger)', background: '#f8514912' }}
              >
                {removeBusy ? 'Removing…' : 'Remove project'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center p-6 pt-[14vh]"
          style={{ background: '#000000a8' }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAddOpen(false);
          }}
        >
          <div
            className="w-full max-w-[460px] rounded-lg border p-4 shadow-2xl"
            style={{ borderColor: 'var(--hui-border-strong)', background: 'var(--hui-panel-raised)' }}
            role="dialog"
            aria-modal="true"
            aria-label="Add a project"
          >
            <h2 className="text-[13px] font-semibold">Add a project</h2>
            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--hui-muted)' }}>
              Point the launcher at a Tauri project folder. It records the path and dev command; it does not modify
              anything inside the project.
            </p>
            <label className="mt-3 block text-[10px] uppercase tracking-wide" style={{ color: 'var(--hui-muted)' }}>
              Project folder
            </label>
            <input
              ref={addInputRef}
              value={addPath}
              onChange={(event) => setAddPath(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
              }}
              placeholder="/home/you/apps/my-app"
              spellCheck={false}
              className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-[11px]"
              style={{ borderColor: 'var(--hui-border)', background: '#0d1117', color: 'var(--hui-text)' }}
            />
            <label className="mt-2.5 block text-[10px] uppercase tracking-wide" style={{ color: 'var(--hui-muted)' }}>
              Display name (optional)
            </label>
            <input
              value={addName}
              onChange={(event) => setAddName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
              }}
              placeholder="My app"
              className="mt-1 w-full rounded border px-2 py-1.5 text-[11px]"
              style={{ borderColor: 'var(--hui-border)', background: '#0d1117', color: 'var(--hui-text)' }}
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded border px-3 py-1.5 text-[11px]"
                style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={addBusy || !addPath.trim()}
                className="rounded px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--hui-accent)', color: '#08121f' }}
              >
                {addBusy ? 'Adding…' : 'Add project'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {discoverOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-start justify-center p-6 pt-[10vh]"
          style={{ background: '#000000a8' }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDiscoverOpen(false);
          }}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-[620px] flex-col rounded-lg border shadow-2xl"
            style={{ borderColor: 'var(--hui-border-strong)', background: 'var(--hui-panel-raised)' }}
            role="dialog"
            aria-modal="true"
            aria-label="Scan for projects"
          >
            <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--hui-border)' }}>
              <h2 className="text-[13px] font-semibold">Projects found</h2>
              <span className="font-mono text-[10px]" style={{ color: 'var(--hui-muted)' }}>
                {roots.filter((root) => root.exists).map((root) => root.path).join(' · ')}
              </span>
              <button
                type="button"
                onClick={() => setDiscoverOpen(false)}
                className="ml-auto rounded border px-2 py-0.5 text-[10px]"
                style={{ borderColor: 'var(--hui-border)', color: 'var(--hui-muted)' }}
              >
                Close
              </button>
            </header>
            <div className="hui-scroll min-h-0 flex-1 overflow-auto p-3">
              {discoverBusy ? (
                <p className="px-1 py-2 text-[11px]" style={{ color: 'var(--hui-muted)' }}>
                  Scanning app folders for Tauri projects…
                </p>
              ) : candidates.length === 0 ? (
                <p className="px-1 py-2 text-[11px] leading-5" style={{ color: 'var(--hui-muted)' }}>
                  No Tauri projects found in the scanned folders. Use “Add project” and paste a project path instead.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {candidates.map((candidate) => (
                    <li
                      key={candidate.path}
                      className="flex items-center gap-2 rounded border px-2.5 py-2"
                      style={{ borderColor: 'var(--hui-border)', background: 'var(--hui-panel)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium">{candidate.name}</p>
                        <p className="truncate font-mono text-[10px]" style={{ color: 'var(--hui-muted)' }}>
                          {candidate.path}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Chip tone={candidate.adapter === 'unknown' ? 'muted' : 'accent'}>
                            {adapterLabel[candidate.adapter]}
                          </Chip>
                          <Chip tone={candidate.initialized ? 'ok' : 'warn'}>
                            {candidate.initialized ? 'Initialized' : 'Needs init'}
                          </Chip>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={candidate.registered}
                        onClick={async () => {
                          try {
                            const project = await addProject(candidate.path);
                            setProjects((current) => [...current, project]);
                            setStatuses((current) => ({
                              ...current,
                              [project.id]: { projectId: project.id, state: 'stopped' },
                            }));
                            setCandidates((current) =>
                              current.map((entry) =>
                                entry.path === candidate.path ? { ...entry, registered: true } : entry,
                              ),
                            );
                          } catch (reason) {
                            setError(reason instanceof Error ? reason.message : String(reason));
                          }
                        }}
                        className="rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-45"
                        style={{ background: 'var(--hui-accent)', color: '#08121f' }}
                      >
                        {candidate.registered ? 'Added' : 'Add'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}