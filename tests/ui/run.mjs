#!/usr/bin/env node
/**
 * UI checks for the inspector window and the guest toolbar.
 *
 *   npm run test:ui              # run every spec
 *   npm run test:ui -- inspector # run one spec
 *
 * Needs a Chromium binary: set PW_EXEC, or install one with
 * `npx playwright install chromium`. The app is served from
 * packages/inspector-app/dist, so run `npm run build:inspector` first (the npm
 * script does it automatically).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createStaticServer } from './lib/server.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SPECS = ['inspector', 'guest'];

function chromiumPath() {
  if (process.env.PW_EXEC) return process.env.PW_EXEC;
  const cache = join(homedir(), '.cache/ms-playwright');
  const candidates = existsSync(cache)
    ? [join(cache, 'chromium-1248/chrome-linux64/chrome'), join(cache, 'chromium/chrome-linux64/chrome')]
    : [];
  return candidates.find((path) => existsSync(path)) ?? undefined;
}

async function main() {
  const filter = process.argv[2];
  const specs = filter ? SPECS.filter((name) => name === filter) : SPECS;
  if (specs.length === 0) {
    console.error(`unknown spec: ${filter} (choose ${SPECS.join(', ')})`);
    process.exit(2);
  }

  const { server, origin } = await createStaticServer(ROOT);
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox'],
  });

  let failures = 0;
  try {
    for (const name of specs) {
      const module = await import(pathToFileURL(join(ROOT, `tests/ui/specs/${name}.mjs`)).href);
      const context = await browser.newContext();
      const checks = [];
      const check = (title, ok, detail = '') => checks.push({ title, ok, detail });
      try {
        await module.run({ context, origin, check, root: ROOT });
      } catch (reason) {
        checks.push({ title: `${name}: spec crashed`, ok: false, detail: String(reason) });
      }
      await context.close();

      console.log(`\n${name}`);
      for (const item of checks) {
        console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.title}${item.ok || !item.detail ? '' : ` — ${item.detail}`}`);
        if (!item.ok) failures += 1;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nall UI checks passed' : `\n${failures} UI check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
