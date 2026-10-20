import { describe, expect, it } from 'vitest';
import { FOLLOW, followIn, viewWatch, type FollowResult, type FollowView } from './follow.js';

type N = { id: string; type: string; parent: N | null; absoluteBoundingBox?: { x: number; y: number; width: number; height: number }; removed?: boolean };

// A small file: a page with a section holding two screens, a loose screen, and a second page. The view's center
// setter rounds the way Figma does, so the follow has to remember what Figma reports back.
function fakeFigma() {
  const nodes = new Map<string, N>();
  const add = (id: string, type: string, parent: N | null, box?: [number, number, number, number]) => {
    const n: N = { id, type, parent, absoluteBoundingBox: box && { x: box[0], y: box[1], width: box[2], height: box[3] } };
    nodes.set(id, n);
    return n;
  };
  const p1 = add('0:1', 'PAGE', null);
  const p2 = add('0:2', 'PAGE', null);
  const sec = add('1:1', 'SECTION', p1, [0, 0, 6000, 2000]);
  const s1 = add('2:1', 'FRAME', sec, [100, 100, 1440, 900]);
  const s2 = add('2:2', 'FRAME', sec, [1700, 100, 1440, 900]);
  add('2:3', 'FRAME', sec, [3300, 100, 1440, 900]);
  add('2:4', 'FRAME', sec, [4900, 100, 1000, 900]);
  const card = add('3:1', 'FRAME', s1, [200, 200, 400, 200]);
  add('3:2', 'TEXT', card, [210, 210, 100, 20]);
  add('3:3', 'TEXT', s2, [1800, 200, 100, 20]);
  add('4:1', 'FRAME', p1, [0, 4000, 1440, 900]);
  add('5:1', 'FRAME', p2, [0, 0, 800, 600]);
  add('6:1', 'FRAME', p1, [0, 6000, 1200, 3000]);
  const gone = add('3:9', 'TEXT', s1, [0, 0, 1, 1]);
  gone.removed = true;
  // She starts zoomed out over the whole page.
  let center = { x: 0, y: 0 };
  let zoom = 0.1;
  const calls = { center: 0, zoom: 0, page: 0 };
  const figma: any = {
    currentPage: { id: '0:1', selection: [] as N[] },
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    setCurrentPageAsync: async (p: N) => { calls.page++; figma.currentPage = { id: p.id, selection: [] }; },
    viewport: {
      get center() { return center; },
      set center(c: { x: number; y: number }) { calls.center++; center = { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 }; },
      get zoom() { return zoom; },
      set zoom(z: number) { calls.zoom++; zoom = Math.round(z * 10000) / 10000; },
      // A 1600 by 1000 pixel canvas.
      get bounds() { return { x: center.x - 800 / zoom, y: center.y - 500 / zoom, width: 1600 / zoom, height: 1000 / zoom }; },
    },
  };
  // Her own move, as Figma would see it.
  const pan = (dx: number) => { center = { x: center.x + dx, y: center.y }; };
  return { figma, calls, pan };
}

const run = (figma: unknown, ids: string[], last: FollowView | null = null, start = false): Promise<FollowResult> =>
  new Function('figma', `return ${FOLLOW(ids, last, start)}`)(figma);
const selected = (figma: any) => figma.currentPage.selection.map((n: N) => n.id);

