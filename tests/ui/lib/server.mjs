/**
 * Static server for the UI tests.
 *
 * Serves the built inspector app at `/`, a host page running the bundled guest
 * runtime at `/host.html`, and the guest bundle itself. Everything is read from
 * the repository, so a test run needs no network.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export const HOST_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Host app</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0d10; color: #e6edf3; }
      h1 { font-size: 20px; }
      .card { border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-top: 16px; max-width: 420px; }
      button { background: #1f6feb; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 14px; }
    </style>
    <script src="/guest-runtime.iife.js"></script>
  </head>
  <body>
    <h1 id="title">Host app</h1>
    <div class="card" id="card">
      <p id="copy">Pick this paragraph to test selection.</p>
      <button id="save" type="button">Save</button>
    </div>
  </body>
</html>
`;

export function createStaticServer(root) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/host.html') {
      response.writeHead(200, { 'content-type': TYPES['.html'] });
      response.end(HOST_PAGE);
      return;
    }

    const guestBundle = join(root, 'crates/plugin/guest/guest-runtime.iife.js');
    const file = url.pathname === '/guest-runtime.iife.js' ? guestBundle : join(root, 'packages/inspector-app/dist', normalize(url.pathname));
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}
