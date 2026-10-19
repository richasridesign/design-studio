import { describe, expect, it } from 'vitest';
import { GAP, PAD, flowOrder, markTurn, restackPlan, sectionScript, turnsOn, type Box } from './iterations.js';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

describe('restackPlan', () => {
  const section: Box = { id: 's', x: 0, y: 0, w: 5000, h: 5000 };

  it('leaves a tidy section alone', () => {
    const kids: Box[] = [{ id: 'a', x: PAD, y: PAD, w: 2000, h: 1000 }, { id: 'b', x: PAD, y: PAD + 1000 + GAP, w: 2000, h: 1000 }];
    const r = restackPlan(kids, { id: 's', x: 0, y: 0, w: 2000 + 2 * PAD, h: 2000 + GAP + 2 * PAD });
    expect(r.changed).toBe(false);
    expect(r.moves).toEqual([]);
  });

  it('moves the later subsections down when one grew, and fits the section', () => {
    const kids: Box[] = [{ id: 'a', x: PAD, y: PAD, w: 2000, h: 3000 }, { id: 'b', x: PAD, y: PAD + 1000 + GAP, w: 2400, h: 1000 }];
    const r = restackPlan(kids, section);
    expect(r.moves).toEqual([{ id: 'b', x: PAD, y: PAD + 3000 + GAP }]);
    expect(r.fit).toEqual({ x: 0, y: 0, w: 2400 + 2 * PAD, h: 3000 + GAP + 1000 + 2 * PAD });
    expect(r.changed).toBe(true);
  });

  it('lifts the whole section when its bottom would come within 800px of the section below', () => {
    const kids: Box[] = [{ id: 'a', x: PAD, y: PAD, w: 2000, h: 3000 }];
    const below: Box = { id: 'old', x: 0, y: 3000, w: 5000, h: 5000 };
    const r = restackPlan(kids, { id: 's', x: 0, y: 0, w: 2640, h: 1640 }, below);
    // Fit is 3640 tall from y 0; it must end 800 above y 3000, so it moves up by 1440.
    expect(r.fit.y).toBe(-1440);
    expect(r.moves).toEqual([{ id: 'a', x: PAD, y: PAD - 1440 }]);
  });

  it('orders tagged flows by the project flow order, then by y', () => {
    const flows = [{ slug: 'a' }, { slug: 'b' }];
    const kids = [{ id: '3', y: 10, flow: null }, { id: '2', y: 5, flow: 'b' }, { id: '1', y: 50, flow: 'a' }, { id: '4', y: 0, flow: null }];
    expect(flowOrder(kids, flows).map((k) => k.id)).toEqual(['1', '2', '4', '3']);
  });
});

/** A fake page with sections, enough for the section script. */
function fakeFigma() {
  let n = 100;
  const nodes = new Map<string, any>();
  const make = (type: string, extra: Record<string, unknown> = {}) => {
    const node: any = {
      id: `${++n}:1`, type, name: '', x: 0, y: 0, width: 100, height: 100, children: [] as any[], parent: null as any, data: {} as Record<string, string>,
      setSharedPluginData(ns: string, k: string, v: string) { this.data[`${ns}/${k}`] = v; },
      appendChild(c: any) { if (c.parent) c.parent.children = c.parent.children.filter((x: any) => x !== c); c.parent = this; this.children.push(c); },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      clone() { const c = make(this.type, { name: this.name, width: this.width, height: this.height }); this.parent?.appendChild(c); return c; },
      ...extra,
    };
    nodes.set(node.id, node);
    return node;
  };
  const page = make('PAGE', { name: 'Flows', loadAsync: async () => {} });
  const latest = make('SECTION', { name: 'LATEST', x: 0, y: 0, width: 6000, height: 4000 });
  page.appendChild(latest);
  const entry = make('FRAME', { name: 'Home', width: 1440, height: 900 });
  latest.appendChild(entry);
  const figma = {
    currentPage: page,
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    setCurrentPageAsync: async () => {},
    loadFontAsync: async () => {},
    createSection: () => make('SECTION'),
    createText: () => make('TEXT', { characters: '', fontSize: 12 }),
  };
  return { figma, page, latest, entry, nodes };
}

