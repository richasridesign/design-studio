// The Design Studio plugin's main code, in Figma's plugin sandbox. Its window (ui.html) holds the socket to Design
// Studio on this Mac and passes messages through. Build with `npm run plugin` (bundles into code.js).
// The follow itself is the same function the Chrome tab runs (server/src/follow.ts), so both pick screens alike.
import { followIn, viewWatch, type FigmaLike, type FollowResult } from '../server/src/follow';

declare const figma: any;
declare const __html__: string;

const SIZE = { w: 280, h: 148 };
const SMALL = { w: 280, h: 48 };
figma.showUI(__html__, { width: SIZE.w, height: SIZE.h, title: 'Design Studio', themeColors: true });

const api = figma as FigmaLike;
/** Figma answers a plugin's node lookups only while the file is its front tab: a follow that waits longer than this says so. */
const STALL_MS = 6000;
const within = <T>(p: Promise<T>, ms: number) => new Promise<T | 'stalled'>((r) => { const t = setTimeout(() => r('stalled'), ms); p.then((v) => { clearTimeout(t); r(v); }, () => { clearTimeout(t); r('stalled'); }); });
const watch = viewWatch(api, () => figma.ui.postMessage({ t: 'moved' }));

// Figma gives the file's key only to private plugins, and may throw instead of answering; Design Studio then finds
// the file by its name.
const fileKey = () => { try { return typeof figma.fileKey === 'string' ? figma.fileKey : null; } catch { return null; } };
const hello = () => figma.ui.postMessage({ t: 'hello', fileKey: fileKey(), fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name });

figma.ui.onmessage = async (m: any) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ready') hello();
  // Design Studio's heartbeat: answered here, not in the window, so a stalled plugin thread shows as no plugin.
  else if (m.t === 'ping') figma.ui.postMessage({ t: 'pong' });
  else if (m.t === 'follow' && typeof m.id === 'number' && Array.isArray(m.ids)) {
    let result: FollowResult | null = null;
    try {
      const ids = m.ids.filter((id: unknown) => typeof id === 'string').slice(0, 200);
      const r = await watch.run(() => within(followIn(api, ids, m.last ?? null, m.start === true), STALL_MS));
      result = r === 'stalled' ? { status: 'stalled' } : r;
      if (result.view) watch.left(result.view);
      else if (result.status === 'moved') watch.left(null);
    } catch {
      result = null;
    }
    figma.ui.postMessage({ t: 'result', id: m.id, result });
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
    figma.ui.postMessage({ t: 'result', id: m.id, result: { status } });
  } else if (m.t === 'editing') {
    editing = m.on === true;
    if (editing) listen();
    else unlisten();
  } else if (m.t === 'forget') watch.left(null);
  else if (m.t === 'small') {
    const s = m.on ? SMALL : SIZE;
    figma.ui.resize(s.w, s.h);
  }
};

// While Claude edits this file (Design Studio says so), the changes landing here go to Design Studio as they come, so
// the view follows a long script while it builds, not once at its end. Design Studio picks and paces the moves. Off
// means nothing is sent, so her own edits never move her view. Only the shown page is watched: documentchange would
// need every page loaded, which is slow in a big file.
let editing = false;
let changes: string[] = [];
let sendTimer: ReturnType<typeof setTimeout> | null = null;
/** Changes are gathered this long, so a burst goes as one message. */
const GATHER_MS = 200;
/** At most this many changed nodes go per message, the newest first. */
const MAX_IDS = 40;
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
  if (ids.length) figma.ui.postMessage({ t: 'changed', ids });
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

// No viewport event exists, so her own moves are found by looking a few times a second.
setInterval(() => watch.check(), 400);
figma.on('currentpagechange', () => {
  watch.check();
  if (editing) listen();
  figma.ui.postMessage({ t: 'page', pageId: figma.currentPage.id, pageName: figma.currentPage.name });
});
