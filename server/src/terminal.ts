import path from 'node:path';
import { spawn, type IPty } from 'node-pty';
import { WebSocket } from 'ws';

const MAX = 200_000;
type Term = { id: string; chat: string; name: string; pty: IPty; buf: string; socks: Set<WebSocket> };
const terms = new Map<string, Term>();
let seq = 0;

export const listTerminals = (chat: string) => [...terms.values()].filter((t) => t.chat === chat).map(({ id, name }) => ({ id, name }));

export function createTerminal(chat: string, cwd: string) {
  const shell = process.env.SHELL || '/bin/zsh';
  const used = new Set(listTerminals(chat).map((t) => t.name));
  const label = (n: number) => (n === 1 ? path.basename(shell) : `${path.basename(shell)} ${n}`);
  let n = 1;
  while (used.has(label(n))) n++;
  const pty = spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });
  const t: Term = { id: String(++seq), chat, name: label(n), pty, buf: '', socks: new Set() };
  pty.onData((d) => {
    t.buf += d;
    if (t.buf.length > MAX) t.buf = t.buf.slice(t.buf.indexOf('\n', t.buf.length - MAX) + 1);
    t.socks.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(d));
  });
  pty.onExit(() => {
    terms.delete(t.id);
    t.socks.forEach((ws) => ws.close());
  });
  terms.set(t.id, t);
  return { id: t.id, name: t.name };
}

export function closeTerminal(id: string) {
  terms.get(id)?.pty.kill();
  terms.delete(id);
  return { ok: true };
}

export const closeTerminals = (chat: string) => listTerminals(chat).forEach((t) => closeTerminal(t.id));

export function attachTerminal(ws: WebSocket, id: string) {
  const t = terms.get(id);
  if (!t) return ws.close();
  if (t.buf) ws.send(t.buf);
  t.socks.add(ws);
  ws.on('message', (raw) => {
    let m: { t: string; d?: string; c?: number; r?: number };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'i' && typeof m.d === 'string') t.pty.write(m.d);
    if (m.t === 'r' && m.c && m.r) t.pty.resize(Math.max(2, Math.floor(m.c)), Math.max(2, Math.floor(m.r)));
    if (m.t === 'c') t.buf = t.buf.slice(t.buf.lastIndexOf('\n') + 1);
  });
  ws.on('close', () => t.socks.delete(ws));
}
