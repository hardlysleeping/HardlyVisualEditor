import type {
  DiscoverRoot,
  LogEntry,
  Project,
  ProjectCandidate,
  ProjectPatch,
  RunStatus,
  UrlEvent,
} from './types.js';

type Unlisten = () => void;

const tauriWindow = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
export const isDesktop = '__TAURI_INTERNALS__' in tauriWindow;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export const LOG_EVENT = 'launcher:log';
export const STATUS_EVENT = 'launcher:status';
export const URL_EVENT = 'launcher:url';

export async function listProjects(): Promise<Project[]> {
  if (isDesktop) return invoke<Project[]>('list_projects');
  return mock.listProjects();
}

export async function addProject(path: string, name?: string): Promise<Project> {
  if (isDesktop) return invoke<Project>('add_project', { path, name: name ?? null });
  return mock.addProject(path, name);
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  if (isDesktop) return invoke<Project>('update_project', { id, patch });
  return mock.updateProject(id, patch);
}

export async function removeProject(id: string): Promise<void> {
  if (isDesktop) return invoke<void>('remove_project', { id });
  return mock.removeProject(id);
}

export async function discoverProjects(): Promise<ProjectCandidate[]> {
  if (isDesktop) return invoke<ProjectCandidate[]>('discover_projects', { roots: null });
  return mock.discoverProjects();
}

export async function discoverRoots(): Promise<DiscoverRoot[]> {
  if (isDesktop) return invoke<DiscoverRoot[]>('discover_roots');
  return mock.discoverRoots();
}

export async function launchProject(id: string): Promise<RunStatus> {
  if (isDesktop) return invoke<RunStatus>('launch_project', { id });
  return mock.launchProject(id);
}

export async function stopProject(id: string): Promise<void> {
  if (isDesktop) return invoke<void>('stop_project', { id });
  return mock.stopProject(id);
}

export async function runningProjects(): Promise<RunStatus[]> {
  if (isDesktop) return invoke<RunStatus[]>('running_projects');
  return mock.runningProjects();
}

export async function openProjectFolder(id: string): Promise<void> {
  if (isDesktop) return invoke<void>('open_project_folder', { id });
  return mock.openProjectFolder(id);
}

export async function openProjectUrl(id: string, url?: string): Promise<string> {
  if (isDesktop) return invoke<string>('open_project_url', { id, url: url ?? null });
  return mock.openProjectUrl(id, url);
}

export async function subscribeLogs(handler: (entry: LogEntry) => void): Promise<Unlisten> {
  if (!isDesktop) return mock.subscribeLogs(handler);
  const { listen } = await import('@tauri-apps/api/event');
  return listen<LogEntry>(LOG_EVENT, (event) => handler(event.payload));
}

export async function subscribeStatus(handler: (status: RunStatus) => void): Promise<Unlisten> {
  if (!isDesktop) return mock.subscribeStatus(handler);
  const { listen } = await import('@tauri-apps/api/event');
  return listen<RunStatus>(STATUS_EVENT, (event) => handler(event.payload));
}

export async function subscribeUrl(handler: (event: UrlEvent) => void): Promise<Unlisten> {
  if (!isDesktop) return mock.subscribeUrl(handler);
  const { listen } = await import('@tauri-apps/api/event');
  return listen<UrlEvent>(URL_EVENT, (event) => handler(event.payload));
}

/** Browser preview only: a small in-memory registry so the UI can be reviewed
 *  without a Tauri shell. Nothing here touches the disk. */
