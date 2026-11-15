import fs from "node:fs";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { compile, parse } from "svelte/compiler";

export type HardlyUiSourceOptions = {
  /**
   * WebView origins allowed to call the source endpoint. `tauri://localhost` is
   * what Tauri 2 serves a packaged webview from; `http://tauri.localhost` is the
   * Windows form. Add your own when a host runs the editor elsewhere.
   */
  origins?: string[];
  /** Middleware path. Matches the inspector's built-in fetch path by default. */
  endpoint?: string;
  /** Source history file, relative to the Vite project root. */
  historyFile?: string;
  /** Media library folder served to the app while editing. */
  mediaUrlPrefix?: string;
};

const DEFAULT_ORIGINS = ["tauri://localhost", "http://tauri.localhost"];

/**
 * Dev-only Svelte source adapter for HardlyUI.
 *
 * Two halves that belong together:
 *
 * 1. `transform` stamps every ordinary element outside an `{#each}` with
 *    `data-hardlyui-source="relative/path.svelte:offset"`, so the inspector can
 *    map a clicked DOM node back to the exact source coordinate.
 * 2. A POST endpoint writes a reviewed edit back to the `.svelte` file: static
 *    text, one inline style declaration, or validated static component markup.
 *    It pins a SHA-256 revision between preview and write, recompiles to catch
 *    broken output, keeps an undo/redo history in `.hardlyui/source-history.json`,
 *    and reloads the module so the dev server shows the change.
 *
 * Nothing here runs in a production build: the plugin is only added to the dev
 * server, and every write goes through the same guard rails as the inspector.
 */
export function hardlyUiSourceLocator(options: HardlyUiSourceOptions = {}): Plugin {
  let projectRoot = process.cwd();
  const origins = options.origins ?? DEFAULT_ORIGINS;
  const endpoint = options.endpoint ?? "/__hardlyui/source-text";
  const historyFile = options.historyFile ?? path.join(".hardlyui", "source-history.json");
  const mediaUrlPrefix = options.mediaUrlPrefix ?? "/__hardlyui/media/";

  return {
    name: "hardlyui-svelte-source-locator",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
    },
    configureServer(server) {
      server.middlewares.use(endpoint, (request, response, next) => {
        const origin = request.headers.origin;
        if (!origin || !origins.includes(origin)) {
          response.statusCode = 403;
          response.end("Forbidden origin");
          return;
        }
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "origin");
        response.setHeader("access-control-allow-methods", "POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.method !== "POST") return next();
        void editSource(request, response, server, projectRoot, historyFile);
      });
      // Pictures the inspector uploaded. Read-only and path-checked: only a
      // plain name with a known picture extension inside .hardlyui/media is
      // reachable, so no request can walk out of the folder.
      server.middlewares.use(mediaUrlPrefix, (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const name = decodeURIComponent((request.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
        const type = mediaContentType(name);
        if (!type) {
          response.statusCode = 404;
          response.end("Unknown picture");
          return;
        }
        const file = path.join(projectRoot, ".hardlyui", "media", name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(file);
        } catch {
          response.statusCode = 404;
          response.end("Picture not found");
          return;
        }
        if (!stat.isFile()) {
          response.statusCode = 404;
          response.end("Picture not found");
          return;
        }
        response.setHeader("content-type", type);
        response.setHeader("content-length", stat.size);
        response.setHeader("cache-control", "no-cache");
        if (request.method === "HEAD") {
          response.statusCode = 200;
          response.end();
          return;
        }
        fs.createReadStream(file).pipe(response);
      });
    },
    transform(source, id) {
      if (!id.endsWith(".svelte") || id.includes("?")) return null;
      const filename = id.split("?", 1)[0] || id;
      if (!fs.existsSync(filename)) return null;
      const relative = path.relative(projectRoot, filename).split(path.sep).join("/");
      // A file outside the dev-server root has no address the endpoint can
      // resolve back to, so it is left unmarked instead of producing a
      // coordinate that would fail on the first edit.
      if (!relative || relative.startsWith("../")) return null;

      const ast = parse(source, { modern: true });
      const inserts: Array<{ at: number; value: string }> = [];
      const visit = (value: unknown, insideEach = false): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach((child) => visit(child, insideEach));
          return;
        }
        const node = value as Record<string, unknown>;
        const inEach = insideEach || node.type === "EachBlock";
        if (!inEach && node.type === "RegularElement" && typeof node.name === "string" && typeof node.start === "number") {
          const attributes = Array.isArray(node.attributes) ? node.attributes : [];
          const alreadyMarked = attributes.some(
            (attribute) =>
              Boolean(attribute) &&
              typeof attribute === "object" &&
              (attribute as Record<string, unknown>).name === "data-hardlyui-source",
          );
          if (!alreadyMarked) {
            const coordinate = `${relative}:${node.start}`;
            inserts.push({ at: node.start + 1 + node.name.length, value: ` data-hardlyui-source=${JSON.stringify(coordinate)}` });
          }
        }
        for (const [key, child] of Object.entries(node)) {
          if (key !== "parent") visit(child, inEach);
        }
      };
      visit(ast.fragment);
      if (!inserts.length) return null;
      let output = source;
      for (const insertion of inserts.sort((a, b) => b.at - a.at)) {
        output = `${output.slice(0, insertion.at)}${insertion.value}${output.slice(insertion.at)}`;
      }
      return { code: output, map: null };
    },
  };
}

