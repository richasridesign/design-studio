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
  /** figma.com inside the Design Studio Mac window (figma-plugin/embed.ts), not the plugin in the Figma app. */
  embed: boolean;
  /** For the embed: its view is on screen (the Figma tab is shown in the Mac window). */
  shown: boolean;
  /** For the embed: the screen its last follow showed, for the Figma tab's "Claude is editing" line. */
  screen: string;
  /** The background reads this plugin build can run (figma-plugin/reads.ts); empty for builds from before them. */
  reads: string[];
  /** Reads waiting for their answer, by id. */
  reading: Map<number, Reading>;
  /** Figma did not start this plugin's last read (the file is not the front tab, or the view is held back): until then reads skip it. */
  readsOffUntil: number;
};

/** One read on its way: whether Figma started it, the value's slices so far, and how it ends. */
type Reading = { started: () => void; slices: string[]; got: number; done: (r: { value: unknown } | { error: string }) => void };

const conns = new Set<Conn>();
let nextId = 1;
const OPEN = 1;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const KEY = /^[A-Za-z0-9]{10,64}$/;
/** Every PING_MS the server pings the plugin; a socket that answered nothing by the next ping is dead and dropped. */
export const PING_MS = 10_000;

export function openFigmaPlugin(ws: PluginSocket, hooks: PluginHooks) {
  const conn: Conn = { ws, key: null, name: '', page: '', pageName: '', followKey: null, pending: new Map(), stalled: false, editing: false, embed: false, shown: false, screen: '', reads: [], reading: new Map(), readsOffUntil: 0 };
  // A plugin window that Figma froze or a Mac that slept leaves a socket open on this side with nobody behind it:
  // follows would wait on it. {t:'ping'} is answered by the plugin code itself (never by the browser on its own,
  // the way a protocol ping is), so only a plugin that can still run counts as alive.
  let alive = true;
  const timer = setInterval(() => {
    if (ws.readyState !== OPEN) return;
    // A long read holds the plugin's thread, so its pong can come late: a socket with a read under way is not dropped.
    // The read has its own time limit, and the next ping after it counts again.
    if (!alive && !conn.reading.size) {
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
      conn.embed = m.embed === true;
      conn.shown = conn.embed && m.shown === true;
      conn.reads = Array.isArray(m.reads) ? m.reads.filter((r: unknown) => typeof r === 'string').slice(0, 40) : [];
      conn.readsOffUntil = 0;
      conns.add(conn);
      console.log(`figma ${conn.embed ? 'in the Design Studio window' : 'plugin'}: running in "${conn.name}" (${conn.key ?? 'no file key, matched by name'}), page "${conn.pageName}"`);
      hooks.changed();
    } else if (m.t === 'page' && conns.has(conn)) {
      conn.readsOffUntil = 0;
      conn.page = str(m.pageId, 64);
      conn.pageName = str(m.pageName);
      hooks.page?.();
    } else if (m.t === 'shown' && conn.embed) {
      // Which connection is followed first changes with this, so who is told Claude edits is worked out again.
      const shown = m.on === true;
      if (shown !== conn.shown && conns.has(conn)) {
        conn.shown = shown;
        hooks.page?.();
      } else conn.shown = shown;
    } else if (m.t === 'screen' && conn.embed && conns.has(conn)) {
      const screen = str(m.name, 120);
      if (screen !== conn.screen) {
        conn.screen = screen;
        hooks.page?.();
      }
    } else if (m.t === 'result' && typeof m.id === 'number') {
      const done = conn.pending.get(m.id);
      conn.pending.delete(m.id);
      done?.(validResult(m.result) ?? 'failed: bad answer from the plugin');
    } else if (m.t === 'readResult' && typeof m.id === 'number') {
      const r = conn.reading.get(m.id);
      if (!r) return;
      if (typeof m.error === 'string') return r.done({ error: m.error.slice(0, 300) || 'failed' });
      if (m.started === true) return r.started();
      const parts = Number(m.parts);
      const part = Number(m.part);
      if (!Number.isInteger(parts) || parts < 1 || parts > 4000 || !Number.isInteger(part) || part < 0 || part >= parts || typeof m.data !== 'string') return r.done({ error: 'bad answer from the plugin' });
      if (r.slices.length !== parts) r.slices = new Array(parts);
      if (r.slices[part] === undefined) r.got++;
      r.slices[part] = m.data;
      if (r.got < parts) return;
      try {
        r.done({ value: JSON.parse(r.slices.join('')) });
      } catch {
        r.done({ error: 'bad answer from the plugin' });
      }
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
    [...conn.reading.values()].forEach((r) => r.done({ error: 'the plugin closed' }));
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
 * The newest connection wins, since she may have reopened the plugin. Figma in the Design Studio window comes first
 * while it is on screen, then the Figma app's plugin, then that window while it is hidden behind another tab.
 */
export function pluginFor(fileKey: string, name?: string): Conn | null {
  const rank = (c: Conn) => (c.embed ? (c.shown ? 0 : 2) : 1);
  const live = [...conns].filter((c) => c.ws.readyState === OPEN).reverse().sort((a, b) => rank(a) - rank(b));
  const byKey = live.find((c) => c.key === fileKey);
  if (byKey) return byKey;
  const byName = name && norm(name) ? live.find((c) => !c.key && norm(c.name) === norm(name)) : undefined;
  if (!byName) return null;
  byName.followKey = fileKey;
  return byName;
}

/** Every open connection in this file (by key or the name it was matched by), so the ones not followed can be told to stop. */
export const pluginsIn = (fileKey: string) => [...conns].filter((c) => c.ws.readyState === OPEN && (c.key ?? c.followKey) === fileKey);

export const pluginFiles = () => [...conns].map((c) => ({ key: c.key ?? c.followKey, name: c.name, page: c.pageName, stalled: c.stalled, embed: c.embed, screen: c.screen }));

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

/** After Figma did not start a plugin's read, its reads go to Claude for this long, or until it says hello or changes page. */
export const READS_OFF_MS = 60_000;

/**
 * The connections in this file that can run this read, best first: the Figma view in the Design Studio window (shown,
 * then hidden), which is Design Studio's own, then the Figma app's plugin, which shares her Figma app. Only by the
 * file's key: a plugin matched by name could be in another file of that name, and what a read gives is kept (the
 * map, history.md) or acted on (the restack). One that Figma does not answer is left out: its reads would wait.
 */
export function readersFor(fileKey: string, read: string): Conn[] {
  const rank = (c: Conn) => (c.embed ? (c.shown ? 0 : 1) : 2);
  const now = Date.now();
  return [...conns]
    .filter((c) => c.ws.readyState === OPEN && !c.stalled && c.readsOffUntil <= now && c.reads.includes(read) && c.key === fileKey)
    .reverse()
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * Runs one of the plugin's named reads (figma-plugin/reads.ts) with plain arguments and gives its value. Figma must
 * start it within `startMs` (a file that is not the front tab never does), and the whole read must end within `ms`.
 */
export function pluginReadCall(conn: Conn, read: string, args: object, opts: { startMs?: number; ms?: number; signal?: AbortSignal } = {}): Promise<{ value: unknown } | { error: string }> {
  const startMs = opts.startMs ?? 4000;
  const ms = opts.ms ?? 20_000;
  return new Promise((resolve) => {
    const id = nextId++;
    let timer = setTimeout(() => finish({ error: 'Figma did not start the read' }), startMs);
    const onAbort = () => finish({ error: 'stopped' });
    const finish = (r: { value: unknown } | { error: string }) => {
      if (conn.reading.get(id) !== reading) return;
      if ('error' in r && (r.error === 'stalled' || r.error === 'Figma did not start the read')) conn.readsOffUntil = Date.now() + READS_OFF_MS;
      clearTimeout(timer);
      conn.reading.delete(id);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const reading: Reading = {
      started: () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish({ error: `the read took over ${Math.round(ms / 1000)} s` }), ms);
      },
      slices: [],
      got: 0,
      done: finish,
    };
    conn.reading.set(id, reading);
    opts.signal?.addEventListener('abort', onAbort);
    try {
      conn.ws.send(JSON.stringify({ t: 'read', id, name: read, args }));
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  });
}
