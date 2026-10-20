import type { FollowResult, FollowView } from './follow.js';

// The Design Studio plugin in her Figma app (figma-plugin/). Its window holds a socket to /ws?figma-plugin and says
// which file it runs in. The server sends it follow targets as plain data (node ids and the last view, never code)
// and it answers with the result. It also says when she moved the view herself.

/** The socket, as far as this module uses it (a ws WebSocket, or a fake in tests). */
export type PluginSocket = {
  send: (data: string) => void;
  readyState: number;
  on(event: 'message', cb: (raw: unknown) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  /** Absent on a fake socket in tests. */
  terminate?: () => void;
};
export type PluginHooks = {
  /** She moved the view in this file: following pauses there. */
  moved: (fileKey: string) => void;
  /** A plugin came, went or changed file: views are forgotten and the state is sent again. */
  changed: () => void;
  /** She went to another page in the file: only the state is sent again, views stay. */
  page?: () => void;
  /** Nodes that changed in this file while Claude edits it (the plugin sends them only then). */
  edited?: (fileKey: string, ids: string[]) => void;
};

type Conn = {
  ws: PluginSocket;
  /** figma.fileKey, which Figma gives only to some plugins; null when it did not. */
  key: string | null;
  name: string;
  page: string;
  /** The page's name, shown in the Figma tab header. */
  pageName: string;
  /** The chat file this plugin was last matched to by name, so her move pauses the right file. */
  followKey: string | null;
  pending: Map<number, (r: FollowResult | string) => void>;
  /** The last follow got no answer from Figma: the plugin runs, but its file is not the front tab in Figma. */
  stalled: boolean;
  /** What the plugin was last told: send the changes landing in the file (Claude edits it) or not. */
  editing: boolean;
};

const conns = new Set<Conn>();
let nextId = 1;
const OPEN = 1;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const KEY = /^[A-Za-z0-9]{10,64}$/;
/** Every PING_MS the server pings the plugin; a socket that answered nothing by the next ping is dead and dropped. */
export const PING_MS = 10_000;

export function openFigmaPlugin(ws: PluginSocket, hooks: PluginHooks) {
  const conn: Conn = { ws, key: null, name: '', page: '', pageName: '', followKey: null, pending: new Map(), stalled: false, editing: false };
  // A plugin window that Figma froze or a Mac that slept leaves a socket open on this side with nobody behind it:
  // follows would wait on it. {t:'ping'} is answered by the plugin code itself (never by the browser on its own,
  // the way a protocol ping is), so only a plugin that can still run counts as alive.
  let alive = true;
  const timer = setInterval(() => {
    if (ws.readyState !== OPEN) return;
    if (!alive) {
      console.log(`figma plugin: no answer from "${conn.name}", dropping it`);
      ws.terminate?.();
      return;
    }
    alive = false;
    try {
      ws.send(JSON.stringify({ t: 'ping' }));
    } catch {}
  }, PING_MS);
  ws.on('message', (raw) => {
    alive = true;
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const key = str(m.fileKey, 64);
      conn.key = KEY.test(key) ? key : null;
      conn.name = str(m.fileName);
      conn.page = str(m.pageId, 64);
      conn.pageName = str(m.pageName);
      conn.followKey = null;
      conns.add(conn);
      console.log(`figma plugin: running in "${conn.name}" (${conn.key ?? 'no file key, matched by name'}), page "${conn.pageName}"`);
      hooks.changed();
    } else if (m.t === 'page' && conns.has(conn)) {
      conn.page = str(m.pageId, 64);
      conn.pageName = str(m.pageName);
      hooks.page?.();
    } else if (m.t === 'result' && typeof m.id === 'number') {
      const done = conn.pending.get(m.id);
      conn.pending.delete(m.id);
      done?.(validResult(m.result) ?? 'failed: bad answer from the plugin');
    } else if (m.t === 'changed' && Array.isArray(m.ids)) {
      const key = conn.key ?? conn.followKey;
      const ids = m.ids.filter((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(0, 50);
      console.log(`DEBUG figma plugin: ${ids.length} changed node(s) in "${conn.name}", editing ${conn.editing ? 'on' : 'off'}`);
      if (key && conn.editing && ids.length) hooks.edited?.(key, ids);
    } else if (m.t === 'moved') {
      const key = conn.key ?? conn.followKey;
      if (key) hooks.moved(key);
    }
  });
  ws.on('close', () => {
    clearInterval(timer);
    if (conns.has(conn)) console.log(`figma plugin: closed in "${conn.name}"`);
    conns.delete(conn);
    conn.pending.forEach((done) => done('failed: the plugin closed'));
    conn.pending.clear();
    hooks.changed();
  });
}

function validResult(r: any): FollowResult | null {
  if (!r || typeof r !== 'object' || !['ok', 'shown', 'moved', 'nonode', 'noapi', 'stalled'].includes(r.status)) return null;
  const v = r.view;
  if (v === undefined) return { status: r.status };
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (!v || typeof v.page !== 'string' || typeof v.targets !== 'string' || !num(v.cx) || !num(v.cy) || !num(v.zoom) || v.zoom <= 0) return null;
  return { status: r.status, view: { page: v.page, targets: v.targets, cx: v.cx, cy: v.cy, zoom: v.zoom } };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The plugin running in this file: by the file's key when Figma gave it to the plugin, else by the file's name.
 * The newest connection wins, since she may have reopened the plugin.
 */
export function pluginFor(fileKey: string, name?: string): Conn | null {
  const live = [...conns].filter((c) => c.ws.readyState === OPEN).reverse();
  const byKey = live.find((c) => c.key === fileKey);
  if (byKey) return byKey;
  const byName = name && norm(name) ? live.find((c) => !c.key && norm(c.name) === norm(name)) : undefined;
  if (!byName) return null;
  byName.followKey = fileKey;
  return byName;
}

export const pluginFiles = () => [...conns].map((c) => ({ key: c.key ?? c.followKey, name: c.name, page: c.pageName, stalled: c.stalled }));

/** Remembers whether Figma answers this plugin's follows; true when that changed, so the Figma tab can be told. */
export function markStalled(conn: Conn, stalled: boolean) {
  if (conn.stalled === stalled) return false;
  conn.stalled = stalled;
  return true;
}

/** Asks the plugin to show these nodes. A plugin that does not answer in `ms` counts as failed, not as a move. */
export function pluginFollow(conn: Conn, ids: string[], last: FollowView | null, start: boolean, ms = 8000): Promise<FollowResult | string> {
  return ask(conn, { t: 'follow', ids, last, start }, ms);
}

/** Asks the plugin to go to one node and fit it in view (a flow picked in the sidebar, a frame link in the chat). */
export function pluginFocus(conn: Conn, nodeId: string, ms = 8000): Promise<FollowResult | string> {
  return ask(conn, { t: 'focus', nodeId }, ms);
}

function ask(conn: Conn, msg: object, ms: number): Promise<FollowResult | string> {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      resolve('failed: the plugin did not answer');
    }, ms);
    conn.pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    try {
      conn.ws.send(JSON.stringify({ ...msg, id }));
    } catch (err) {
      conn.pending.get(id)?.(`failed: ${(err as Error).message}`);
      conn.pending.delete(id);
    }
  });
}

/** Tells the plugin to send the changes landing in its file (Claude edits it) or to stop. Sent only on a change. */
export function pluginEditing(conn: Conn, on: boolean) {
  if (conn.editing === on) return;
  conn.editing = on;
  console.log(`DEBUG figma plugin: editing ${on ? 'on' : 'off'} in "${conn.name}"`);
  try {
    conn.ws.send(JSON.stringify({ t: 'editing', on }));
  } catch {}
}

/** Following starts again: the plugin forgets the view it left, so her earlier move is not reported again. */
export function pluginForget(conn: Conn) {
  try {
    conn.ws.send(JSON.stringify({ t: 'forget' }));
  } catch {}
}
