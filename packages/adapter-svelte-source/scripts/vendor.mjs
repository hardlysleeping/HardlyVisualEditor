#!/usr/bin/env node
// Copies the adapter into a host app so the host stays self-contained: a host
// repo should not point a dependency at somebody's checkout. One canonical
// implementation lives here; `npm run vendor --workspace=@hardlyui/adapter-svelte-source -- <dest>`
// refreshes a host's copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const destination = process.argv[2];
if (!destination) {
  console.error("usage: vendor.mjs <destination.ts>");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "src", "index.ts");

// The header is committed inside the host repo, so it names no absolute path.
const header = `// Generated from hardlyui/packages/adapter-svelte-source/src/index.ts — do not edit.
// Refresh with: npm run vendor --workspace=@hardlyui/adapter-svelte-source -- <destination>
//
// Dev-only Svelte source adapter for HardlyUI. Add it to the Vite dev config
// behind an opt-in flag, e.g.
//
//   plugins: [
//     ...(process.env.VITE_HARDLYUI_SOURCE === "1" ? [hardlyUiSourceLocator()] : []),
//     svelte(),
//   ]
`;

const body = fs.readFileSync(source, "utf8");
fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
fs.writeFileSync(path.resolve(destination), `${header}\n${body}`, "utf8");
console.log(`vendored ${path.basename(destination)}`);