const mock = (() => {
  const now = Date.now();
  let projects: Project[] = [
    {
      id: 'mock-svelte',
      name: 'Notes app',
      path: '/home/you/apps/notes',
      devCommand: 'npm run tauri:dev',
      adapter: 'svelte',
      webApp: false,
      webUrl: null,
      container: 'huibuild',
      initialized: true,
      overlayConfig: true,
      lastOpened: now - 1000 * 60 * 60 * 20,
      notes: '',
    },
    {
      id: 'mock-desktop',
      name: 'Reader demo',
      path: '/home/you/apps/reader-demo',
      devCommand: 'npm run desktop:dev',
      adapter: 'svelte',
      webApp: false,
      webUrl: null,
      container: 'huibuild',
      initialized: true,
      overlayConfig: true,
      lastOpened: now - 1000 * 60 * 60 * 52,
      notes: '',
    },
    {
      id: 'mock-web',
      name: 'Docs site',
      path: '/home/you/apps/docs-site',
      devCommand: 'python3 -m http.server 8471',
      adapter: 'css-html',
      webApp: true,
      webUrl: 'http://localhost:8471/',
      container: null,
      initialized: false,
      overlayConfig: false,
      lastOpened: null,
      notes: 'Browser-served adapter; dev-only',
    },
  ];
  const logListeners = new Set<(entry: LogEntry) => void>();
  const statusListeners = new Set<(status: RunStatus) => void>();
  const urlListeners = new Set<(event: UrlEvent) => void>();
  const running = new Map<string, { timer: number; index: number }>();

  const emitLog = (entry: LogEntry) => logListeners.forEach((listener) => listener(entry));
  const emitStatus = (status: RunStatus) => statusListeners.forEach((listener) => listener(status));
  const emitUrl = (event: UrlEvent) => urlListeners.forEach((listener) => listener(event));

  const wait = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));

  return {
    listProjects: () => wait(projects.map((project) => ({ ...project }))),
    addProject: async (path: string, name?: string) => {
      const trimmed = path.trim().replace(/\/+$/, '');
      if (!trimmed) throw new Error('A project folder is required');
      if (projects.some((project) => project.path === trimmed)) {
        throw new Error('That project is already in the launcher');
      }
      const project: Project = {
        id: `mock-${Date.now().toString(36)}`,
        name: (name?.trim() || trimmed.split('/').pop() || 'Project').slice(0, 64),
        path: trimmed,
        devCommand: 'npm run tauri:hardlyui',
        adapter: 'unknown',
        webApp: false,
        webUrl: null,
        container: null,
        initialized: false,
        overlayConfig: false,
        lastOpened: null,
        notes: '',
      };
      projects = [...projects, project];
      return wait(project);
    },
    updateProject: async (id: string, patch: ProjectPatch) => {
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) throw new Error('Project not found');
      const next = { ...projects[index], ...patch } as Project;
      if (patch.container !== undefined) {
        // Mirrors the Rust side: an empty field means "run on the host".
        next.container = patch.container.trim() || null;
      }
      projects = projects.map((project, position) => (position === index ? next : project));
      return wait(next);
    },
    removeProject: async (id: string) => {
      projects = projects.filter((project) => project.id !== id);
      await wait(null);
    },
    discoverProjects: async () => {
      const candidates: ProjectCandidate[] = [
        {
          path: '/home/you/apps/hardlywatching',
          name: 'HardlyWatching',
          adapter: 'css-html',
          devCommand: 'npm run tauri:hardlyui',
          initialized: false,
          registered: projects.some((project) => project.path === '/home/you/apps/hardlywatching'),
        },
      ];
      return wait(candidates);
    },
    discoverRoots: async (): Promise<DiscoverRoot[]> =>
      wait([
        { path: '/home/you/apps', exists: true, candidateCount: 4 },
        { path: '/home/you/Documents/Codex', exists: true, candidateCount: 3 },
      ]),
    launchProject: async (id: string) => {
      const project = projects.find((candidate) => candidate.id === id);
      if (!project) throw new Error('Project not found');
      emitStatus({ projectId: id, state: 'starting', pid: null });
      const script = [
        `$ ${project.devCommand}`,
        `   Compiling hardlyui-launcher v0.1.0`,
        `    Finished dev [unoptimized + debuginfo] target(s)`,
        `     Running \`target/debug/hardlyui\``,
        `  HardlyUI inspector ready on project ${project.name}`,
      ];
      let index = 0;
      if (project.webUrl) {
        window.setTimeout(() => {
          emitUrl({ projectId: id, url: project.webUrl! });
          emitLog({ projectId: id, stream: 'stdout', line: `  Serving on ${project.webUrl}`, at: Date.now() });
        }, 900);
      }
      const timer = window.setInterval(() => {
        if (index === 1) emitStatus({ projectId: id, state: 'running', pid: 21401 });
        if (index < script.length) {
          emitLog({ projectId: id, stream: index === 0 ? 'system' : 'stdout', line: script[index], at: Date.now() });
          index += 1;
        } else {
          window.clearInterval(timer);
          running.delete(id);
        }
      }, 480);
      running.set(id, { timer, index });
      projects = projects.map((candidate) =>
        candidate.id === id ? { ...candidate, lastOpened: Date.now() } : candidate,
      );
      const initial: RunStatus = { projectId: id, state: 'starting', pid: null };
      return initial;
    },
    stopProject: async (id: string) => {
      const entry = running.get(id);
      if (entry) {
        window.clearInterval(entry.timer);
        running.delete(id);
      }
      emitLog({ projectId: id, stream: 'system', line: '^C dev server stopped', at: Date.now() });
      emitStatus({ projectId: id, state: 'stopped', pid: null, exitCode: 0 });
      await wait(null);
    },
    runningProjects: async (): Promise<RunStatus[]> =>
      [...running.keys()].map((projectId) => ({ projectId, state: 'running' as const, pid: 21401 })),
    openProjectFolder: async (_id: string) => {
      await wait(null);
    },
    openProjectUrl: async (id: string, url?: string) => {
      const project = projects.find((candidate) => candidate.id === id);
      const target = url ?? project?.webUrl ?? null;
      if (!target) throw new Error('This project has no web address yet');
      window.open(target, '_blank', 'noopener');
      return wait(target);
    },
    subscribeLogs: (handler: (entry: LogEntry) => void) => {
      logListeners.add(handler);
      return () => logListeners.delete(handler);
    },
    subscribeStatus: (handler: (status: RunStatus) => void) => {
      statusListeners.add(handler);
      return () => statusListeners.delete(handler);
    },
    subscribeUrl: (handler: (event: UrlEvent) => void) => {
      urlListeners.add(handler);
      return () => urlListeners.delete(handler);
    },
  };
})();