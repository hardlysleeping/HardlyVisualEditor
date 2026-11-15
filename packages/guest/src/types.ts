/**
 * Shared guest types aligned with `crates/core` ElementSnapshot.
 * Location: packages/guest/src/types.ts
 */

export type Visibility = 'visible' | 'partially_visible' | 'outside_viewport';

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

/** Raw DOM facts sent to the Rust hub before selector building. */
export type ElementSnapshot = {
  webview_id: string;
  tag: string;
  text: string | null;
  editable_text?: string | null;
  /** Direct text runs owned by this element, whitespace-only ones dropped. */
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

export type RevalidateStatus = 'valid' | 'not_found';

export type RevalidateResult =
  | { status: 'valid'; snapshot: ElementSnapshot }
  | { status: 'not_found' };
