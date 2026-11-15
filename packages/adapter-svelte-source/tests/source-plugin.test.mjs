import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createServer } from "vite";
import { parse } from "svelte/compiler";

import { hardlyUiSourceLocator } from "../dist/index.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hardlyui-source-"));
const filename = path.join(root, "Fixture.svelte");
const original = '<button style="color: red; --brand: #abc">Play</button>\n';
fs.writeFileSync(filename, original);

const server = await createServer({
  root,
  configFile: false,
  plugins: [hardlyUiSourceLocator()],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "silent",
});
await server.listen();
const address = server.httpServer.address();

after(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function offset() {
  const ast = parse(fs.readFileSync(filename, "utf8"), { modern: true });
  return ast.fragment.nodes.find((node) => node.type === "RegularElement").start;
}

async function post(body, origin = "tauri://localhost") {
  const response = await fetch(`http://127.0.0.1:${address.port}/__hardlyui/source-text`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

test("transform stamps coordinates relative to the Vite root", () => {
  const plugin = hardlyUiSourceLocator();
  plugin.configResolved({ root });
  const result = plugin.transform.call({}, original, filename);
  assert.ok(result, "expected a transformed module");
  assert.match(result.code, /data-hardlyui-source="Fixture\.svelte:0"/);
  assert.match(result.code, /color: red/);
});

test("transform leaves repeated elements and files outside the root alone", () => {
  const plugin = hardlyUiSourceLocator();
  plugin.configResolved({ root });
  const eachPath = path.join(root, "Each.svelte");
  fs.writeFileSync(eachPath, "<ul>{#each items as item}<li>{item}</li>{/each}</ul>");
  const marked = plugin.transform.call({}, fs.readFileSync(eachPath, "utf8"), eachPath);
  assert.ok(marked, "expected the outer list to be marked");
  assert.doesNotMatch(marked.code, /<li data-hardlyui-source/);
  fs.rmSync(eachPath);
  assert.equal(plugin.transform.call({}, original, path.join(os.tmpdir(), "Outside.svelte")), null);
});

test("style preview does not write, and the write keeps the other declarations", async () => {
  const preview = await post({ action: "preview", kind: "style", file: "Fixture.svelte", offset: offset(), property: "width", value: "320px" });
  assert.equal(preview.ok, true, JSON.stringify(preview.body));
  assert.match(preview.body.beforeCode, /color: red/);
  assert.match(preview.body.afterCode, /width: 320px/);
  assert.equal(fs.readFileSync(filename, "utf8"), original, "preview must not write source");

  const style = await post({
    action: "style", file: "Fixture.svelte", offset: offset(), property: "width", value: "320px", revision: preview.body.revision,
  });
  assert.equal(style.ok, true, JSON.stringify(style.body));
  const withStyle = fs.readFileSync(filename, "utf8");
  assert.match(withStyle, /width: 320px/);
  assert.match(withStyle, /color: red/);
  assert.match(withStyle, /--brand: #abc/);

  const stale = await post({
    action: "style", file: "Fixture.svelte", offset: offset(), property: "height", value: "88px", revision: preview.body.revision,
  });
  assert.equal(stale.ok, false);
  assert.match(stale.body.error, /changed after preview/);
});

test("style writes reject unsafe values and dynamic style directives", async () => {
  const before = fs.readFileSync(filename, "utf8");
  const unsafe = await post({
    action: "style", file: "Fixture.svelte", offset: offset(), property: "background", expectedStyle: "", value: "url(https://example.test)",
  });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.body.error, /unsafe/);

  fs.writeFileSync(filename, '<script>let dynamicWidth = "20px";</script><button style:width={dynamicWidth}>Play</button>');
  const dynamic = await post({ action: "style", file: "Fixture.svelte", offset: offset(), property: "width", value: "320px" });
  assert.equal(dynamic.ok, false);
  assert.match(dynamic.body.error, /dynamic style/);
  fs.writeFileSync(filename, before);
});

test("text writes and persistent undo", async () => {
  const withStyle = fs.readFileSync(filename, "utf8");
  const textPreview = await post({ action: "preview", kind: "text", file: "Fixture.svelte", offset: offset(), expected: "Play", value: "Listen" });
  assert.equal(textPreview.ok, true, JSON.stringify(textPreview.body));
  assert.match(textPreview.body.afterCode, />Listen</);
  const text = await post({
    action: "text", file: "Fixture.svelte", offset: offset(), expected: "Play", value: "Listen", revision: textPreview.body.revision,
  });
  assert.equal(text.ok, true, JSON.stringify(text.body));
  assert.match(fs.readFileSync(filename, "utf8"), />Listen</);

  const undoText = await post({ action: "undo" });
  assert.equal(undoText.ok, true, JSON.stringify(undoText.body));
  assert.equal(fs.readFileSync(filename, "utf8"), withStyle);
});

test("foreign origins and paths outside the root are refused", async () => {
  const forbidden = await post({ action: "undo" }, "https://example.test");
  assert.equal(forbidden.status, 403);

  const escape = await post({ action: "preview", kind: "text", file: "../Outside.svelte", offset: 0, expected: "Play", value: "Listen" });
  assert.equal(escape.ok, false);
  assert.match(escape.body.error, /outside the project|ENOENT/);
});
test("serves stored pictures and refuses anything that is not one", async () => {
  const mediaDir = path.join(root, ".hardlyui", "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(mediaDir, "hero-1234abcd.png"), png);
  fs.writeFileSync(path.join(root, "secret.txt"), "not served");

  const served = await fetch(`http://127.0.0.1:${address.port}/__hardlyui/media/hero-1234abcd.png`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);

  const missing = await fetch(`http://127.0.0.1:${address.port}/__hardlyui/media/nope.png`);
  assert.equal(missing.status, 404);

  const walk = await fetch(`http://127.0.0.1:${address.port}/__hardlyui/media/..%2F..%2Fsecret.txt`);
  assert.equal(walk.status, 404);

  const wrongType = await fetch(`http://127.0.0.1:${address.port}/__hardlyui/media/secret.txt`);
  assert.equal(wrongType.status, 404);
});