describe('FOLLOW', () => {
  it('zooms to the deep edit at a readable size, never past 200%, and selects it', async () => {
    const { figma } = fakeFigma();
    const r = await run(figma, ['1:1', '3:2']);
    expect(r.status).toBe('ok');
    expect(r.view?.targets).toBe('2:1');
    expect(figma.viewport.center).toEqual({ x: 260, y: 220 });
    expect(figma.viewport.zoom).toBe(2);
    expect(selected(figma)).toEqual(['3:2']);
  });

  it('fits a whole new screen that reads at that size, and shows the top of one too tall to read whole', async () => {
    const screen = fakeFigma();
    await run(screen.figma, ['2:1']);
    // 1440 x 900 in 1600 x 1000 pixels fits at 1.111, less the margin.
    expect(screen.figma.viewport.zoom).toBeCloseTo((1000 / 900) * 0.84, 3);
    expect(screen.figma.viewport.center).toEqual({ x: 820, y: 550 });
    // 1200 x 3000 would fit only at 28%: it shows at 100%, centred, from its top with a small margin.
    const tall = fakeFigma();
    await run(tall.figma, ['6:1']);
    expect(tall.figma.viewport.zoom).toBe(1);
    expect(tall.figma.viewport.center).toEqual({ x: 600, y: 6000 - 80 + 500 });
    // A whole section is never shown below 50%: its top left part shows instead.
    const sec = fakeFigma();
    expect((await run(sec.figma, ['1:1'])).view?.targets).toBe('1:1');
    expect(sec.figma.viewport.zoom).toBe(0.5);
    expect(sec.figma.viewport.center).toEqual({ x: -160 + 1600, y: -160 + 1000 });
  });

  it('shows two or three screens together, and only the first of more', async () => {
    const two = fakeFigma();
    expect((await run(two.figma, ['3:2', '3:3'])).view?.targets).toBe('2:1,2:2');
    expect(selected(two.figma)).toEqual(['3:2', '3:3']);
    const four = fakeFigma();
    expect((await run(four.figma, ['2:1', '2:2', '2:3', '2:4'])).view?.targets).toBe('2:1');
    // A section counts only when no screen is named, and not at all when an edit starts.
    expect((await run(fakeFigma().figma, ['1:1'], null, true)).status).toBe('nonode');
  });

  it('switches to the page of the edit and skips nodes that are gone', async () => {
    const { figma, calls } = fakeFigma();
    const r = await run(figma, ['9:9', '3:9', '5:1']);
    expect(r.status).toBe('ok');
    expect(calls.page).toBe(1);
    expect(figma.currentPage.id).toBe('0:2');
    expect(selected(figma)).toEqual(['5:1']);
    expect((await run(fakeFigma().figma, ['9:9', '0:1'])).status).toBe('nonode');
  });

  it('keeps the view when the change is already in view at a readable zoom, but selects it', async () => {
    const { figma, calls } = fakeFigma();
    const first = await run(figma, ['3:2']);
    const moves = calls.center + calls.zoom;
    const again = await run(figma, ['2:1', '3:1'], first.view!);
    expect(again.status).toBe('shown');
    expect(calls.center + calls.zoom).toBe(moves);
    expect(selected(figma)).toEqual(['3:1']);
    expect((await run(figma, ['3:3'], again.view!)).status).toBe('ok');
  });

  it('stops when she moved the view herself, and changes nothing', async () => {
    const { figma, calls, pan } = fakeFigma();
    const first = await run(figma, ['3:2']);
    pan(40);
    const moves = calls.center + calls.zoom;
    figma.currentPage.selection = [];
    expect((await run(figma, ['3:3'], first.view!)).status).toBe('moved');
    expect(calls.center + calls.zoom).toBe(moves);
    expect(selected(figma)).toEqual([]);
  });
});

describe('viewWatch', () => {
  it('reports her own move once, and never the plugin\'s own', async () => {
    const { figma, pan } = fakeFigma();
    const moved: number[] = [];
    const watch = viewWatch(figma, () => moved.push(1));
    expect(watch.check()).toBe(false);
    // While the plugin moves the view, a poll in the middle is not her move.
    const r = await watch.run(async () => {
      const p = followIn(figma, ['3:2'], null, false);
      watch.left({ page: '0:1', targets: 'old', cx: 0, cy: 0, zoom: 1 });
      expect(watch.check()).toBe(false);
      return p;
    });
    watch.left(r.view!);
    expect(watch.check()).toBe(false);
    pan(40);
    expect(watch.check()).toBe(true);
    expect(watch.check()).toBe(false);
    expect(moved).toHaveLength(1);
    figma.currentPage = { id: '0:2', selection: [] };
    expect(watch.check()).toBe(false);
  });
});
