/**
 * Tauri invoke wrappers for the visual-editor plugin.
 * Location: packages/inspector-app/src/api.ts
 */

import { invoke } from '@tauri-apps/api/core';
import type { HubSnapshot, PersistentSettingsPatch, EditOperation, EditTransaction } from './types.js';
import { back, forward, peekRedo, peekUndo, record, reset as resetActionLog } from './lib/actionLog.js';

export type ComposerBlockExport =
  | { type: 'text'; content: string }
  | { type: 'element'; id: string }
  | { type: 'capture'; id: string };

const PLUGIN = 'plugin:visual-editor';

export async function getState(): Promise<HubSnapshot> {
  return invoke<HubSnapshot>(`${PLUGIN}|get_state`);
}

export async function enable(): Promise<void> {
  await invoke(`${PLUGIN}|enable`);
}

export async function disable(): Promise<void> {
  await invoke(`${PLUGIN}|disable`);
}

export async function setTargetWebview(webviewId: string): Promise<void> {
  await invoke(`${PLUGIN}|set_target_webview`, { webviewId });
}

export async function setPreviewViewport(webviewId: string, width: number | null, height: number | null = null): Promise<void> {
  await invoke(`${PLUGIN}|set_preview_viewport`, { webviewId, width, height });
}

export async function pinTargetWebview(webviewId: string): Promise<void> {
  await invoke(`${PLUGIN}|pin_target_webview`, { webviewId });
}

export async function unpinTargetWebview(): Promise<void> {
  await invoke(`${PLUGIN}|unpin_target_webview`);
}

export async function clearSession(): Promise<void> {
  await invoke(`${PLUGIN}|clear_session`);
}

export async function revalidate(): Promise<number> {
  return invoke<number>(`${PLUGIN}|revalidate`);
}

export async function hardReload(webviewId?: string, clearCache = true): Promise<void> {
  await invoke(`${PLUGIN}|hard_reload`, {
    webviewId: webviewId ?? null,
    clearCache,
  });
}

export async function toggleDevtools(webviewId?: string): Promise<boolean> {
  return invoke<boolean>(`${PLUGIN}|toggle_devtools`, {
    webviewId: webviewId ?? null,
  });
}

export async function copyContextBundle(
  full = false,
  blocks?: ComposerBlockExport[],
): Promise<void> {
  await invoke(`${PLUGIN}|copy_context_bundle`, {
    full,
    blocks: full ? null : blocks ?? null,
  });
}

export async function copyScreenshotImage(captureId?: string): Promise<void> {
  await invoke(`${PLUGIN}|copy_screenshot_image`, { captureId: captureId ?? null });
}

export async function copyScreenshotPath(captureId?: string): Promise<void> {
  await invoke(`${PLUGIN}|copy_screenshot_path`, { captureId: captureId ?? null });
}

export async function setIssueText(text: string): Promise<void> {
  await invoke(`${PLUGIN}|set_issue_text`, { text });
}

export async function removeElement(elementId: string): Promise<void> {
  await invoke(`${PLUGIN}|remove_element`, { elementId });
}

export async function selectElement(webviewId: string, selector: string): Promise<void> {
  await invoke(`${PLUGIN}|select_element`, { webviewId, selector });
}

export async function removeCapture(captureId: string): Promise<void> {
  await invoke(`${PLUGIN}|remove_capture`, { captureId });
}

export async function setPrimaryCapture(captureId: string): Promise<void> {
  await invoke(`${PLUGIN}|set_primary_capture`, { captureId });
}

export async function setCaptureIncluded(captureId: string, include: boolean): Promise<void> {
  await invoke(`${PLUGIN}|set_capture_included`, { captureId, include });
}

export async function updateSettings(patch: PersistentSettingsPatch): Promise<void> {
  await invoke(`${PLUGIN}|update_settings`, { patch });
}

export async function previewStyle(operation: EditOperation): Promise<void> {
  await invoke(`${PLUGIN}|preview_style`, { operation });
}

export async function commitEdit(transaction: EditTransaction): Promise<void> {
  await invoke(`${PLUGIN}|commit_edit`, { transaction });
  // Single choke point for manifest edits, so the unified undo order cannot
  // miss one. Only recorded once the plugin accepted the transaction.
  record('manifest', transaction.label ?? 'Edit');
}

export async function undoEdit(): Promise<boolean> {
  const undone = await invoke<boolean>(`${PLUGIN}|undo_edit`);
  // Keep the unified log in step whichever button (or lane) triggered this.
  if (undone && peekUndo()?.lane === 'manifest') back();
  return undone;
}

