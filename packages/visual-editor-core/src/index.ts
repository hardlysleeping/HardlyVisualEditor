export type AdapterKind = 'static-html' | 'svelte';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export type ElementRef = {
  id: string;
  adapter: AdapterKind;
  selector?: string;
  source?: { file: string; start: number; end: number };
  meta?: Record<string, unknown>;
};

export type SourcePatch = {
  file: string;
  start: number;
  end: number;
  before: string;
  after: string;
};

export type EditorCapabilities = {
  move: boolean;
  resize: boolean;
  text: boolean;
  style: {
    spacing: boolean;
    dimensions: boolean;
    typography: boolean;
    colors: boolean;
    borders: boolean;
    flex: boolean;
    grid: boolean;
  };
  structure: { duplicate: boolean; remove: boolean; reorder: boolean };
};

export type EditorWarning = { code: string; message: string; elementId?: string };
export type ValidationResult = { valid: boolean; errors: string[]; warnings: EditorWarning[] };

export type EditIntent =
  | { type: 'move'; target: ElementRef; delta: Point }
  | { type: 'resize'; target: ElementRef; size: Size }
  | { type: 'set-style'; target: ElementRef; styles: Record<string, string | null> }
  | { type: 'set-text'; target: ElementRef; value: string }
  | { type: 'duplicate' | 'remove'; target: ElementRef }
  | { type: 'reorder'; target: ElementRef; parent: ElementRef; index: number };

export type EditResult = {
  id: string;
  adapter: AdapterKind;
  intent: EditIntent;
  changes: SourcePatch[];
  warnings: EditorWarning[];
  validation: ValidationResult;
  requiresReload: boolean;
  timestamp: number;
};

export type CommitResult = { committed: boolean; files: string[]; revision?: string };

export type EditorTarget = { projectRoot: string; previewUrl: string; adapter?: AdapterKind };
export type EditorSession = { id: string; target: EditorTarget; capabilities: EditorCapabilities };
export type ElementInspection = {
  element: ElementRef;
  tag?: string;
  text?: string;
  bounds: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
  editableStyles: string[];
  capabilities: Partial<EditorCapabilities>;
};

export interface VisualEditorAdapter {
  readonly kind: AdapterKind;
  open(target: EditorTarget): Promise<EditorSession>;
  close(): Promise<void>;
  hitTest(point: Point): Promise<ElementRef | null>;
  select(element: ElementRef): Promise<void>;
  inspect(element: ElementRef): Promise<ElementInspection>;
  locateSource(element: ElementRef): Promise<ElementRef['source'] | null>;
  getCapabilities(): Promise<EditorCapabilities>;
  getElementCapabilities(element: ElementRef): Promise<Partial<EditorCapabilities>>;
  preview(intent: EditIntent): Promise<EditResult>;
  apply(intent: EditIntent): Promise<EditResult>;
  validate(result?: EditResult): Promise<ValidationResult>;
  commit(result: EditResult): Promise<CommitResult>;
  revert(editId: string): Promise<void>;
}

export type EditTransaction = {
  id: string;
  adapter: AdapterKind;
  edits: EditResult[];
  createdAt: number;
  label?: string;
};
