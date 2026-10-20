/** Where a follow left her Figma view: the page, the screens it fitted and the center and zoom Figma reported back. */
export type FollowView = { page: string; targets: string; cx: number; cy: number; zoom: number };
export type FollowResult = { status: 'ok' | 'shown' | 'moved' | 'nonode' | 'noapi'; view?: FollowView };

/**
 * The script that walks her Figma tab through Claude's edits, the way a designer shows a file. Each edited node is
 * shown by its screen: the frame on the page or directly inside a section, fitted with a small margin and never past
 * 200%. Two or three screens on one page fit together, more fit the first. A section fits only when no screen is
 * named, since a script names its section just to find the frame it edits. The edited nodes are then selected, the
 * deepest ones only. Nothing in the document changes.
 *
 * `last` is the view the previous follow left. When the tab no longer shows it, she moved the view herself, so the
 * script does nothing and says `moved`. When the same screens are already fitted it only updates the selection.
 * `screensOnly`: skip when only sections are named (an edit starting that will create its frame).
 */
export const FOLLOW = (ids: string[], last: FollowView | null, screensOnly = false) => `(async () => {
  if (typeof figma === 'undefined' || !figma.getNodeByIdAsync) return { status: 'noapi' };
  const last = ${JSON.stringify(last)};
  const vp = figma.viewport;
  const read = (targets) => ({ page: figma.currentPage.id, targets, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
  if (last) {
    const z = vp.zoom;
    const off = figma.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 0.005
      || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
    if (off) return { status: 'moved' };
  }
  const found = (await Promise.all(${JSON.stringify(ids)}.map((id) => figma.getNodeByIdAsync(id).catch(() => null))))
    .filter((n) => n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT' && n.absoluteBoundingBox);
  if (!found.length) return { status: 'nonode' };
  const pageOf = (n) => { let p = n; while (p && p.type !== 'PAGE') p = p.parent; return p; };
  const page = pageOf(found[0]);
  if (!page) return { status: 'nonode' };
  const onPage = found.filter((n) => pageOf(n) === page);
  const screenOf = (n) => { let p = n; while (p.parent && p.parent.type !== 'PAGE' && p.parent.type !== 'SECTION') p = p.parent; return p; };
  const all = [];
  for (const n of onPage) { const s = screenOf(n); if (!all.includes(s)) all.push(s); }
  const screens = all.filter((s) => s.type !== 'SECTION');
  // When an edit starts, a script that names only its section is about to add a frame: the view waits for its id.
  if (!screens.length && ${screensOnly}) return { status: 'nonode' };
  const picked = screens.length ? screens : all;
  const targets = picked.length > 3 ? picked.slice(0, 1) : picked;
  const key = targets.map((t) => t.id).join(',');
  const within = (a, b) => { for (let p = a.parent; p; p = p.parent) if (p === b) return true; return false; };
  const deepest = onPage.filter((n) => !onPage.some((m) => m !== n && within(m, n))).slice(0, 20);
  const select = () => { try { figma.currentPage.selection = deepest; } catch (e) {} };
  if (last && last.page === page.id && last.targets === key) { select(); return { status: 'shown', view: read(key) }; }
  // The view's size in screen pixels stays the same across pages, so it is read before switching.
  const w = vp.bounds.width * vp.zoom;
  const h = vp.bounds.height * vp.zoom;
  if (figma.currentPage !== page) await figma.setCurrentPageAsync(page);
  const boxes = targets.map((t) => t.absoluteBoundingBox);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const fit = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0));
  vp.zoom = Math.max(0.02, Math.min(2, fit * 0.84));
  vp.center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  select();
  return { status: 'ok', view: read(key) };
})()`;
