// What the Design Studio plugin does with Design Studio's messages, given the Figma Plugin API and a way to answer.
// Two hosts run it: the plugin in the Figma app (code.ts, answering through its window) and figma.com inside the
// Design Studio Mac window (embed.ts, answering through the app). The follow is the same function the Chrome tab
// runs (server/src/follow.ts), so all pick screens alike.
import { followIn, viewWatch, type FigmaLike, type FollowResult } from '../server/src/follow';
import { READS, READ_NAMES } from './reads';

/** Figma answers a plugin's node lookups only while the file is its front tab: a follow that waits longer than this says so. */
const STALL_MS = 6000;
/** Changes are gathered this long, so a burst goes as one message. */
const GATHER_MS = 200;
/** At most this many changed nodes go per message, the newest first. */
const MAX_IDS = 40;
/** A read first asks Figma for the shown page: no answer this soon means the file is not the front tab, so the server reads through Claude instead. */
const PROBE_MS = 2000;
/** A read's value goes back in slices of this many characters, so no one message is huge. */
const SLICE = 256_000;

/** What a host may show around Claude's edits (embed.ts draws a cursor and flashes). */
export type AgentHooks = {
  /** A follow ran: `start` when the edit is starting, the ids it named, and what the follow did. */
  followed?: (ids: string[], start: boolean, result: FollowResult) => void;
  /** Nodes changed in the file while Claude edits it. */
  changed?: (ids: string[]) => void;
  /** Claude started or finished editing this file. */
  editing?: (on: boolean) => void;
};

export function agent(figma: any, post: (m: object) => void, fileKey: () => string | null, extra: object = {}, hooks: AgentHooks = {}) {
  const api = figma as FigmaLike;
  const within = <T>(p: Promise<T>, ms: number) => new Promise<T | 'stalled'>((r) => { const t = setTimeout(() => r('stalled'), ms); p.then((v) => { clearTimeout(t); r(v); }, () => { clearTimeout(t); r('stalled'); }); });
  const watch = viewWatch(api, () => post({ t: 'moved' }));
  const hello = () => post({ t: 'hello', fileKey: fileKey(), fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name, reads: READ_NAMES, ...extra });

  // While Claude edits this file (Design Studio says so), the changes landing here go to Design Studio as they come, so
  // the view follows a long script while it builds, not once at its end. Design Studio picks and paces the moves. Off
  // means nothing is sent, so her own edits never move her view. Only the shown page is watched: documentchange would
  // need every page loaded, which is slow in a big file.
  let editing = false;
  let changes: string[] = [];
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  const onNodeChange = (e: any) => {
    if (!editing) return;
    for (const c of e?.nodeChanges ?? []) if (c && c.type !== 'DELETE' && typeof c.id === 'string') changes.push(c.id);
    if (changes.length > 400) changes = changes.slice(-MAX_IDS);
    if (!sendTimer && changes.length) sendTimer = setTimeout(sendChanges, GATHER_MS);
  };
  function sendChanges() {
    sendTimer = null;
    const ids = editing ? [...new Set(changes.reverse())].slice(0, MAX_IDS) : [];
    changes = [];
    if (ids.length) {
      post({ t: 'changed', ids });
      hooks.changed?.(ids);
    }
  }
  let listened: any = null;
  function listen() {
    if (listened === figma.currentPage) return;
    unlisten();
    try {
      figma.currentPage.on('nodechange', onNodeChange);
      listened = figma.currentPage;
    } catch {}
  }
  function unlisten() {
    try { listened?.off('nodechange', onNodeChange); } catch {}
    listened = null;
  }

  async function onmessage(m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ready') hello();
    // Design Studio's heartbeat: answered here, not by the window, so a stalled plugin thread shows as no plugin.
    else if (m.t === 'ping') post({ t: 'pong' });
    else if (m.t === 'follow' && typeof m.id === 'number' && Array.isArray(m.ids)) {
      let result: FollowResult | null = null;
      try {
        const ids = m.ids.filter((id: unknown) => typeof id === 'string').slice(0, 200);
        const r = await watch.run(() => within(followIn(api, ids, m.last ?? null, m.start === true), STALL_MS));
        result = r === 'stalled' ? { status: 'stalled' } : r;
        if (result.view) watch.left(result.view);
        else if (result.status === 'moved') watch.left(null);
        hooks.followed?.(ids, m.start === true, result);
      } catch {
        result = null;
      }
      post({ t: 'result', id: m.id, result });
    } else if (m.t === 'focus' && typeof m.id === 'number' && typeof m.nodeId === 'string') {
      // A flow picked in Design Studio's sidebar or a frame link in the chat: go to it. This is not her move, so the
      // watch forgets its view and following does not pause.
      let status: FollowResult['status'] = 'nonode';
      try {
        status = await watch.run(async () => {
          const n = await figma.getNodeByIdAsync(m.nodeId);
          if (!n || n.type === 'DOCUMENT') return 'nonode';
          let p = n;
          while (p && p.type !== 'PAGE') p = p.parent;
          if (p && figma.currentPage !== p) await figma.setCurrentPageAsync(p);
          if (n.type !== 'PAGE') figma.viewport.scrollAndZoomIntoView([n]);
          return 'ok';
        });
      } catch {
        status = 'nonode';
      }
      watch.left(null);
      post({ t: 'result', id: m.id, result: { status } });
    } else if (m.t === 'read' && typeof m.id === 'number' && typeof m.name === 'string') {
      await read(m.id, m.name, m.args);
    } else if (m.t === 'editing') {
      editing = m.on === true;
      if (editing) listen();
      else unlisten();
      hooks.editing?.(editing);
    } else if (m.t === 'forget') watch.left(null);
  }

  // One of Design Studio's background reads (reads.ts), asked for by name with plain arguments. It says it started
  // once Figma answers, then sends the value as JSON in slices, or an error.
  async function read(id: number, name: string, args: unknown) {
    const fn = Object.prototype.hasOwnProperty.call(READS, name) ? READS[name] : null;
    if (!fn) return post({ t: 'readResult', id, error: `no read named ${String(name).slice(0, 40)}` });
    const answered = await within(figma.getNodeByIdAsync(figma.currentPage.id).then(() => true), PROBE_MS);
    if (answered !== true) return post({ t: 'readResult', id, error: 'stalled' });
    post({ t: 'readResult', id, started: true });
    let text: string;
    try {
      const value = await fn(figma, args && typeof args === 'object' ? args : {});
      text = JSON.stringify(value === undefined ? null : value);
    } catch (err) {
      return post({ t: 'readResult', id, error: String((err as Error)?.message ?? err).slice(0, 300) });
    }
    const parts = Math.max(1, Math.ceil(text.length / SLICE));
    for (let part = 0; part < parts; part++) post({ t: 'readResult', id, part, parts, data: text.slice(part * SLICE, (part + 1) * SLICE) });
  }

  // No viewport event exists, so her own moves are found by looking a few times a second.
  setInterval(() => watch.check(), 400);
  try {
    figma.on('currentpagechange', () => {
      watch.check();
      if (editing) listen();
      post({ t: 'page', pageId: figma.currentPage.id, pageName: figma.currentPage.name });
    });
  } catch {}
  return { onmessage, hello };
}