export async function redoEdit(): Promise<boolean> {
  const redone = await invoke<boolean>(`${PLUGIN}|redo_edit`);
  if (redone && peekRedo()?.lane === 'manifest') forward();
  return redone;
}

export type MediaItem = {
  name: string;
  url: string;
  bytes: number;
  kind: string;
};

export async function saveMedia(name: string, dataBase64: string): Promise<MediaItem> {
  return invoke<MediaItem>(`${PLUGIN}|save_media`, { name, dataBase64 });
}

export async function listMedia(): Promise<MediaItem[]> {
  return invoke<MediaItem[]>(`${PLUGIN}|list_media`);
}

export async function readMedia(name: string): Promise<string> {
  return invoke<string>(`${PLUGIN}|read_media`, { name });
}

export async function deleteMedia(name: string): Promise<void> {
  await invoke(`${PLUGIN}|delete_media`, { name });
}

export async function resetEdits(): Promise<void> {
  await invoke(`${PLUGIN}|reset_edits`);
  resetActionLog();
}

export type SavedComponent = {
  id: string;
  name: string;
  tag: 'div' | 'p' | 'span' | 'button' | 'img';
  text: string;
  class_names: string[];
  styles: Array<[string, string]>;
  slot_name?: string | null;
  image_url?: string | null;
  svelte_bindings?: Record<string, string>;
  children: SavedComponentNode[];
};

export type SavedComponentNode = Omit<SavedComponent, 'id' | 'name'>;

export async function getComponentLibrary(): Promise<SavedComponent[]> {
  return invoke<SavedComponent[]>(`${PLUGIN}|get_component_library`);
}

export async function saveComponentLibrary(components: SavedComponent[]): Promise<void> {
  await invoke(`${PLUGIN}|save_component_library`, { components });
}

export type EditVersion = {
  id: string;
  label: string;
  created_at: number;
  transaction_count: number;
  cursor: number;
  recent_transactions: string[];
  has_preview?: boolean;
  /** A restore point the user published; delete and prune leave it alone. */
  published?: boolean;
};

export type PublishedEntry = {
  id: string;
  label: string;
  published_at: number;
  media: string[];
  media_folder: string;
  media_url_works: boolean;
};

export type PublishResult = {
  version: EditVersion;
  published_at: number;
  media: string[];
  media_folder: string;
  media_url_works: boolean;
};

/** Turns the current draft into a named restore point and copies its pictures. */
export async function publishProject(label: string): Promise<PublishResult> {
  return invoke<PublishResult>(`${PLUGIN}|publish_project`, { label });
}

export async function listPublished(): Promise<PublishedEntry[]> {
  return invoke<PublishedEntry[]>(`${PLUGIN}|list_published`);
}

export async function listVersions(): Promise<EditVersion[]> {
  return invoke<EditVersion[]>(`${PLUGIN}|list_versions`);
}

export async function saveVersion(label: string): Promise<EditVersion> {
  return invoke<EditVersion>(`${PLUGIN}|save_version`, { label });
}

export async function restoreVersion(versionId: string): Promise<void> {
  await invoke(`${PLUGIN}|restore_version`, { versionId });
}

export type VersionComparison = {
  version_css: string;
  current_css: string;
};

export async function deleteVersion(versionId: string): Promise<void> {
  await invoke(`${PLUGIN}|delete_version`, { versionId });
}

export async function pruneVersions(keep: number): Promise<string[]> {
  return invoke<string[]>(`${PLUGIN}|prune_versions`, { keep });
}

export async function compareVersion(versionId: string): Promise<VersionComparison> {
  return invoke<VersionComparison>(`${PLUGIN}|compare_version`, { versionId });
}

export async function readVersionPreview(versionId: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>(`${PLUGIN}|read_version_preview`, { versionId });
  return Uint8Array.from(bytes);
}

export async function loadVersionPreviewUrl(versionId: string): Promise<string> {
  const bytes = await readVersionPreview(versionId);
  return URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
}

export async function saveCaptureImage(captureId: string, pngBytes: number[]): Promise<void> {
  await invoke(`${PLUGIN}|save_capture_image`, { captureId, pngBytes });
}

export async function readCaptureImage(captureId: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>(`${PLUGIN}|read_capture_image`, { captureId });
  return Uint8Array.from(bytes);
}

export async function loadCaptureBlobUrl(captureId: string): Promise<string> {
  const bytes = await readCaptureImage(captureId);
  return URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
}

export async function capture(options?: { mode?: string }): Promise<string> {
  return invoke<string>(`${PLUGIN}|capture`, { options: options ?? null });
}

export async function exportContext(): Promise<string> {
  return invoke<string>(`${PLUGIN}|export_context`);
}

export const STATE_EVENT = 'visual-editor://state-updated';
