import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { parseFigmaUrl } from '../../shared/design.js';

type Tab = { id: string; title: string; url: string; at: number };
type State = 'off' | 'connecting' | 'on';
type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

const PORT_FILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');

let cdp: WebSocket | null = null;
let state: State = 'off';
let reason = '';
let nextId = 1;
const calls = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
const tabs = new Map<string, Tab>();
const viewers = new Set<WebSocket>();
const selfOrigins = new Set<string>();
const hidden = new Set<string>();
let pinned: string | null = null;
let watching: { target: string; session: string } | null = null;
let watchSeq = 0;
let size = { w: 1600, h: 1200 };
type Dims = { cssW: number; cssH: number; dpr: number; mobile: boolean };
const sizes = new Map<WebSocket, Dims>();
let emulated: { session: string; key: string } | null = null;
let viewport = { w: 0, h: 0 };
let retryTimer: NodeJS.Timeout | null = null;
let retryDelay = 2000;
let fastUntil = 0;
const RETRY = new Set(['disabled', 'nochrome', 'closed', 'nofda']);

export async function endpoint() {
  if (process.env.CHROME_CDP) return process.env.CHROME_CDP;
  try {
    const [port, p] = (await readFile(PORT_FILE, 'utf8')).trim().split('\n');
    return `ws://127.0.0.1:${port}${p}`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') throw new Error('nofda');
    throw new Error((await chromeRunning()) ? 'disabled' : 'nochrome');
  }
}

export function chromeRunning() {
  if (process.platform !== 'darwin') return Promise.resolve(true);
  return new Promise<boolean>((resolve) => execFile('pgrep', ['-x', 'Google Chrome'], (err) => resolve(!err)));
}

async function failure(err: NodeJS.ErrnoException) {
  if (err.code === 'ECONNREFUSED') return (await chromeRunning()) ? 'disabled' : 'nochrome';
  if (/\b403\b/.test(err.message)) return 'denied';
  if (/\b404\b/.test(err.message)) return 'disabled';
  if (/\b410\b/.test(err.message)) return 'nochrome';
  if (/\b451\b/.test(err.message)) return 'nofda';
  if (/\b504\b/.test(err.message)) return 'timeout';
  if (/handshake has timed out/i.test(err.message)) return 'timeout';
  return err.message;
}

function retry() {
  if (retryTimer || !viewers.size || !RETRY.has(reason)) return;
  broadcast({ t: 'state', state, reason, retry: true });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, retryDelay);
  retryDelay = Date.now() < fastUntil ? 1500 : Math.min(retryDelay * 2, 30000);
}

const SETUP_PAGE = 'chrome://inspect/#remote-debugging';

function setup() {
  fastUntil = Date.now() + 3 * 60_000;
  retryDelay = 1500;
  const run = (...args: string[]) => execFile('open', args, (err) => err && console.error('chrome setup:', err.message));
  if (process.platform === 'darwin' && reason === 'nofda') {
    run('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    run('-R', fileURLToPath(new URL('../../dist/DesignStudio.app', import.meta.url)));
  } else if (process.platform === 'darwin') run('-a', 'Google Chrome', SETUP_PAGE);
  if (state === 'off') setTimeout(() => void connect(), 1500);
}

function broadcast(m: object) {
  const s = JSON.stringify(m);
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.send(s));
}

function setState(s: State, why = '') {
  state = s;
  reason = why;
  broadcast({ t: 'state', state, reason });
  if (s === 'off') retry();
}

function call(method: string, params: object = {}, sessionId?: string, ms = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!cdp || cdp.readyState !== WebSocket.OPEN) return reject(new Error('Chrome is not connected'));
    const id = nextId++;
    const timer = setTimeout(() => {
      calls.delete(id);
      reject(new Error(`${method} timed out`));
    }, ms);
    calls.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    cdp.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

export async function connect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (cdp || state === 'connecting') return;
  setState('connecting');
  let url: string;
  try {
    url = await endpoint();
  } catch (err) {
    return setState('off', (err as Error).message);
  }
  const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024, handshakeTimeout: 60000 });
  let failed: Promise<string> | null = null;
  ws.on('open', async () => {
    cdp = ws;
    retryDelay = 2000;
    setState('on');
    try {
      await call('Target.setDiscoverTargets', { discover: true });
      const { targetInfos } = await call('Target.getTargets');
      targetInfos.forEach((t: any) => track(t, false));
      pick();
    } catch (err) {
      console.error('chrome:', err);
    }
  });
  ws.on('message', (raw) => {
    try {
      onMessage(JSON.parse(String(raw)));
    } catch (err) {
      console.error('chrome message:', err);
    }
  });
  ws.on('error', (err: NodeJS.ErrnoException) => {
    failed ??= failure(err);
  });
  ws.on('close', async () => {
    const was = cdp === ws;
    cdp = null;
    watching = null;
    emulated = null;
    tabs.clear();
    calls.forEach((c) => c.reject(new Error('Chrome disconnected')));
    calls.clear();
    sendTabs();
    setState('off', was ? 'closed' : ((await failed) ?? 'closed'));
  });
}

