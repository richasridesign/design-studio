import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

// Both roots point at temp folders before settings.js loads, so nothing outside them is listed or written.
const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { APPLY_SCRIPT, GAP, PAD, READ_SCRIPT, addFlowToIteration, createIterationInFigma, flowOrder, freezeIteration, makeSectionsFor, markTurn, reopenIteration, restackPlan, sectionScript, turnsOn } = await import('./iterations.js');
const { readProject, writeProject } = await import('./project.js');
type Box = import('./iterations.js').Box;

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

/**
 * A fake page with sections. As in Figma (checked live on the scratch file), a child's x and y are relative to its
 * section, absoluteBoundingBox adds the parents, and a clone lands on the page with its reactions.
 */
function fakeFigma() {
  let n = 100;
  const nodes = new Map<string, any>();
  const make = (type: string, extra: Record<string, unknown> = {}) => {
    const node: any = {
      id: `${++n}:1`, type, name: '', x: 0, y: 0, width: 100, height: 100, children: [] as any[], parent: null as any, data: {} as Record<string, string>, reactions: [] as any[],
      get absoluteBoundingBox() {
        const p = this.parent && this.parent.type !== 'PAGE' ? this.parent.absoluteBoundingBox : { x: 0, y: 0 };
        return { x: p.x + this.x, y: p.y + this.y, width: this.width, height: this.height };
      },
      setSharedPluginData(ns: string, k: string, v: string) { this.data[`${ns}/${k}`] = v; },
      getSharedPluginData(ns: string, k: string) { return this.data[`${ns}/${k}`] ?? ''; },
      async setReactionsAsync(r: any[]) { this.reactions = r; },
      appendChild(c: any) { if (c.parent) c.parent.children = c.parent.children.filter((x: any) => x !== c); c.parent = this; this.children.push(c); },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      findAll(fn: (n: any) => boolean) { const out: any[] = []; const walk = (x: any) => { for (const c of x.children) { if (fn(c)) out.push(c); walk(c); } }; walk(this); return out; },
      clone() {
        const copy = (src: any): any => {
          const c = make(src.type, { name: src.name, x: src.x, y: src.y, width: src.width, height: src.height, reactions: src.reactions, data: { ...src.data } });
          for (const k of src.children) c.appendChild(copy(k));
          return c;
        };
        const c = copy(this);
        let page = this.parent;
        while (page && page.type !== 'PAGE') page = page.parent;
        page?.appendChild(c);
        return c;
      },
      ...extra,
    };
    nodes.set(node.id, node);
    return node;
  };
  const page = make('PAGE', { name: 'Flows', loadAsync: async () => {} });
  const latest = make('SECTION', { name: 'LATEST', x: 0, y: 0, width: 6000, height: 4000 });
  page.appendChild(latest);
  const entry = make('FRAME', { name: 'Home', x: 320, y: 320, width: 1440, height: 900 });
  latest.appendChild(entry);
  const figma = {
    currentPage: page,
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    setCurrentPageAsync: async () => {},
    loadFontAsync: async () => {},
    createSection: () => make('SECTION'),
    createText: () => make('TEXT', { characters: '', fontSize: 12 }),
  };
  return { figma, page, latest, entry, nodes, make };
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
    expect(f.latest.children).toEqual([f.entry]);
    expect(f.page.children.filter((c: any) => c.type !== 'SECTION')).toEqual([]);
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

describe('entry copies', () => {
  it('points links between two entry screens of the flow at the copies, and leaves other links alone', async () => {
    const f = fakeFigma();
    const second = f.make('FRAME', { name: 'Detail', x: 2000, y: 320, width: 1440, height: 900 });
    f.latest.appendChild(second);
    const go = (to: string) => ({ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: to, navigation: 'NAVIGATE' }] });
    f.entry.reactions = [go(second.id)];
    const button = f.make('INSTANCE', { name: 'Button' });
    f.entry.appendChild(button);
    button.reactions = [go(second.id), go('77:7')];
    const out = await new AsyncFunction('figma', sectionScript({ key: 'KEY', pageId: f.page.id, id: '1.19', section: null, name: 'V1.19', flows: [{ slug: 'a', n: 1, name: 'A', entry: [f.entry.id, second.id] }] }))(f.figma);
    const [homeCopy, detailCopy] = out.flows.a.entries.map((id: string) => f.nodes.get(id));
    expect(homeCopy.reactions[0].actions[0].destinationId).toBe(detailCopy.id);
    const buttonCopy = homeCopy.children[0];
    expect(buttonCopy.reactions.map((r: any) => r.actions[0].destinationId)).toEqual([detailCopy.id, '77:7']);
    expect(f.entry.reactions[0].actions[0].destinationId).toBe(second.id);
    expect(out.flows.a.rewired).toEqual([homeCopy.id, buttonCopy.id]);
  });
});