describe('sectionScript', () => {
  it('makes the iteration section 800px above the topmost node, a tagged subsection per flow with entry copies, and never moves what exists', async () => {
    const f = fakeFigma();
    const code = sectionScript({ key: 'KEY', pageId: f.page.id, id: '1.19', section: null, name: 'V1.19 · Readiness · Tue 20 Oct 2026', flows: [{ slug: 'onboarding', n: 1, name: 'Onboarding', entry: [f.entry.id] }, { slug: 'connectors', n: 2, name: 'Connectors', entry: ['nope'] }], madeAt: 'T' });
    const out = await new AsyncFunction('figma', code)(f.figma);
    const section = f.nodes.get(out.node);
    expect(section.name).toBe('V1.19 · Readiness · Tue 20 Oct 2026');
    expect(section.data).toEqual({ 'designstudio/kind': 'iteration', 'designstudio/iteration': '1.19', 'designstudio/flow': '', 'designstudio/project': 'KEY', 'designstudio/madeAt': 'T' });
    expect(section.y + section.height).toBe(f.latest.y - GAP);
    expect(f.latest).toMatchObject({ x: 0, y: 0, width: 6000, height: 4000 });
    const sub = f.nodes.get(out.flows.onboarding.node);
    expect(sub.name).toBe('V1.19 · Flow 1 · Onboarding');
    expect(sub.data['designstudio/flow']).toBe('onboarding');
    expect(sub.parent).toBe(section);
    const copy = f.nodes.get(out.flows.onboarding.entries[0]);
    expect(copy.name).toBe('Home (Entry, unchanged)');
    expect(copy.parent).toBe(sub);
    expect(copy.data['designstudio/kind']).toBe('entry');
    expect(f.entry.parent).toBe(f.latest);
    const sub2 = f.nodes.get(out.flows.connectors.node);
    expect(sub2.y).toBe(sub.y + sub.height + GAP);
    expect(out.missing).toEqual(['nope']);
    expect(f.nodes.get(out.note).characters).toBe('V1.19 · Decisions\n• ');
  });

  it('adds a flow under the existing subsections of a section that is there already', async () => {
    const f = fakeFigma();
    const first = await new AsyncFunction('figma', sectionScript({ key: 'KEY', pageId: f.page.id, id: '1.19', section: null, name: 'V1.19', flows: [{ slug: 'a', n: 1, name: 'A', entry: [] }] }))(f.figma);
    const section = f.nodes.get(first.node);
    const before = { x: section.x, y: section.y };
    const second = await new AsyncFunction('figma', sectionScript({ key: 'KEY', pageId: null, id: '1.19', section: first.node, name: 'V1.19', flows: [{ slug: 'b', n: 2, name: 'B', entry: [] }] }))(f.figma);
    expect(second.node).toBe(first.node);
    expect(second.note).toBeNull();
    const a = f.nodes.get(first.flows.a.node), b = f.nodes.get(second.flows.b.node);
    expect(b.y).toBe(a.y + a.height + GAP);
    expect({ x: section.x, y: section.y }).toEqual(before);
    expect(section.height).toBe(b.y + b.height + PAD);
  });
});

describe('markTurn', () => {
  it('counts the chats mid-turn on a file', () => {
    markTurn('K', 'c1', true);
    markTurn('K', 'c2', true);
    expect(turnsOn('K')).toBe(2);
    markTurn('K', 'c1', false);
    markTurn('K', 'c1', false);
    expect(turnsOn('K')).toBe(1);
    markTurn('K', 'c2', false);
    expect(turnsOn('K')).toBe(0);
  });
});
