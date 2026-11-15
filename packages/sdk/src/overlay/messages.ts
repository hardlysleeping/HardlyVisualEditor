/**
 * Generated file — do not edit.
 *
 * Written from packages/messages/src/messages.ts by `npm run vendor:messages`.
 * This is the SDK overlay. The published overlay must not depend on the inspector app.
 * Change the source and run the vendor script so every copy stays identical.
 */

export type PlainError = {
  title: string;
  action: string;
  detail: string;
};

type Rule = { match: RegExp; title: string; action: string };

const RULES: Rule[] = [
  {
    match: /projectRoot|project root/i,
    title: 'This project is not set up for HardlyUI yet',
    action: 'Run "hardlyui init" in the project, or ask whoever set it up, then reopen the editor.',
  },
  {
    match: /version label|label must be/i,
    title: 'Give the checkpoint a short name',
    action: 'Use between 1 and 80 ordinary characters, with no line breaks.',
  },
  {
    match: /stores at most \d+ versions/i,
    title: 'You have reached the checkpoint limit',
    action: 'Delete an older checkpoint, or use "Keep newest 20", then save again.',
  },
  {
    match: /pictures must be at most \d+ MiB|larger than the media limit/i,
    title: 'That picture is too big for the library',
    action: 'Use a picture under 4 MB, or shrink it before uploading.',
  },
  {
    match: /media library holds at most \d+ pictures/i,
    title: 'The picture library is full',
    action: 'Remove a picture you no longer use, then upload this one again.',
  },
  {
    match: /only PNG, JPEG, WebP, GIF and SVG|media file name is not a supported picture/i,
    title: 'That file is not a picture the library can store',
    action: 'Use a PNG, JPEG, WebP, GIF or SVG file.',
  },
  {
    match: /SVG contains script or remote content/i,
    title: 'That picture can run code, so it was refused',
    action: 'Export the picture again without scripts or remote content, then upload it.',
  },
  {
    match: /that file is empty/i,
    title: 'That file is empty',
    action: 'Choose a picture file that actually contains a picture.',
  },
  {
    match: /that file could not be read/i,
    title: 'That picture could not be opened',
    action: 'Try a different file, or export the picture again.',
  },
  {
    match: /cannot delete picture/i,
    title: 'That picture could not be removed',
    action: 'Reopen the pictures panel to refresh the list, then try again.',
  },
  {
    match: /invalid version ID|version snapshot path is invalid|version thumbnail path is invalid|no such file|not found/i,
    title: 'That saved version is no longer there',
    action: 'Close the version panel and reopen it to refresh the list.',
  },
  {
    match: /exceeds \d+ (KiB|MiB)/i,
    title: 'That file is too large',
    action: 'Use a smaller picture, or reduce how much of the page you capture.',
  },
  {
    match: /must be PNG data/i,
    title: 'That is not a picture the editor can store',
    action: 'Use a PNG, JPEG or WebP image.',
  },
  {
    match: /Unknown (capture|element)/i,
    title: 'That item is no longer in the selection',
    action: 'Close and reopen the inspector to refresh the list.',
  },
  {
    match: /thumbnail|screenshot|capture/i,
    title: 'The preview picture could not be taken',
    action: 'Your change is still saved. Try saving the checkpoint again; if it keeps failing, the app window has to be visible.',
  },
  {
    match: /unsupported or unsafe style/i,
    title: 'That block uses a setting the editor cannot write into the source file',
    action: 'Keep it as a plain layout block, or change the setting here first, then save it again.',
  },
  {
    match: /image must use HTTPS|needs a supported source address|unsupported address/i,
    title: 'That picture cannot be linked from this project',
    action: 'Upload it with the media panel, or use an https:// address.',
  },
  {
    match: /Cannot reuse active content/i,
    title: 'This block contains active content',
    action: 'Remove the script, style or embedded frame from it, then save the block again.',
  },
  {
    match: /Reusable groups are limited to/i,
    title: 'This block is too big to save as one piece',
    action: 'Save a smaller part of it: up to 50 elements, 8 levels deep.',
  },
  {
    match: /exactly one root element/i,
    title: 'A reusable block has to be a single element',
    action: 'Wrap the pieces in one container, then save them again.',
  },
  {
    match: /simple variable or dotted|bindings must be simple/i,
    title: 'That block uses a value the editor cannot save into source',
    action: 'Replace the dynamic value with plain text, or bind it from the text panel.',
  },
  {
    match: /Repeated elements cannot|repeated elements/i,
    title: 'This item repeats, so it cannot be edited one at a time',
    action: 'Edit the template that generates the repeat instead.',
  },
  {
    match: /Source changed outside HardlyUI|changed after preview/i,
    title: 'The file changed while you were editing',
    action: 'Undo your last change, then make it again so it applies to the current file.',
  },
  {
    match: /Nothing to (undo|redo)/i,
    title: 'There is nothing to undo there',
    action: 'Keep undoing other changes, or save a checkpoint before your next edit.',
  },
  {
    match: /Forbidden origin/i,
    title: 'The editor cannot talk to this page',
    action: 'Open the project from the HardlyUI launcher so the editor and the app are paired.',
  },
  {
    match: /outside the project/i,
    title: 'That file is outside this project',
    action: 'Select the element again from the page itself.',
  },
  {
    match: /Webview window not found|window not found/i,
    title: 'The app window is not available',
    action: 'Bring the app window to the front, then try again.',
  },
  {
    match: /cannot be safely removed|cannot be removed/i,
    title: 'This element cannot be removed on its own',
    action: 'Select a child element, or hide it from the Structure panel.',
  },
  {
    match: /nothing selected|select an element/i,
    title: 'Nothing is selected',
    action: 'Click the element in the page first.',
  },
  {
    match: /invalid edited text|text operation must change/i,
    title: 'That text cannot be saved',
    action: 'Type something different, without control characters.',
  },
  {
    match: /Feature (gate|is) blocked|disabled/i,
    title: 'The editor is turned off for this project',
    action: 'Turn HardlyUI on from the toolbar. In a production build it also needs allow_in_production.',
  },
];

const UNKNOWN_ACTION = 'Try again. If it keeps happening, open Details and copy the text for whoever maintains the project.';

const PLAIN = Symbol('hardlyui.plain-message');

/**
 * A message the inspector wrote itself: already a complete sentence with the
 * next step in it, so rewriting it would bury the instruction in Details.
 */
export function userMessage(text: string): Error {
  const error = new Error(text);
  (error as Error & { [PLAIN]?: true })[PLAIN] = true;
  return error;
}

/** Structured, user-facing explanation for any thrown value. */
export function explainError(raw: unknown): PlainError {
  const detail = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : String(raw);
  const rule = RULES.find((candidate) => candidate.match.test(detail));
  if (rule) return { title: rule.title, action: rule.action, detail };
  if (typeof raw === 'object' && raw !== null && (raw as { [PLAIN]?: true })[PLAIN]) {
    return { title: detail, action: '', detail };
  }
  return { title: 'Something went wrong', action: UNKNOWN_ACTION, detail };
}

/** One-line form, for places that cannot host the disclosure widget. */
export function explainErrorLine(raw: unknown): string {
  const explained = explainError(raw);
  return explained.action ? `${explained.title} — ${explained.action}` : explained.title;
}