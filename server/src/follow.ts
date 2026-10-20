/** Where a follow left her Figma view: the page, the screens it fitted and the center and zoom Figma reported back. */
export type FollowView = { page: string; targets: string; cx: number; cy: number; zoom: number };
export type FollowResult = { status: 'ok' | 'shown' | 'moved' | 'nonode' | 'noapi'; view?: FollowView };

// The few parts of the Figma Plugin API the follow uses. The same functions run in a Chrome tab (sent over CDP as
// source) and inside the Design Studio plugin in the Figma app (bundled), so they must not use anything outside
// their own body: no imports, no helpers from this module except offView, which travels with them.
type Box = { x: number; y: number; width: number; height: number };
type FNode = { id: string; type: string; parent: FNode | null; removed?: boolean; absoluteBoundingBox: Box | null };
export type FigmaLike = {
  getNodeByIdAsync: (id: string) => Promise<unknown>;
  setCurrentPageAsync: (page: any) => Promise<void>;
  currentPage: { id: string; selection: readonly unknown[] };
  viewport: { center: { x: number; y: number }; zoom: number; bounds: Box };
};

/** True when her view is no longer the one a follow left: another page, another zoom or a pan of over 1.5 pixels. */
export function offView(figma: FigmaLike, last: FollowView) {
  const vp = figma.viewport;
  const z = vp.zoom;
  return figma.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 0.005
    || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
}

/**
 * Walks her Figma view through Claude's edits, the way a designer shows a file. Each edited node is shown by its
 * screen: the frame on the page or directly inside a section, fitted with a small margin and never past 200%. Two or
 * three screens on one page fit together, more fit the first. A section fits only when no screen is named, since a
 * script names its section just to find the frame it edits. The edited nodes are then selected, the deepest ones
 * only. Nothing in the document changes.
 *
 * `last` is the view the previous follow left. When the view no longer shows it, she moved it herself, so this does
 * nothing and says `moved`. When the same screens are already fitted it only updates the selection.
 * `screensOnly`: skip when only sections are named (an edit starting that will create its frame).
 */
export async function followIn(figma: FigmaLike, ids: string[], last: FollowView | null, screensOnly: boolean): Promise<FollowResult> {
  if (typeof figma === 'undefined' || !figma || !figma.getNodeByIdAsync) return { status: 'noapi' };
  const vp = figma.viewport;
  const read = (targets: string): FollowView => ({ page: figma.currentPage.id, targets, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
  if (last && offView(figma, last)) return { status: 'moved' };
  const all0 = await Promise.all(ids.map((id) => figma.getNodeByIdAsync(id).catch(() => null))) as Array<FNode | null>;
  const found = all0.filter((n): n is FNode => !!n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT' && !!n.absoluteBoundingBox);
  if (!found.length) return { status: 'nonode' };
  const pageOf = (n: FNode) => { let p: FNode | null = n; while (p && p.type !== 'PAGE') p = p.parent; return p; };
  const page = pageOf(found[0]);
  if (!page) return { status: 'nonode' };
  const onPage = found.filter((n) => pageOf(n) === page);
  const screenOf = (n: FNode) => { let p = n; while (p.parent && p.parent.type !== 'PAGE' && p.parent.type !== 'SECTION') p = p.parent; return p; };
  const all: FNode[] = [];
  for (const n of onPage) { const s = screenOf(n); if (all.indexOf(s) < 0) all.push(s); }
  const screens = all.filter((s) => s.type !== 'SECTION');
  // When an edit starts, a script that names only its section is about to add a frame: the view waits for its id.
  if (!screens.length && screensOnly) return { status: 'nonode' };
  const picked = screens.length ? screens : all;
  const targets = picked.length > 3 ? picked.slice(0, 1) : picked;
  const key = targets.map((t) => t.id).join(',');
  const within = (a: FNode, b: FNode) => { for (let p = a.parent; p; p = p.parent) if (p === b) return true; return false; };
  const deepest = onPage.filter((n) => !onPage.some((m) => m !== n && within(m, n))).slice(0, 20);
  const select = () => { try { figma.currentPage.selection = deepest; } catch (e) { /* locked or gone */ } };
  if (last && last.page === page.id && last.targets === key) { select(); return { status: 'shown', view: read(key) }; }
  // The view's size in screen pixels stays the same across pages, so it is read before switching.
  const w = vp.bounds.width * vp.zoom;
  const h = vp.bounds.height * vp.zoom;
  if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);
  const boxes = targets.map((t) => t.absoluteBoundingBox as Box);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const fit = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0));
  vp.zoom = Math.max(0.02, Math.min(2, fit * 0.84));
  vp.center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  select();
  return { status: 'ok', view: read(key) };
}

/**
 * The follow as a script for a Figma tab in Chrome (Runtime.evaluate). The functions travel as their own source; the
 * server runs under tsx, which wraps inner functions in `__name(...)`, so the script defines it.
 */
export const FOLLOW = (ids: string[], last: FollowView | null, screensOnly = false) => `(async () => {
  const __name = (f) => f;
  const offView = ${offView.toString()};
  return (${followIn.toString()})(typeof figma === 'undefined' ? undefined : figma, ${JSON.stringify(ids)}, ${JSON.stringify(last)}, ${screensOnly});
})()`;

/**
 * The plugin's watch on her view. There is no viewport event in the Plugin API, so the plugin polls `check`. After a
 * move the plugin made itself (`left`), any other change is hers and is reported once; then it waits for the next
 * move. Moves run inside `run`, so a poll in the middle of one never reads it as hers.
 */
export function viewWatch(figma: FigmaLike, onMoved: () => void) {
  let left: FollowView | null = null;
  let busy = 0;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      busy++;
      try { return await fn(); } finally { busy--; }
    },
    left(view: FollowView | null) { left = view; },
    get view() { return left; },
    check() {
      if (busy || !left || !offView(figma, left)) return false;
      left = null;
      onMoved();
      return true;
    },
  };
}
