import { describe, expect, it } from 'vitest';
import { FOLLOW, pickFigmaTabs } from './chrome.js';

describe('pickFigmaTabs', () => {
  it('lists Figma file tabs newest first, one per file, without the Figma suffix', () => {
    const tabs = [
      { title: 'Cart – Figma', url: 'https://www.figma.com/design/AbC1234567xyz/Cart?node-id=1-2', at: 1 },
      { title: 'Cart – Figma', url: 'https://www.figma.com/design/AbC1234567xyz/Cart', at: 3 },
      { title: 'Inbox', url: 'https://mail.google.com/', at: 4 },
      { title: 'Board – FigJam', url: 'https://www.figma.com/board/ZzZ1234567xyz/Board', at: 5 },
      { title: 'Checkout - Figma', url: 'https://www.figma.com/file/QqQ1234567xyz/Checkout', at: 2 },
    ];
    expect(pickFigmaTabs(tabs)).toEqual([
      { title: 'Cart', url: 'https://www.figma.com/design/AbC1234567xyz/Cart' },
      { title: 'Checkout', url: 'https://www.figma.com/file/QqQ1234567xyz/Checkout' },
    ]);
  });
});

describe('FOLLOW', () => {
  const make = () => {
    const page = { type: 'PAGE', parent: null as unknown, id: '0:1' };
    const other = { type: 'PAGE', parent: null as unknown, id: '0:2' };
    const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
    const section = { id: '1:1', type: 'SECTION', parent: page, absoluteBoundingBox: box(0, 0, 4000, 3000) };
    const tag = { id: '1:2', type: 'INSTANCE', parent: section, absoluteBoundingBox: box(100, 100, 40, 20) };
    const far = { id: '2:1', type: 'FRAME', parent: other, absoluteBoundingBox: box(0, 0, 100, 100) };
    const nodes: Record<string, unknown> = { '1:1': section, '1:2': tag, '2:1': far };
    const calls: string[] = [];
    const figma = {
      currentPage: page,
      getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
      setCurrentPageAsync: async (p: { id: string }) => { calls.push(`page ${p.id}`); figma.currentPage = p as typeof page; },
      viewport: {
        bounds: box(5000, 5000, 100, 100),
        zoom: 4,
        scrollAndZoomIntoView: (ns: Array<{ id: string }>) => calls.push(`zoom ${ns.map((n) => n.id).join(',')}`),
      },
    };
    return { figma, calls };
  };
  const run = (ids: string[], figma: unknown) => new Function('figma', `return ${FOLLOW(ids)}`)(figma) as Promise<string>;

  it('zooms to the edited node, not the section around it, and caps zoom at 100%', async () => {
    const { figma, calls } = make();
    expect(await run(['1:1', '1:2'], figma)).toBe('ok');
    expect(calls).toEqual(['zoom 1:2']);
    expect(figma.viewport.zoom).toBe(1);
  });
  it('stays put when the edit is already in view', async () => {
    const { figma, calls } = make();
    figma.viewport.bounds = { x: 0, y: 0, width: 1000, height: 1000 };
    figma.viewport.zoom = 0.5;
    expect(await run(['1:2'], figma)).toBe('shown');
    expect(calls).toEqual([]);
  });
  it('switches to the page of the edit', async () => {
    const { figma, calls } = make();
    expect(await run(['2:1'], figma)).toBe('ok');
    expect(calls).toEqual(['page 0:2', 'zoom 2:1']);
  });
  it('says when nothing is found', async () => {
    const { figma } = make();
    expect(await run(['9:9'], figma)).toBe('nonode');
    expect(await run(['1:2'], undefined)).toBe('noapi');
  });
});
