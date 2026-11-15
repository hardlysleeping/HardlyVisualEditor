export type AdapterKind = 'svelte' | 'css-html' | 'unknown';

export type Project = {
  id: string;
  name: string;
  path: string;
  devCommand: string;
  adapter: AdapterKind;
  webApp: boolean;
  webUrl: string | null;
  /** Container the dev command runs in, when this host cannot build it. */
  container: string | null;
  initialized: boolean;
  overlayConfig: boolean;
  lastOpened: number | null;
  notes: string;
};

export type ProjectCandidate = {
  path: string;
  name: string;
  adapter: AdapterKind;
  devCommand: string;
  initialized: boolean;
  registered: boolean;
};

export type ProjectPatch = {
  name?: string;
  devCommand?: string;
  adapter?: AdapterKind;
  webUrl?: string;
  container?: string;
  notes?: string;
};

export type RunState = 'starting' | 'running' | 'stopped' | 'failed';

export type RunStatus = {
  projectId: string;
  state: RunState;
  pid?: number | null;
  exitCode?: number | null;
  message?: string | null;
};

export type LogEntry = {
  projectId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  at: number;
};

export type UrlEvent = {
  projectId: string;
  url: string;
};

export type DiscoverRoot = {
  path: string;
  exists: boolean;
  candidateCount: number;
};