function isPage(t: any) {
  return t.type === 'page' && !/^(devtools|chrome-extension):/.test(t.url);
}

function isSelf(url: string) {
  try {
    return selfOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function track(t: any, live: boolean) {
  if (!isPage(t) || hidden.has(t.targetId)) return;
  const prev = tabs.get(t.targetId);
  const moved = live && (!prev || prev.url !== t.url);
  tabs.set(t.targetId, { id: t.targetId, title: t.title, url: t.url, at: moved ? Date.now() : (prev?.at ?? 0) });
  return moved;
}

function onMessage(m: Msg) {
  if (m.id) {
    const c = calls.get(m.id);
    calls.delete(m.id);
    if (m.error) c?.reject(new Error(m.error.message));
    else c?.resolve(m.result);
    return;
  }
  switch (m.method) {
    case 'Target.targetCreated':
    case 'Target.targetInfoChanged':
      if (track(m.params.targetInfo, true)) pick();
      else sendTabs();
      break;
    case 'Target.targetDestroyed':
      tabs.delete(m.params.targetId);
      if (pinned === m.params.targetId) pinned = null;
      if (watching?.target === m.params.targetId) watching = null;
      pick();
      break;
    case 'Page.screencastVisibilityChanged':
      if (m.sessionId === watching?.session && !m.params.visible && !pinned) pick();
      break;
    case 'Page.screencastFrame':
      if (m.sessionId !== watching?.session) return;
      void call('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId).catch(() => {});
      viewport = { w: m.params.metadata.deviceWidth, h: m.params.metadata.deviceHeight };
      frame(m.params.data);
      break;
  }
}

function frame(data: string) {
  const s = JSON.stringify({ t: 'frame', data, w: viewport.w, h: viewport.h });
  viewers.forEach((v) => v.readyState === WebSocket.OPEN && v.bufferedAmount < 2_000_000 && v.send(s));
}

function sendTabs() {
  const list = [...tabs.values()].filter((t) => !isSelf(t.url)).map(({ id, title, url }) => ({ id, title, url }));
  broadcast({ t: 'tabs', tabs: list, current: watching?.target ?? null, pinned });
}

async function isVisible(targetId: string) {
  const own = watching?.target === targetId ? watching.session : null;
  let session = own;
  try {
    session ??= (await call('Target.attachToTarget', { targetId, flatten: true }, undefined, 3000)).sessionId as string;
    const { result } = await call('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, session, 3000);
    return result?.value === 'visible';
  } catch {
    return false;
  } finally {
    if (session && !own) void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
  }
}

let picking = 0;
let settled = 0;
let shown = true;
let pickTimer: NodeJS.Timeout | null = null;

function pick() {
  sendTabs();
  if (pickTimer) clearTimeout(pickTimer);
  pickTimer = setTimeout(() => void choose(), 250);
}

async function choose() {
  if (!viewers.size || !cdp) return;
  const seq = ++picking;
  const list = [...tabs.values()].filter((t) => !isSelf(t.url)).sort((a, b) => b.at - a.at);
  let target = pinned && tabs.has(pinned) ? pinned : null;
  for (const t of target ? [] : list) {
    if (await isVisible(t.id)) {
      target = t.id;
      break;
    }
    if (seq !== picking) return;
  }
  if (!target && watching && tabs.has(watching.target) && !pinned) target = watching.target;
  target ??= list[0]?.id ?? null;
  if (seq !== picking) return;
  if (target && target !== watching?.target) await watch(target);
  if (seq === picking) settled = seq;
  sendTabs();
}

async function watch(target: string) {
  const seq = ++watchSeq;
  const prev = watching;
  watching = null;
  if (prev) release(prev.session);
  try {
    const { sessionId } = await call('Target.attachToTarget', { targetId: target, flatten: true });
    if (seq !== watchSeq) return void call('Target.detachFromTarget', { sessionId }).catch(() => {});
    watching = { target, session: sessionId };
    sendTabs();
    await call('Page.enable', {}, sessionId);
    await emulate(false);
    const { cssVisualViewport: v } = await call('Page.getLayoutMetrics', {}, sessionId);
    viewport = { w: v.clientWidth, h: v.clientHeight };
    await screencast();
    await snapshot();
  } catch (err) {
    console.error('chrome watch:', err);
    if (seq === watchSeq && watching) {
      release(watching.session);
      watching = null;
    }
  }
}

async function snapshot() {
  const session = watching?.session;
  if (!session) return;
  const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, session);
  if (watching?.session === session) frame(shot.data);
}

setInterval(async () => {
  if (!viewers.size || !cdp || picking !== settled) return;
  if (!watching) return tabs.size && pick();
  const was = shown;
  shown = await isVisible(watching.target);
  if (!pinned && was && !shown) pick();
}, 2000).unref();

async function screencast() {
  if (!watching) return;
  await call('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: size.w, maxHeight: size.h }, watching.session);
}

function release(session: string) {
  if (emulated?.session === session && emulated.key) {
    void call('Emulation.clearDeviceMetricsOverride', {}, session).catch(() => {});
    void call('Emulation.setTouchEmulationEnabled', { enabled: false }, session).catch(() => {});
  }
  if (emulated?.session === session) emulated = null;
  void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
}

async function emulate(restart = true) {
  if (!watching) return;
  const m = [...sizes.values()].reverse().find((d) => d.mobile);
  const key = m ? `${m.cssW}x${m.cssH}@${m.dpr}` : '';
  const { session } = watching;
  if ((emulated?.session === session ? emulated.key : '') === key) return;
  emulated = { session, key };
  try {
    if (m) {
      await call('Emulation.setDeviceMetricsOverride', { width: m.cssW, height: m.cssH, deviceScaleFactor: m.dpr, mobile: true }, session);
      await call('Emulation.setTouchEmulationEnabled', { enabled: true }, session);
    } else {
      await call('Emulation.clearDeviceMetricsOverride', {}, session);
      await call('Emulation.setTouchEmulationEnabled', { enabled: false }, session);
    }
    if (restart) await screencast();
  } catch {}
}

function stop() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 2000;
  if (!watching) return;
  release(watching.session);
  watching = null;
  watchSeq++;
}

const BUTTONS = new Set(['left', 'right', 'middle', 'none']);

async function input(m: any, ws: WebSocket) {
  const s = watching?.session;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  switch (m.t) {
    case 'connect':
      return connect();
    case 'setup':
      return setup();
    case 'tab':
      pinned = typeof m.id === 'string' && tabs.has(m.id) ? m.id : null;
      if (pinned) await call('Target.activateTarget', { targetId: pinned }).catch(() => {});
      return pick();
    case 'size':
      size = { w: Math.min(2400, Math.max(200, num(m.w))), h: Math.min(2400, Math.max(200, num(m.h))) };
      sizes.delete(ws);
      sizes.set(ws, {
        cssW: Math.min(2400, Math.max(100, Math.round(num(m.cssW)))),
        cssH: Math.min(2400, Math.max(100, Math.round(num(m.cssH)))),
        dpr: Math.min(4, Math.max(1, num(m.dpr) || 1)),
        mobile: m.mobile === true,
      });
      await emulate(false);
      return screencast().catch(() => {});
  }
  if (!s) return;
  switch (m.t) {
    case 'nav': {
      if (typeof m.url !== 'string' || !m.url.trim()) return;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(m.url) ? m.url : `https://${m.url}`;
      return call('Page.navigate', { url }, s);
    }
    case 'reload':
      return call('Page.reload', {}, s);
    case 'back':
    case 'forward': {
      const { currentIndex, entries } = await call('Page.getNavigationHistory', {}, s);
      const entry = entries[currentIndex + (m.t === 'back' ? -1 : 1)];
      return entry && call('Page.navigateToHistoryEntry', { entryId: entry.id }, s);
    }
    case 'mouse':
      if (!['mousePressed', 'mouseReleased', 'mouseMoved'].includes(m.type)) return;
      return call('Input.dispatchMouseEvent', {
        type: m.type,
        x: num(m.x),
        y: num(m.y),
        button: BUTTONS.has(m.button) ? m.button : 'none',
        buttons: num(m.buttons),
        clickCount: num(m.clickCount),
        modifiers: num(m.modifiers),
      }, s);
    case 'wheel':
      return call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: num(m.x), y: num(m.y), deltaX: num(m.dx), deltaY: num(m.dy) }, s);
    case 'key': {
      if (typeof m.key !== 'string') return;
      const base = { key: m.key, code: String(m.code ?? ''), windowsVirtualKeyCode: num(m.keyCode), modifiers: num(m.modifiers) };
      await call('Input.dispatchKeyEvent', { ...base, type: m.key === 'Enter' ? 'keyDown' : 'rawKeyDown', text: m.key === 'Enter' ? '\r' : undefined }, s);
      return call('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, s);
    }
    case 'text':
      if (typeof m.text === 'string' && m.text) return call('Input.insertText', { text: m.text }, s);
  }
}

export const chromeStatus = () => ({ state, reason });

export function openChrome(ws: WebSocket, origin: string | undefined) {
  if (origin) selfOrigins.add(origin);
  viewers.add(ws);
  ws.send(JSON.stringify({ t: 'state', state, reason }));
  if (cdp) {
    pick();
    void snapshot().catch(() => {});
  } else void connect();
  ws.on('message', (raw) => {
    let m: unknown;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    input(m, ws).catch((err) => console.error('chrome input:', err.message));
  });
  ws.on('close', () => {
    viewers.delete(ws);
    const was = sizes.delete(ws);
    if (!viewers.size) return stop();
    if (was) void emulate();
  });
}

const FOCUS = (id: string) => `(async () => {
  if (typeof figma === 'undefined' || !figma.getNodeByIdAsync) return 'noapi';
  const n = await figma.getNodeByIdAsync(${JSON.stringify(id)});
  if (!n) return 'nonode';
  let p = n;
  while (p && p.type !== 'PAGE') p = p.parent;
  if (p && figma.currentPage !== p) await figma.setCurrentPageAsync(p);
  figma.viewport.scrollAndZoomIntoView([n]);
  return 'ok';
})()`;

export function pickFigmaTabs(list: Array<{ title: string; url: string; at: number }>, max = 5) {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string }> = [];
  for (const t of [...list].sort((a, b) => b.at - a.at)) {
    const key = /figma\.com\/(design|file|proto)\//.test(t.url) ? parseFigmaUrl(t.url)?.key : undefined;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: t.title.replace(/\s[–-]\sFigma$/, '') || 'Figma file', url: t.url });
  }
  return out.slice(0, max);
}

export const figmaTabs = () => pickFigmaTabs([...tabs.values()]);

function figmaTab(fileKey: string) {
  return [...tabs.values()].filter((t) => t.url.includes(`/${fileKey}`) && /figma\.com\/(design|file|proto)\//.test(t.url)).sort((a, b) => b.at - a.at)[0] ?? null;
}

export async function openUrl(url: string) {
  if (!cdp) await connect();
  if (!cdp) throw new Error('Design Studio cannot see Chrome yet. Open the Figma tab and press Allow in Chrome.');
  const { targetId } = await call('Target.createTarget', { url });
  pinned = targetId;
  pick();
  return targetId as string;
}

export async function showFigma(fileKey: string, url: string) {
  const tab = cdp ? figmaTab(fileKey) : null;
  if (!tab) return openUrl(url);
  pinned = tab.id;
  await call('Target.activateTarget', { targetId: tab.id }).catch(() => {});
  pick();
  return tab.id;
}

export async function focusFigma(fileKey: string, nodeId: string, navigate: boolean) {
  if (!cdp) return 'nochrome';
  const tab = figmaTab(fileKey);
  const url = `https://www.figma.com/design/${fileKey}?node-id=${nodeId.replace(':', '-')}`;
  if (!tab) return navigate ? (await openUrl(url), 'opened') : 'notab';
  const own = watching?.target === tab.id ? watching.session : null;
  let session = own;
  try {
    session ??= (await call('Target.attachToTarget', { targetId: tab.id, flatten: true }, undefined, 3000)).sessionId as string;
    const { result } = await call('Runtime.evaluate', { expression: FOCUS(nodeId), awaitPromise: true, returnByValue: true }, session, 8000);
    if (result?.value === 'ok') return 'ok';
    if (navigate) {
      await call('Page.navigate', { url }, session);
      return 'navigated';
    }
    return String(result?.value ?? 'failed');
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  } finally {
    if (session && !own) void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
  }
}

const MAX_SHOT_HEIGHT = 16000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function screenshotUrl(url: string, width: number): Promise<Buffer> {
  if (!cdp) await connect();
  if (!cdp) throw new Error('Design Studio cannot see Chrome yet. Open the Figma tab and press Allow in Chrome.');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', background: true, width, height: 900 });
  hidden.add(targetId);
  if (tabs.delete(targetId)) pick();
  let session = '';
  try {
    session = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId as string;
    await call('Page.enable', {}, session);
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    const nav = await call('Page.navigate', { url }, session, 30000);
    if (nav.errorText) throw new Error(`Could not open ${url}: ${nav.errorText}`);
    for (let i = 0; i < 60; i++) {
      const { result } = await call('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, session, 5000);
      if (result?.value === 'complete') break;
      await sleep(500);
    }
    await sleep(1000);
    const { cssContentSize: c } = await call('Page.getLayoutMetrics', {}, session);
    const height = Math.min(MAX_SHOT_HEIGHT, Math.max(1, Math.ceil(c.height)));
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, session, 60000);
    return Buffer.from(shot.data, 'base64');
  } finally {
    if (session) void call('Target.detachFromTarget', { sessionId: session }).catch(() => {});
    await call('Target.closeTarget', { targetId }).catch(() => {});
    setTimeout(() => hidden.delete(targetId), 5000);
  }
}
