/**
 * Hub snapshot types mirrored from Rust `HubSnapshot`.
 * Location: packages/inspector-app/src/types.ts
 */

export type Visibility = 'visible' | 'partially_visible' | 'outside_viewport';
export type ElementStatus = 'valid' | 'stale_after_reload' | 'not_found' | 'webview_closed';
export type WebviewStatus = 'active' | 'closed';

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ChildLayoutSnapshot = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  margin_left: number;
  margin_right: number;
  margin_top: number;
  margin_bottom: number;
  position: string;
};

export type ElementSnapshot = {
  webview_id: string;
  tag: string;
  text: string | null;
  editable_text?: string | null;
  /** Direct text runs owned by the element, whitespace-only ones dropped. */
  text_nodes?: string[] | null;
  attributes: Array<[string, string]>;
  dom_path: string;
  outer_html?: string;
  reusable_html?: string;
  parent_dom_path?: string | null;
  parent_child_index?: number | null;
  visibility: Visibility;
  css_bounds: Bounds;
  physical_bounds: Bounds;
  visible_bounds: Bounds | null;
  full_bounds: Bounds | null;
  computed_layout: Array<[string, string]>;
  css_variables?: Array<[string, string]>;
  layout_children?: ChildLayoutSnapshot[];
};

export type SelectedElement = {
  id: string;
  snapshot: ElementSnapshot;
  selector: string;
  component: string | null;
  file: string | null;
  inspector_id: string | null;
  entity: string | null;
  status: ElementStatus;
  linked_capture_id: string | null;
};

export type CaptureType = 'window' | 'webview' | 'element' | 'region';

export type Capture = {
  id: string;
  path: string;
  capture_type: CaptureType;
  webview_id: string | null;
  device_pixel_ratio: number;
  screenshot_size_physical: [number, number];
  viewport_size_css: [number, number];
  crop_bounds_css: Bounds | null;
  crop_padding_css: number | null;
  include_in_copy: boolean;
};

export type WebViewRegistration = {
  id: string;
  label: string;
  window_label: string;
  url: string;
  status: WebviewStatus;
};

export type InspectionTarget = {
  webview_id: string;
  pinned: boolean;
};

export type ThemeMode = 'system' | 'light' | 'dark';
export type ScreenshotDirMode = 'appData' | 'project' | 'temp' | 'absolutePath';

export type PersistentSettings = {
  theme: ThemeMode;
  shortcut: string;
  overlay_color: string;
  crop_padding: number;
  screenshot_dir: ScreenshotDirMode;
  screenshot_absolute_path: string | null;
};

export type PersistentSettingsPatch = Partial<{
  theme: ThemeMode;
  shortcut: string;
  overlay_color: string;
  crop_padding: number;
  screenshot_dir: ScreenshotDirMode;
  screenshot_absolute_path: string | null;
}>;

export type ElementIdentity = {
  webview_id: string;
  inspector_id: string | null;
  html_id: string | null;
  semantic_selector: string | null;
  generated_id: string | null;
};

export type SetStyleOperation = {
  operation: 'set_style';
  identity: ElementIdentity;
  property: string;
  before: string | null;
  after: string | null;
};

export type SetResponsiveStyleOperation = {
  operation: 'set_responsive_style';
  identity: ElementIdentity;
  property: string;
  breakpoint: 'phone' | 'tablet' | 'desktop';
  before: string | null;
  after: string | null;
};

export type SetTextOperation = {
  operation: 'set_text';
  identity: ElementIdentity;
  before: string;
  after: string;
  /** Which of the element's own text runs to change; defaults to the first. */
  text_index?: number;
};

export type SetAttributeOperation = {
  operation: 'set_attribute';
  identity: ElementIdentity;
  name: string;
  before: string | null;
  after: string | null;
};

export type SetTextBindingOperation = {
  operation: 'set_text_binding';
  identity: ElementIdentity;
  before: ElementIdentity | null;
  after: ElementIdentity | null;
  before_text: string;
};

export type InsertElementOperation = {
  operation: 'insert_element';
  identity: ElementIdentity;
  parent: ElementIdentity;
  tag: 'div' | 'p' | 'span' | 'button' | 'img';
  text: string;
  class_names: string[];
  slot_name?: string | null;
  image_url?: string | null;
};

export type RemoveElementOperation = {
  operation: 'remove_element';
  identity: ElementIdentity;
  parent: ElementIdentity;
  position: number;
  outer_html: string;
};

export type MoveElementOperation = {
  operation: 'move_element';
  identity: ElementIdentity;
  before_parent: ElementIdentity;
  before_position: number;
  after_parent: ElementIdentity;
  after_position: number;
};

export type EditOperation = SetStyleOperation | SetResponsiveStyleOperation | SetTextOperation | SetAttributeOperation | SetTextBindingOperation | InsertElementOperation | RemoveElementOperation | MoveElementOperation;

export type EditTransaction = {
  id: string;
  label: string | null;
  operations: EditOperation[];
};

export type EditHistory = {
  transactions: EditTransaction[];
  cursor: number;
};

export type HubSnapshot = {
  enabled: boolean;
  inspector_window_open: boolean;
  session: {
    selected_elements: SelectedElement[];
    captures: Capture[];
    primary_capture_id: string | null;
    issue_text: string | null;
  };
  webviews: WebViewRegistration[];
  active_target: InspectionTarget | null;
  settings: PersistentSettings;
  edit_history: EditHistory;
};

export type ActionState = 'idle' | 'loading' | 'success' | 'error';
