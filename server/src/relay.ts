import http from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { chromeRunning, endpoint } from './chrome.js';

const PORT = Number(process.env.DESIGN_STUDIO_RELAY_PORT ?? 7780);
const TOKEN = process.env.DESIGN_STUDIO_RELAY_TOKEN ?? '';
const MAX = 512 * 1024 * 1024;

let chrome: WebSocket | null = null;
let opening: Promise<WebSocket> | null = null;
let client: WebSocket | null = null;
const attaching = new Set<number>();
const sessions = new Set<string>();

async function statusFor(err: unknown) {
  const e = err as NodeJS.ErrnoException;
  const m = e?.message ?? '';
  if (m === 'nofda') return 451;
  if (m === 'nochrome') return 410;
  if (m === 'disabled' || /\b404\b/.test(m)) return 404;
  if (e?.code === 'ECONNREFUSED') return (await chromeRunning()) ? 404 : 410;
  if (/\b403\b/.test(m)) return 403;
  if (/timed out/i.test(m)) return 504;
  return 502;
}

function open(): Promise<WebSocket> {
  if (chrome?.readyState === WebSocket.OPEN) return Promise.resolve(chrome);
  opening ??= (async () => {
    const ws = new WebSocket(await endpoint(), { maxPayload: MAX, handshakeTimeout: 60000 });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('error', () => {});
    ws.on('message', (data: RawData, binary: boolean) => {
      if (attaching.size) {
        const s = String(data);
        if (s.startsWith('{"id":')) {
          try {
            const m = JSON.parse(s);
            if (attaching.delete(m.id) && m.result?.sessionId) sessions.add(m.result.sessionId);
          } catch {}
        }
      }
      if (client?.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    ws.on('close', () => {
      chrome = null;
      sessions.clear();
      attaching.clear();
      client?.close(1011, 'closed');
    });
    chrome = ws;
    return ws;
  })().finally(() => {
    opening = null;
  });
  return opening;
}

function release() {
  let id = 1_000_000_000;
  sessions.forEach((sessionId) => chrome?.send(JSON.stringify({ id: id++, method: 'Target.detachFromTarget', params: { sessionId } })));
  sessions.clear();
  attaching.clear();
}

function attach(ws: WebSocket) {
  client?.close(1000, 'replaced');
  release();
  client = ws;
  ws.on('message', (data: RawData, binary: boolean) => {
    const s = String(data);
    if (s.includes('"Target.attachToTarget"')) {
      try {
        attaching.add(JSON.parse(s).id);
      } catch {}
    }
    chrome?.send(data, { binary });
  });
  ws.on('close', () => {
    if (client !== ws) return;
    client = null;
    release();
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX });
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' }).end(chrome ? 'on' : 'off');
});

server.on('upgrade', async (req, socket, head) => {
  if (req.headers.origin || req.url !== `/${TOKEN}`) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  try {
    await open();
  } catch (err) {
    const code = await statusFor(err);
    socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code] ?? 'Error'}\r\nConnection: close\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(req, socket, head, attach);
});

if (!TOKEN) {
  console.error('relay: DESIGN_STUDIO_RELAY_TOKEN is not set');
  process.exit(1);
}
server.listen(PORT, '127.0.0.1', () => console.log(`chrome relay on 127.0.0.1:${PORT}`));