describe('restack scripts', () => {
  it('reads the layout, plans and applies it with children relative to the section, so a subsection that does not move stays put', async () => {
    const f = fakeFigma();
    // The iteration section above LATEST; its subsections start 500px in, so the fit moves the section's left edge.
    const it = f.make('SECTION', { name: 'V1.19', x: 0, y: -9000, width: 5000, height: 6000 });
    f.page.appendChild(it);
    const a = f.make('SECTION', { name: 'A', x: 500, y: 320, width: 2000, height: 3000 });
    const b = f.make('SECTION', { name: 'B', x: 500, y: 320 + 1000 + GAP, width: 2000, height: 1000 });
    it.appendChild(a);
    it.appendChild(b);
    a.data['designstudio/flow'] = 'a';
    b.data['designstudio/flow'] = 'b';
    const before = { a: a.absoluteBoundingBox };
    const read = await new AsyncFunction('figma', READ_SCRIPT(it.id))(f.figma);
    expect(read.below.id).toBe(f.latest.id);
    expect(read.above).toBeNull();
    const plan = restackPlan(flowOrder(read.kids, [{ slug: 'a' }, { slug: 'b' }]), read.section, read.below, read.above);
    expect(plan.fit.x).not.toBe(read.section.x);
    await new AsyncFunction('figma', APPLY_SCRIPT(it.id, plan))(f.figma);
    const lift = plan.moves.find((m) => m.id === a.id) ? before.a.y - a.absoluteBoundingBox.y : 0;
    expect(a.absoluteBoundingBox.x).toBe(before.a.x);
    expect(a.absoluteBoundingBox.y).toBe(before.a.y - lift);
    expect(b.absoluteBoundingBox.y).toBe(a.absoluteBoundingBox.y + 3000 + GAP);
    expect(b.absoluteBoundingBox.x).toBe(before.a.x);
    // The section ends 800px above LATEST, with 320px around its children.
    expect(it.y + it.height).toBeLessThanOrEqual(f.latest.y - GAP);
    expect(it.absoluteBoundingBox.x).toBe(before.a.x - PAD);
  });

  it('never lifts a section within 800px of the one above it', () => {
    const kids: Box[] = [{ id: 'a', x: PAD, y: PAD, w: 2000, h: 3000 }];
    const below: Box = { id: 'old', x: 0, y: 3000, w: 5000, h: 5000 };
    const above: Box = { id: 'new', x: 0, y: -2000, w: 5000, h: 1200 };
    const r = restackPlan(kids, { id: 's', x: 0, y: 0, w: 2640, h: 1640 }, below, above);
    // 1440 is needed, but only 0 - (-800 + 800) = 0 of room is left above.
    expect(r.fit.y).toBe(0);
    expect(r.cramped).toBe(true);
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

const USE = 'mcp__plugin_figma_figma__use_figma';
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };

/** A fake Claude run that executes each use_figma script against the fake figma, like project.test.ts. */
function fakeRun(figma: any, fail = false) {
  const log = { scripts: [] as string[] };
  const run = (async (_prompt: string, o: any) => {
    if (fail) throw new Error('Figma is not open');
    const call = (ev: string, input: any, id: string) => o.hooks[ev][0].hooks[0](input, id);
    for (let i = 0; i < 10; i++) {
      const pre = await call('PreToolUse', { tool_name: USE, tool_input: {} }, `u${i}`);
      if (pre.hookSpecificOutput.permissionDecision !== 'allow') break;
      log.scripts.push(pre.hookSpecificOutput.updatedInput.code);
      const out = await new AsyncFunction('figma', pre.hookSpecificOutput.updatedInput.code)(figma);
      await call('PostToolUse', { tool_name: USE, tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, `u${i}`);
    }
    return { data: { ok: true }, tokens: 1, costUsd: 0.001, text: '' };
  }) as any;
  return { run, log };
}

let made = 0;
async function adopted(f: ReturnType<typeof fakeFigma>) {
  const dir = path.join(ROOTS.projects, `it-${++made}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Checkout', url: 'https://www.figma.com/design/KEY' }));
  await writeProject(dir, {
    key: 'KEY', page: { id: f.page.id, name: 'Flows' },
    flows: [{ n: 1, slug: 'home', name: 'Home', entry: [f.entry.id] }, { n: 2, slug: 'connectors', name: 'Connectors', entry: [] }],
    iterations: [{ id: '1', node: f.latest.id, name: 'LATEST', state: 'frozen', adopted: true }],
  });
  return dir;
}

describe('iteration lifecycle', () => {
  it('creates the iteration, its section above the others and its flow subsections, then adds a flow under them and restacks', async () => {
    const f = fakeFigma();
    const dir = await adopted(f);
    const { run } = fakeRun(f.figma);
    const r = await createIterationInFigma(dir, 'KEY', { id: '1.19', topic: 'Readiness', date: '2026-10-20', flows: ['home'] }, { run, mcp: MCP });
    expect(r.figma.ok).toBe(true);
    const it1 = (await readProject(dir))!.iterations.find((x) => x.id === '1.19')!;
    const section = f.nodes.get(it1.node!);
    expect(section.name).toBe('V1.19 · Readiness · Tue 20 Oct 2026');
    expect(section.y + section.height).toBe(f.latest.y - GAP);
    expect(Object.keys(it1.flows!)).toEqual(['home']);
    expect(f.latest).toMatchObject({ x: 0, y: 0, width: 6000, height: 4000 });

    const added = await addFlowToIteration(dir, 'KEY', '1.19', 'connectors', { run, mcp: MCP });
    expect(added.figma.ok).toBe(true);
    expect(added.cwd).toMatch(/flows\/02-connectors\/iterations\/1\.19$/);
    const it2 = (await readProject(dir))!.iterations.find((x) => x.id === '1.19')!;
    const home = f.nodes.get(it2.flows!.home.node), conn = f.nodes.get(it2.flows!.connectors.node);
    expect(conn.absoluteBoundingBox.y).toBe(home.absoluteBoundingBox.y + home.height + GAP);
    // The section grew, so the restack lifted it: it still ends 800px above LATEST, which never moved.
    expect(section.y + section.height).toBeLessThanOrEqual(f.latest.y - GAP);
    expect(f.latest).toMatchObject({ x: 0, y: 0, width: 6000, height: 4000 });
  });

  it('keeps the iteration when Figma fails, and Retry makes only the section', async () => {
    const f = fakeFigma();
    const dir = await adopted(f);
    const r = await createIterationInFigma(dir, 'KEY', { id: '1.19', topic: 'Readiness', flows: ['home'] }, { run: fakeRun(f.figma, true).run, mcp: MCP });
    expect(r.figma.ok).toBe(false);
    expect(r.iteration.id).toBe('1.19');
    expect((await readProject(dir))!.iterations.find((x) => x.id === '1.19')!.node).toBeUndefined();
    const again = await makeSectionsFor(dir, 'KEY', '1.19', ['home'], { run: fakeRun(f.figma).run, mcp: MCP });
    expect(again.ok).toBe(true);
    expect((await readProject(dir))!.iterations.find((x) => x.id === '1.19')!.flows!.home.node).toBeTruthy();
  });

  it('freezes and reopens, naming a newer working iteration', async () => {
    const f = fakeFigma();
    const dir = await adopted(f);
    await createIterationInFigma(dir, null, { id: '1.19', topic: 'A' });
    await createIterationInFigma(dir, null, { id: '1.20', topic: 'B' });
    await freezeIteration(dir, 'KEY', '1.19');
    expect((await readProject(dir))!.iterations.find((x) => x.id === '1.19')!.state).toBe('frozen');
    const re = await reopenIteration(dir, '1.19');
    expect(re.newer).toEqual(['1.20']);
    await expect(addFlowToIteration(dir, 'KEY', '1', 'home')).rejects.toThrow(/frozen/);
  });
});
