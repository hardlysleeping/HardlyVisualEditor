# Using HardlyUI

This is the guide for people using the editor, not for installing it — for
setup see [quick-start.md](quick-start.md) and [LAUNCHER.md](LAUNCHER.md).

HardlyUI shows up in two places:

- **The toolbar inside your app** (the *guest*). It is injected into the app's
  webview, so it sits on top of the page you are editing.
- **The inspector window**. The larger surface: properties, structure, saved
  elements, pictures, checkpoints and publishing.

Both drive the same session: an element you pick in the app appears in the
inspector, and a screenshot you take in either place is the same capture.

Linux is the supported platform. Window capture and window resizing are the
parts that differ elsewhere; nothing in this guide was checked on macOS or
Windows.

## The toolbar

| Button | What it does |
|--------|--------------|
| **Hard reload** | Reloads the webview and clears its cache, so you see the app as a fresh visitor would. |
| **Screenshot** | Captures the webview as it looks now. The capture appears as a chip in the context panel. |
| **Element picker** | Turns picking on or off. While it is on, clicking an element in the page selects it instead of activating it. |
| **Context panel** | Opens or closes the panel described below. It also opens by itself when a selection or a capture arrives. |
| **Console** | Opens the platform devtools (Elements, Console, Network). In a release build this is usually blocked. |
| **Settings** | Inspector window only. See [Settings](#settings). |

The toolbar can be dragged by its grip and collapsed to a single row. Its
position and collapsed state are not saved between launches.

## Selecting elements

Turn the picker on and click an element. It is added to the selection, and a
chip with its tag and text appears in the composer. Clicking another element
adds another chip; clicking a selected element again does nothing new.

While the picker is on, the page does not receive clicks — that is why it must
be turned off to use the app normally. Typing in the composer turns it off for
you, so a click in the app behaves normally again.

Element chips can be removed with their **×**, or by putting the caret next to
one and pressing Backspace or Delete.

## The context panel

The panel is where a change is described and sent on.

**Composer.** Type what you want changed, in your own words. Element and
screenshot chips sit in the same box, in the order you place them, so the copied
text keeps the order you meant. The composer and the tool that reads it
(Cursor, or whichever AI editor you use) agree on that order.

**Copy** copies the composer plus the details of every chip — selectors, style,
size, source location when the app reports one. **Shift+click** copies the full
bundle instead, including the captured pictures. **Clear** empties the composer
and the session's captures.

**Screenshot editor.** Clicking a screenshot chip opens the editor: **Draw**,
**Add text**, **Crop**, **Undo**, **Redo**, **Save**. Undo and redo step through
the last 50 strokes and text boxes; **Cancel** throws the edit away. A saved edit
replaces the picture the chip points at, so a later copy includes it.

**Properties** (inspector window). Size, spacing, colour, typography, border and
corner radius, plus layout controls for containers: block/flex/grid, direction,
columns, alignment, gap, and free positioning with a nudge pad and optional
snapping. Every property edit says which screen sizes it applies to:

- **All screen sizes** — the plain value, used everywhere.
- **Phone only / Tablet only / Desktop only** — a size-specific value, written
  as a media query so the other sizes keep what they had.

**Structure** (inspector window) lists the page as a tree. You can select a
parent or child from the tree, move items up or down, group a multi-selection,
and see what the editor resolved each element to.

**Saved elements** (inspector window) stores a styled element or a small group
(up to 50 elements, 8 levels deep) under a name, and inserts it again in another
screen. Saved elements are kept in the project, not in the editor.

**Pictures** (inspector window) is the project's picture library: upload a
picture, insert it inside the selected element, copy its address, or remove it
from the library. Remove asks first, and pages already using a picture keep its
address — the file itself is what goes. Pictures inserted with the editor use an
address under `/__hardlyui/media/`.

**Publish and drafts.** Every change is a draft and is written as you make it.
Naming a draft and pressing **Publish** turns it into a protected restore point
and copies the pictures it uses into a folder your built site serves
(`static/__hardlyui/media` or `public/__hardlyui/media`), so the addresses keep
working in a build. **Go back to this** restores a published point later.
Published points cannot be deleted and are never removed by tidying up.

**Edit versions.** A checkpoint is a named point in the edit history, separate
from publishing — no files are copied, nothing is protected. **Save** takes one;
**Preview** shows the checkpoint's picture and a diff of what restoring would
change; **Restore** goes back to it, saving your current edits as a recovery checkpoint
first; **Delete** removes it. **Keep newest 20** deletes older checkpoints and
keeps every published one; the button appears once there are more than 20. A
project stores at most 100 checkpoints.

## Settings

The inspector window's toolbar has **Settings**, which changes how the editor
behaves:

| Control | Effect |
|---------|--------|
| **Overlay colour** | The highlight colour used for hover and selection, and the toolbar's accent. Applies immediately. |
| **Crop padding** | How much space is kept around a cropped element screenshot: 0, 8, 16, 24 or 48 px. Applies immediately. |
| **Screenshot folder** | Where screenshots are written: the app's data folder, the project folder, the temporary folder, or a folder you choose. Applies to the next screenshot you take. |
| **Folder path** | Only for *A folder I choose*. Save stays disabled until a path is typed, because the backend refuses the setting without one. |

Settings are stored in `visual-editor/settings.json` inside the app's data
folder and survive restarts. Two values in that file — `theme` and `shortcut` —
are kept for compatibility but are not editable here: nothing reads them back,
so changing them would do nothing.

## Undo and redo

One **Undo** reverses the last thing you did, whichever it was: a property edit
inside the app, or a write to a Svelte source file. **Redo** puts it back. The
button names what it is about to undo.

The order is per session — it starts empty on reload. Nothing is lost when it
resets: the app's own edit history underneath survives a reload, so undo still
reaches back further than the button's list suggests.

## When something goes wrong

Failures are written for people, not for logs. A failure shows a short title,
the next thing to try, and a collapsible **Details** block with the original
text. Copy Details when you need to ask for help — it is the part that names
what actually failed.

Some messages you may see, and what they mean:

| Message | Meaning |
|---------|---------|
| *This project is not set up for HardlyUI yet* | The project has no HardlyUI wiring. Run `hardlyui init` in it (or ask whoever set it up) and reopen the editor. |
| *That item is no longer in the selection* | The chip points at a capture or element that has gone (the page reloaded, someone else removed it). Close and reopen the inspector to refresh the list. |
| *The file changed while you were editing* | Something else wrote the file after the preview was taken. Undo your last change, then make it again. |
| *The editor is turned off for this project* | The plugin is disabled, or a release build is running without `allowInProduction`. Turn it on from the toolbar. |
| *That picture is too big for the library* | The file is over 4 MB. Shrink it, or use a smaller one. |
| *The preview picture could not be taken* | The change is saved; only the preview failed. Retry the checkpoint; if it keeps failing the app window has to be visible. |

## Where your files go

| What | Where |
|------|-------|
| Drafts, checkpoints, saved elements | `.hardlyui/` inside the project |
| The stylesheet the editor maintains | `hardlyui-overrides.css` inside the project |
| Pictures inserted with the editor | `/__hardlyui/media/` inside the project |
| Pictures copied by a publish | `static/__hardlyui/media`, or `public/__hardlyui/media`, or `.hardlyui/published-media` when the project serves neither |
| Screenshots | the folder chosen in [Settings](#settings) |
| Editor settings | `visual-editor/settings.json` in the app's data folder |
| Project list (launcher) | `~/.config/hardlyui/projects.json` |

Svelte projects are the exception: edits there are written into the source files
themselves, which is why undo on those goes through the same Undo button and why
a changed file can make an older preview stale.