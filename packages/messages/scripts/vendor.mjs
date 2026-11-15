#!/usr/bin/env node
/**
 * Copies the explain-rules module into each package that ships on its own.
 *
 * The guest runtime is injected into host pages, the SDK overlay is published
 * to npm and the inspector app is bundled into the plugin, so none of them can
 * import a shared runtime dependency. They all need the same wording, so the
 * single source lives in packages/messages/src/messages.ts and this script
 * writes the copies.
 *
 *   node packages/messages/scripts/vendor.mjs          # write the copies
 *   node packages/messages/scripts/vendor.mjs --check  # fail if they differ
 */

import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'packages/messages/src/messages.ts';

const TARGETS = [
  {
    path: 'packages/guest/src/messages.ts',
    owner: 'guest runtime',
    note: 'The injected toolbar ships into any host page on its own.',
  },
  {
    path: 'packages/inspector-app/src/lib/messages.ts',
    owner: 'inspector app',
    note: 'The editor window is bundled on its own.',
  },
  {
    path: 'packages/sdk/src/overlay/messages.ts',
    owner: 'SDK overlay',
    note: 'The published overlay must not depend on the inspector app.',
  },
];

/** The source body without its own leading comment block. */
function body(source) {
  const end = source.indexOf('*/');
  if (!source.startsWith('/**') || end === -1) {
    throw new Error(`${SOURCE} must start with a doc comment`);
  }
  return source.slice(end + 2).replace(/^\s*\n/, '');
}

function render(target, sourceBody) {
  return `/**
 * Generated file — do not edit.
 *
 * Written from ${SOURCE} by \`npm run vendor:messages\`.
 * This is the ${target.owner}. ${target.note}
 * Change the source and run the vendor script so every copy stays identical.
 */

${sourceBody}`;
}

const check = process.argv.includes('--check');
const sourceBody = body(await readFile(SOURCE, 'utf8'));

const stale = [];
for (const target of TARGETS) {
  const wanted = render(target, sourceBody);
  let current = null;
  try {
    current = await readFile(target.path, 'utf8');
  } catch {
    current = null;
  }
  if (current === wanted) continue;
  if (check) {
    stale.push(target.path);
    continue;
  }
  await writeFile(target.path, wanted);
  console.log(`wrote ${target.path}`);
}

if (stale.length > 0) {
  console.error(`messages.ts copies are out of date:\n  ${stale.join('\n  ')}`);
  console.error('Run: npm run vendor:messages');
  process.exit(1);
}

if (check) console.log(`messages.ts is identical in ${TARGETS.length} packages`);