type SourceHistory = { entries: Array<{ file: string; before: string; after: string }>; cursor: number };

const STYLE_PROPERTIES = new Set([
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "display", "flex-direction", "align-items", "justify-content", "gap",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "color", "background", "background-color", "font-size", "font-weight",
  "line-height", "letter-spacing", "border", "border-color", "border-width",
  "border-radius", "opacity",
]);

async function editSource(
  request: IncomingMessage,
  response: ServerResponse,
  server: ViteDevServer,
  projectRoot: string,
  historyFile: string,
) {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16_384) throw new Error("Edit request is too large");
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      action?: unknown; kind?: unknown; file?: unknown; offset?: unknown; expected?: unknown; value?: unknown;
      property?: unknown; expectedStyle?: unknown; revision?: unknown; markup?: unknown;
    };
    const historyPath = path.join(projectRoot, historyFile);
    const history = readSourceHistory(historyPath);
    if (body.action === "undo" || body.action === "redo") {
      const nextCursor = history.cursor + (body.action === "undo" ? -1 : 1);
      if (nextCursor < 0 || nextCursor > history.entries.length) throw new Error(`Nothing to ${body.action}`);
      const entry = history.entries[body.action === "undo" ? history.cursor - 1 : history.cursor];
      const filename = resolveSourceFile(projectRoot, entry.file);
      const expected = body.action === "undo" ? entry.after : entry.before;
      const replacement = body.action === "undo" ? entry.before : entry.after;
      if (fs.readFileSync(filename, "utf8") !== expected) throw new Error("Source changed outside HardlyUI; refusing history operation");
      writeSource(filename, replacement);
      history.cursor = nextCursor;
      writeSourceHistory(historyPath, history);
      await reloadSourceModule(server, filename);
      return sendJson(response, { cursor: history.cursor, canUndo: history.cursor > 0, canRedo: history.cursor < history.entries.length });
    }
    if (typeof body.file !== "string" || !body.file.endsWith(".svelte") || !Number.isSafeInteger(body.offset)) {
      throw new Error("Expected a Svelte source file and selected element coordinate");
    }
    const filename = resolveSourceFile(projectRoot, body.file);
    const source = fs.readFileSync(filename, "utf8");
    const revision = sourceRevision(source);
    if (typeof body.revision === "string" && body.revision !== revision) throw new Error("Source changed after preview; review the updated diff");
    const ast = parse(source, { modern: true });
    const target = findElement(ast.fragment, body.offset as number);
    if (!target || target.type !== "RegularElement") throw new Error("Source target no longer exists");
    if (target.insideEach) throw new Error("Repeated elements cannot be source-edited individually");
    let updated: string;
    let previous: string;
    let next: string;
    const styleEdit = body.action === "style" || (body.action === "preview" && body.kind === "style");
    const insertEdit = body.action === "insert" || (body.action === "preview" && body.kind === "insert");
    if (styleEdit) {
      if (typeof body.property !== "string" || !STYLE_PROPERTIES.has(body.property) ||
          typeof body.value !== "string" || body.value.length > 160 || /[;{}<>]|url\s*\(|expression\s*\(/i.test(body.value)) {
        throw new Error("Unsupported or unsafe style property/value");
      }
      if (target.attributes.some((attribute: any) => attribute.type === "StyleDirective")) {
        throw new Error("Elements with dynamic style directives cannot be source-edited");
      }
      const styleAttribute = target.attributes.find((attribute: any) => attribute.type === "Attribute" && attribute.name === "style") as any;
      if (styleAttribute && (!Array.isArray(styleAttribute.value) || styleAttribute.value.length !== 1 || styleAttribute.value[0].type !== "Text")) {
        throw new Error("Dynamic style attributes cannot be source-edited");
      }
      const styleText = styleAttribute?.value?.[0];
      const declarations = parseDeclarations(styleText?.data ?? "");
      previous = declarations.get(body.property) ?? "";
      if (typeof body.expectedStyle === "string" && body.expectedStyle !== previous) throw new Error("Style changed since selection");
      next = body.value.trim();
      if (next) declarations.set(body.property, next); else declarations.delete(body.property);
      const serialized = [...declarations].map(([name, value]) => `${name}: ${value}`).join("; ");
      if (styleText) updated = `${source.slice(0, styleText.start)}${escapeAttribute(serialized)}${source.slice(styleText.end)}`;
      else {
        const insertionAt = target.start + 1 + target.name.length;
        updated = `${source.slice(0, insertionAt)} style="${escapeAttribute(serialized)}"${source.slice(insertionAt)}`;
      }
    } else if (insertEdit) {
      if (typeof body.markup !== "string" || body.markup.length > 12_000) throw new Error("Expected a component markup snippet under 12 KB");
      if (target.insideEach) throw new Error("Components cannot be source-inserted into repeated elements");
      if (["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(target.name)) {
        throw new Error("A component cannot be inserted inside this void element");
      }
      validateComponentMarkup(body.markup);
      const tagNameEnd = target.start + 1 + target.name.length;
      const lastAttributeEnd = target.attributes.reduce((end: number, attribute: any) => Math.max(end, attribute.end ?? end), tagNameEnd);
      let openingEnd = lastAttributeEnd;
      while (/\s/.test(source[openingEnd] ?? "")) openingEnd += 1;
      if (source[openingEnd] === "/") throw new Error("Components cannot be inserted into self-closing elements");
      if (source[openingEnd] !== ">") throw new Error("Could not locate the selected element's closing boundary");
      const children = target.fragment.nodes as Array<{ end: number }>;
      const insertionAt = children.length ? children.at(-1)!.end : openingEnd + 1;
      previous = "";
      next = body.markup;
      updated = `${source.slice(0, insertionAt)}${body.markup}${source.slice(insertionAt)}`;
    } else {
      if (typeof body.expected !== "string" || typeof body.value !== "string" || body.value.length > 2_000) throw new Error("Expected a static leaf-text edit");
      const children = target.fragment.nodes;
      if (children.length !== 1 || children[0].type !== "Text" || children[0].data !== body.expected) {
        throw new Error("Target is dynamic, has nested elements, or changed since selection");
      }
      const text = children[0];
      previous = body.expected; next = body.value;
      updated = `${source.slice(0, text.start)}${escapeText(next)}${source.slice(text.end)}`;
    }
    if (updated === source) return sendJson(response, { previous, value: next, file: body.file, unchanged: true, revision });
    compile(updated, { filename, generate: "client" });
    if (body.action === "preview") {
      const diff = sourceDiff(source, updated);
      return sendJson(response, { previous, value: next, file: body.file, revision, ...diff });
    }
    writeSource(filename, updated);
    history.entries = history.entries.slice(0, history.cursor);
    history.entries.push({ file: body.file, before: source, after: updated });
    history.cursor = history.entries.length;
    writeSourceHistory(historyPath, history);
    await reloadSourceModule(server, filename);
    sendJson(response, { previous, value: next, file: body.file, cursor: history.cursor, canUndo: true, canRedo: false });
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Source edit failed" }));
  }
}

function validateComponentMarkup(markup: string): void {
  const maxStyleDeclarations = 40;
  const fragment = parse(markup, { modern: true }).fragment;
  const allowedTags = new Set(["div", "p", "span", "button", "img"]);
  const allowedStyleProperties = new Set([
    "width", "height", "min-width", "max-width", "min-height", "max-height",
    "display", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "grid-template-columns", "order", "align-items", "align-self", "justify-content",
    "gap", "translate", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "color", "background-color", "font-size", "font-weight", "line-height",
    "border-radius", "border-width", "border-color",
  ]);
  let count = 0;
  const visit = (node: any, depth: number): void => {
    if (node.type === "Text") return;
    if (node.type === "ExpressionTag") {
      if (!isSafeMemberExpression(node.expression)) throw new Error("Svelte bindings must be simple variable or dotted property paths");
      return;
    }
    if (node.type !== "RegularElement" || !allowedTags.has(node.name) || depth > 8 || ++count > 50) {
      throw new Error("Component source supports static div, p, span, button, and image markup (max 50 nodes)");
    }
    for (const attribute of node.attributes) {
      if (attribute.type !== "Attribute") {
        throw new Error("Component source contains an unsupported or dynamic attribute");
      }
      const imageAttribute = node.name === "img" && ["src", "alt"].includes(attribute.name);
      if (!imageAttribute && !["class", "style", "data-hardlyui-slot"].includes(attribute.name)) {
        throw new Error("Component source contains an unsupported or dynamic attribute");
      }
      if (!Array.isArray(attribute.value) || attribute.value.some((part: any) => part.type !== "Text")) {
        throw new Error("Component source attributes must be static text");
      }
      const value = attribute.value.map((part: any) => part.data).join("");
      if (node.name === "img" && attribute.name === "src" && !safeComponentImageUrl(value)) {
        throw new Error("Component image must use HTTPS or a local app asset path");
      }
      if (node.name === "img" && attribute.name === "alt" && value.length > 500) {
        throw new Error("Component image alt text must be under 500 characters");
      }
      if (attribute.name === "class" && value.split(/\s+/).filter(Boolean).some((name: string) => !/^[\w:/\[\].#%-]{1,128}$/.test(name))) {
        throw new Error("Component source contains an invalid class name");
      }
      if (attribute.name === "data-hardlyui-slot" && !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value)) {
        throw new Error("Component source contains an invalid slot name");
      }
      if (attribute.name === "style") {
        const declarations = parseDeclarations(value);
        if (declarations.size > maxStyleDeclarations || [...declarations].some(([property, content]) =>
          !allowedStyleProperties.has(property) || content.length > 256 || /[{};<>]|url\s*\(|expression\s*\(/i.test(content),
        )) throw new Error("Component source contains an unsupported or unsafe style");
      }
    }
    if (node.name === "img" && !node.attributes.some((attribute: any) => attribute.type === "Attribute" && attribute.name === "src")) {
      throw new Error("Component images need a supported source address");
    }
    for (const child of node.fragment.nodes) visit(child, depth + 1);
  };
  if (fragment.nodes.length !== 1 || fragment.nodes[0].type !== "RegularElement") {
    throw new Error("Component source must have exactly one root element");
  }
  visit(fragment.nodes[0], 0);
}

function safeComponentImageUrl(value: string): boolean {
  if (!value || value.length > 2_048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
  return value.startsWith("https://") || value.startsWith("asset://") || value.startsWith("tauri://")
    || value.startsWith("http://localhost/") || value.startsWith("http://tauri.localhost/")
    || (!value.startsWith("//") && !value.includes(":") && !value.split("/").includes(".."));
}

function isSafeMemberExpression(expression: any): boolean {
  if (expression?.type === "Identifier") {
    return /^[A-Za-z_$][\w$]*$/.test(expression.name);
  }
  if (expression?.type === "MemberExpression" && expression.computed === false) {
    return isSafeMemberExpression(expression.object)
      && expression.property?.type === "Identifier"
      && /^[A-Za-z_$][\w$]*$/.test(expression.property.name);
  }
  return false;
}

function sourceRevision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function sourceDiff(before: string, after: string): { beforeCode: string; afterCode: string } {
  let prefix = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
  const start = Math.max(0, prefix - 100);
  const beforeEnd = Math.min(before.length, before.length - suffix + 100);
  const afterEnd = Math.min(after.length, after.length - suffix + 100);
  return { beforeCode: before.slice(start, beforeEnd), afterCode: after.slice(start, afterEnd) };
}

function resolveSourceFile(projectRoot: string, relative: string): string {
  const realRoot = fs.realpathSync(projectRoot);
  const filename = fs.realpathSync(path.resolve(projectRoot, relative));
  if (!filename.startsWith(`${realRoot}${path.sep}`)) throw new Error("Source path is outside the project");
  return filename;
}

function readSourceHistory(filename: string): SourceHistory {
  try {
    const value = JSON.parse(fs.readFileSync(filename, "utf8")) as SourceHistory;
    if (Array.isArray(value.entries) && Number.isSafeInteger(value.cursor) && value.cursor >= 0 && value.cursor <= value.entries.length) return value;
  } catch { /* A missing history starts empty. */ }
  return { entries: [], cursor: 0 };
}

function writeSourceHistory(filename: string, history: SourceHistory) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(history, null, 2), "utf8");
  fs.renameSync(temporary, filename);
}

function writeSource(filename: string, value: string) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, filename);
}

async function reloadSourceModule(server: ViteDevServer, filename: string) {
  const module = server.moduleGraph.getModuleById(filename);
  if (module) await server.reloadModule(module);
}

/** Content type for a stored picture name, or null when it is not one. */
function mediaContentType(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(name) || name.includes("..")) return null;
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
  } as Record<string, string>)[extension] ?? null;
}

function sendJson(response: ServerResponse, value: unknown) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

function parseDeclarations(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const content = declaration.slice(separator + 1).trim();
    if (/^(--[a-zA-Z0-9_-]+|[a-zA-Z-]+)$/.test(property) && content) result.set(property, content);
  }
  return result;
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("{", "&#123;").replaceAll("}", "&#125;");
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("{", "&#123;").replaceAll("}", "&#125;");
}

function findElement(fragment: { nodes: unknown[] }, offset: number): any {
  let found: any;
  const visit = (value: unknown, insideEach = false): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((child) => visit(child, insideEach));
    const node = value as Record<string, any>;
    const inEach = insideEach || node.type === "EachBlock";
    if (node.type === "RegularElement" && node.start === offset) found = { ...node, insideEach: inEach };
    for (const [key, child] of Object.entries(node)) if (key !== "parent") visit(child, inEach);
  };
  visit(fragment);
  return found;
}
