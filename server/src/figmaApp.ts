import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { addFollowViewers, followState } from './followRun.js';

// Her Figma app, shown in the Figma tab. A small helper (capture/figma-capture.swift, built with `npm run capture`)
// captures only the frontmost Figma window with ScreenCaptureKit and writes JPEG frames to its stdout. It runs only
// while a Figma tab viewer is open and visible, and it exits when its stdin closes, so it never outlives the server.
// Frames go straight to the viewers: they are never written, logged or kept.

export const HELPER = fileURLToPath(new URL('../../capture/build/figma-capture', import.meta.url));

/** What the helper says: capturing, or why not. `nohelper` (not built) and `stopped` come from the server. */
export type CaptureState = 'on' | 'noperm' | 'nofigma' | 'nowindow' | 'error' | 'nohelper' | 'stopped' | 'starting';
export type CaptureMsg = { kind: 'state'; state: CaptureState; detail?: string } | { kind: 'frame'; w: number; h: number; jpeg: Buffer };

const STATE = 1;
const FRAME = 2;
const MAX = 32 * 1024 * 1024;

/**
 * Reads the helper's stdout: records of one type byte, a 4-byte big-endian length, then the payload. A state is
 * JSON ({state, detail?}); a frame is the window's width and height in points (4 bytes each) and then the JPEG.
 * Chunks may split records anywhere. A record that cannot be read ends the stream with an error.
 */
export function captureReader(onMsg: (m: CaptureMsg) => void) {
  let buf: Buffer = Buffer.alloc(0);
  let broken = false;
  return (chunk: Buffer) => {
    if (broken) return;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 5) {
      const type = buf[0];
      const len = buf.readUInt32BE(1);
      if (len > MAX || (type !== STATE && type !== FRAME) || (type === FRAME && len < 8)) {
        broken = true;
        buf = Buffer.alloc(0);
        onMsg({ kind: 'state', state: 'error', detail: 'unreadable output from the capture helper' });
        return;
      }
      if (buf.length < 5 + len) return;
      const body = buf.subarray(5, 5 + len);
      buf = buf.subarray(5 + len);
      if (type === FRAME) onMsg({ kind: 'frame', w: body.readUInt32BE(0), h: body.readUInt32BE(4), jpeg: Buffer.from(body.subarray(8)) });
      else {
        try {
          const j = JSON.parse(body.toString('utf8'));
          onMsg({ kind: 'state', state: typeof j.state === 'string' ? j.state : 'error', detail: typeof j.detail === 'string' ? j.detail.slice(0, 200) : undefined });
        } catch {
          onMsg({ kind: 'state', state: 'error', detail: 'unreadable state from the capture helper' });
        }
      }
    }
  };
}

type Viewer = { visible: boolean; w: number; h: number };
const viewers = new Map<WebSocket, Viewer>();
let helper: ChildProcess | null = null;
let state: { state: CaptureState; detail?: string } = { state: 'stopped' };
let sentSize = '';

function broadcast(m: object) {
  const s = JSON.stringify(m);
  viewers.forEach((_, v) => v.readyState === WebSocket.OPEN && v.send(s));
}

addFollowViewers(broadcast);

function setState(s: CaptureState, detail?: string) {
  state = { state: s, detail };
  broadcast({ t: 'capture', ...state });
}

/** The largest pane among visible viewers, in device pixels: the helper scales the window to fit it. */
function wanted() {
  let w = 0;
  let h = 0;
  viewers.forEach((v) => { if (v.visible) { w = Math.max(w, v.w); h = Math.max(h, v.h); } });
  return { w: w || 1600, h: h || 1200 };
}

function sendSize() {
  if (!helper?.stdin?.writable) return;
  const { w, h } = wanted();
  const line = `size ${w} ${h}\n`;
  if (line === sentSize) return;
  sentSize = line;
  helper.stdin.write(line);
}

/** Starts the helper when someone is looking at the Figma tab, stops it when no one is. */
function update() {
  const looking = [...viewers.values()].some((v) => v.visible);
  if (looking && !helper) start();
  else if (!looking && helper) stop();
  else sendSize();
}

function start() {
  if (process.platform !== 'darwin' || !existsSync(HELPER)) return setState('nohelper');
  const { w, h } = wanted();
  sentSize = `size ${w} ${h}\n`;
  const child = spawn(HELPER, ['--width', String(w), '--height', String(h)], { stdio: ['pipe', 'pipe', 'pipe'] });
  helper = child;
  setState('starting');
  const read = captureReader((m) => {
    if (helper !== child) return;
    if (m.kind === 'state') return setState(m.state, m.detail);
    const s = JSON.stringify({ t: 'frame', data: m.jpeg.toString('base64'), w: m.w, h: m.h });
    viewers.forEach((v, ws) => v.visible && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 2_000_000 && ws.send(s));
  });
  child.stdout!.on('data', read);
  // Only the helper's own words, never frame data, reach the log.
  child.stderr!.on('data', (d: Buffer) => console.error('figma capture:', d.toString('utf8').trim().slice(0, 300)));
  child.stdin!.on('error', () => {});
  child.on('error', (err) => { if (helper === child) { helper = null; setState('error', err.message); } });
  child.on('exit', (code) => {
    if (helper !== child) return;
    helper = null;
    setState(code === 0 ? 'stopped' : 'error', code === 0 ? undefined : `the capture helper stopped (${code})`);
  });
}

function stop() {
  const child = helper;
  helper = null;
  sentSize = '';
  if (!child) return;
  child.stdin?.end();
  const kill = setTimeout(() => child.kill('SIGTERM'), 1000);
  child.once('exit', () => clearTimeout(kill));
  setState('stopped');
}

/**
 * A Figma tab viewer for the Figma app (/ws?figma-app). It sends {t:'size', w, h} in device pixels and
 * {t:'visible', on} when the page is hidden or shown; it gets {t:'capture', state, detail?} and {t:'frame', data, w, h}.
 */
export function openFigmaApp(ws: WebSocket) {
  viewers.set(ws, { visible: true, w: 1600, h: 1200 });
  ws.send(JSON.stringify({ t: 'capture', ...state }));
  ws.send(JSON.stringify(followState()));
  update();
  ws.on('message', (raw) => {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const v = viewers.get(ws);
    if (!v || !m || typeof m !== 'object') return;
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
    if (m.t === 'size') {
      v.w = Math.round(Math.min(3840, Math.max(200, num(m.w))));
      v.h = Math.round(Math.min(3840, Math.max(200, num(m.h))));
    } else if (m.t === 'visible') v.visible = m.on !== false;
    update();
  });
  ws.on('close', () => {
    viewers.delete(ws);
    update();
  });
}

export const captureStatus = () => state;
