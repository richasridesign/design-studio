// Design Studio's canvas plugin, copied here by Design Studio and refreshed each time it starts this app. It is off
// unless Design Studio started the dev server (DS_CANVAS_CORE is set), so `npm run dev` on its own is plain Vite.
//
// It stamps data-ds-src="file:line:col" on every JSX element through canvas-core (Rust), serves the client script
// that lets the canvas pick elements inside a frame, and lists the screens and scenarios at /__ds/manifest.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function engine(bin) {
  const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let next = 1;
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  proc.on('exit', () => { for (const done of waiting.values()) done({ error: 'canvas-core stopped' }); waiting.clear(); });
  return {
    call: (req) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); proc.stdin.write(JSON.stringify({ ...req, id }) + '\n'); }),
    stop: () => proc.kill(),
  };
}

export default function designStudio() {
  const bin = process.env.DS_CANVAS_CORE;
  let core = null;
  let root = process.cwd();
  return {
    name: 'designstudio-canvas',
    apply: 'serve',
    enforce: 'pre',
    configResolved(c) { root = c.root; },
    configureServer(server) {
      if (!bin) return;
      core = engine(bin);
      server.httpServer?.once('close', () => core?.stop());
      server.middlewares.use('/__ds/client.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript');
        res.end(readFileSync(path.join(here, 'client.js'), 'utf8'));
      });
      server.middlewares.use('/__ds/manifest', async (_req, res) => {
        res.setHeader('content-type', 'application/json');
        try {
          const { screens } = await server.ssrLoadModule('/src/screens/index.ts');
          const { scenarios } = await server.ssrLoadModule('/src/scenarios/index.ts');
          res.end(JSON.stringify({
            screens: screens.map((s) => ({ route: s.route, name: s.name })),
            scenarios: scenarios.map((s) => ({ id: s.id, name: s.name })),
          }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err?.message ?? err).split('\n')[0] }));
        }
      });
    },
    async transform(code, id) {
      if (!core) return;
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/') || !file.startsWith(path.join(root, 'src') + path.sep)) return;
      const r = await core.call({ cmd: 'stamp', path: file, label: path.relative(root, file), source: code });
      if (r.code) return { code: r.code, map: null };
    },
    transformIndexHtml() {
      if (!core) return;
      return [{ tag: 'script', attrs: { type: 'module', src: '/__ds/client.js' }, injectTo: 'body' }];
    },
  };
}
