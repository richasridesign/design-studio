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
  } else if (m.t === 'forget') watch.left(null);
  else if (m.t === 'small') {
    const s = m.on ? SMALL : SIZE;
    figma.ui.resize(s.w, s.h);
  }
};

// No viewport event exists, so her own moves are found by looking a few times a second.
setInterval(() => watch.check(), 400);
figma.on('currentpagechange', () => {
  watch.check();
  figma.ui.postMessage({ t: 'page', pageId: figma.currentPage.id, pageName: figma.currentPage.name });
});
