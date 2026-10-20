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
const watch = viewWatch(api, () => figma.ui.postMessage({ t: 'moved' }));

const hello = () => figma.ui.postMessage({
  t: 'hello',
  // Figma gives the file's key only to private plugins; Design Studio then finds the file by its name.
  fileKey: typeof figma.fileKey === 'string' ? figma.fileKey : null,
  fileName: figma.root.name,
  pageId: figma.currentPage.id,
});

figma.ui.onmessage = async (m: any) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ready') hello();
  else if (m.t === 'follow' && typeof m.id === 'number' && Array.isArray(m.ids)) {
    let result: FollowResult | null = null;
    try {
      const ids = m.ids.filter((id: unknown) => typeof id === 'string').slice(0, 200);
      result = await watch.run(() => followIn(api, ids, m.last ?? null, m.start === true));
      if (result.view) watch.left(result.view);
      else if (result.status === 'moved') watch.left(null);
    } catch {
      result = null;
    }
    figma.ui.postMessage({ t: 'result', id: m.id, result });
  } else if (m.t === 'forget') watch.left(null);
  else if (m.t === 'small') {
    const s = m.on ? SMALL : SIZE;
    figma.ui.resize(s.w, s.h);
  }
};

// No viewport event exists, so her own moves are found by looking a few times a second.
setInterval(() => watch.check(), 400);
figma.on('currentpagechange', () => watch.check());
