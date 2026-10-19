import { describe, expect, it } from 'vitest';
import { FIGMA_KIT, KIT_GUIDE, parses, prepareFigmaCall, usesKit, wrapFigmaCode } from './figmaKit.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Runs the kit against a small fake of the Plugin API and returns DS. */
async function kit(figma: unknown) {
  return new AsyncFunction('figma', `${FIGMA_KIT}\nreturn DS;`)(figma);
}

describe('wrapFigmaCode', () => {
  it('parses as the body of an async function, with the code in its own scope', () => {
    const code = wrapFigmaCode('const DS2 = 1; const box = 2; return await DS.node("1:2");')!;
    expect(parses(code)).toBe(true);
    expect(code.startsWith('const DS = (() => {')).toBe(true);
    expect(code).toContain('return await (async () => {\nconst DS2 = 1;');
    expect(code).not.toContain('saveVersionHistoryAsync');
  });

  it('adds nothing to code that does not use DS', () => {
    expect(wrapFigmaCode('return figma.root.name')).toBeNull();
    expect(usesKit('const x = "DS"; return x')).toBe(false);
    expect(usesKit('return DS . tree(n)')).toBe(true);
  });

  it('leaves code alone when the helpers would push it over the use_figma limit', () => {
    expect(wrapFigmaCode(`// ${'x'.repeat(45000)}\nreturn DS.box(n)`)).toBeNull();
  });
});

describe('prepareFigmaCall', () => {
  it('keeps the other arguments and leaves code that does not parse alone', () => {
    expect(prepareFigmaCall({ fileKey: 'k', description: 'd', code: 'return DS.tree(await DS.node("1:2"))' })).toMatchObject({ fileKey: 'k', description: 'd' });
    expect(prepareFigmaCall({ code: 'node.x = 1' })).toBeNull();
    expect(prepareFigmaCall({ code: 'DS.node(' })).toBeNull();
  });
});

describe('the helpers', () => {
  const variant = (id: string, props: Record<string, string>) => ({ id, type: 'COMPONENT', name: Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', '), variantProperties: props, parent: null as unknown });
  const set = { type: 'COMPONENT_SET', children: [variant('1:1', { Type: 'Primary', State: 'Default' }), variant('1:2', { Type: 'Primary', State: 'Hover' }), variant('1:3', { Type: 'Secondary', State: 'Default' }), variant('1:4', { Type: 'Secondary', State: 'Hover' })] };
  for (const c of set.children) c.parent = set;

  it('finds the Hover variant with the same other properties', async () => {
    const DS = await kit({});
    expect(DS.hoverOf(set.children[2]).id).toBe('1:4');
    expect(DS.hoverOf(set.children[3])).toBeNull();
  });

  it('points an instance hover at its own Hover variant and keeps its click', async () => {
    const DS = await kit({});
    const click = { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '9:9', navigation: 'NAVIGATE' }] };
    let saved: unknown[] = [];
    const inst = { id: '5:5', type: 'INSTANCE', reactions: [click], getMainComponentAsync: async () => set.children[2], setReactionsAsync: async (r: unknown[]) => { saved = r; } };
    expect(await DS.wireHover(inst)).toBe('1:4');
    expect(saved).toEqual([click, { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: '1:4', navigation: 'CHANGE_TO', transition: null }] }]);
  });

  it('moves by page coordinates and grows a section around its children', async () => {
    const DS = await kit({});
    const section: any = { type: 'SECTION', absoluteBoundingBox: { x: 100, y: 100, width: 500, height: 500 }, absoluteTransform: [[1, 0, 100], [0, 1, 100]], children: [] };
    const frame: any = { parent: section, x: 0, y: 0, width: 400, height: 300 };
    Object.defineProperty(frame, 'absoluteBoundingBox', { get: () => ({ x: frame.x + 100, y: frame.y + 100, width: 400, height: 300 }) });
    section.children.push(frame);
    DS.moveTo(frame, 300, 400);
    expect([frame.x, frame.y]).toEqual([200, 300]);
    section.resizeWithoutConstraints = (w: number, h: number) => Object.assign(section, { w, h });
    DS.fit(section);
    expect([section.w, section.h]).toEqual([600 + 320, 600 + 320]);
  });

  it('says what to do when a node is not awaited or is an id', async () => {
    const DS = await kit({});
    expect(() => DS.tree(Promise.resolve({}))).toThrow('DS.tree got a Promise: write await DS.node(id) first.');
    expect(() => DS.moveTo('1:2', 0, 0)).toThrow('DS.moveTo needs a node, not an id: use await DS.node("1:2").');
  });

  it('puts a clone next to its original, not on the current page', async () => {
    const DS = await kit({});
    const parent: any = { type: 'SECTION', children: [] as any[], insertChild(i: number, n: any) { this.children.splice(i, 0, n); n.parent = this; } };
    const screen: any = { parent, name: 'A', x: 0, y: 0, width: 100, height: 50, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 } };
    screen.clone = () => ({ name: 'A', parent: { type: 'PAGE' }, x: 0, y: 0 });
    parent.children.push(screen, { name: 'B' });
    parent.absoluteTransform = [[1, 0, 0], [0, 1, 0]];
    const c = DS.clone(screen, { name: 'A copy' });
    expect(parent.children.map((n: any) => n.name)).toEqual(['A', 'A copy', 'B']);
    expect([c.x, c.y]).toEqual([260, 0]);
  });

  it('keeps a large return value under the result limit', async () => {
    const DS = await kit({});
    const out = DS.done({ list: 'x'.repeat(30000) });
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(20480);
  });

  it('describes every helper it has', async () => {
    const DS = await kit({});
    for (const name of Object.keys(DS)) if (!['box', 'overlaps', 'hoverOf', 'texts', 'vars'].includes(name)) expect(KIT_GUIDE).toContain(`DS.${name}`);
  });
});

describe('DS.decisions', () => {
  /** A page with a section holding one 400 wide screen, and a Decision component set whose instances grow with their text. */
  function world(opts: { comp?: boolean } = {}) {
    let next = 100;
    const mk = (o: any) => {
      const n: any = { data: {} as Record<string, string>, x: 0, y: 0, width: 0, height: 0, parent: null, ...o };
      Object.defineProperty(n, 'absoluteBoundingBox', { get: () => { const p = n.parent && n.parent.type !== 'PAGE' ? n.parent.absoluteBoundingBox : { x: 0, y: 0 }; return { x: p.x + n.x, y: p.y + n.y, width: n.width, height: n.height }; } });
      Object.defineProperty(n, 'absoluteTransform', { get: () => { const b = n.absoluteBoundingBox; return [[1, 0, b.x], [0, 1, b.y]]; } });
      n.getSharedPluginData = (ns: string, k: string) => n.data[`${ns}/${k}`] ?? '';
      n.setSharedPluginData = (ns: string, k: string, v: string) => { n.data[`${ns}/${k}`] = v; };
      return n;
    };
    const page: any = { type: 'PAGE', name: 'Flows', findAllWithCriteria: () => (opts.comp === false ? [] : [set]) };
    const section = mk({ id: '1:1', type: 'SECTION', name: 'V1.19 · Flow 1 · Connectors', x: 1000, y: 1000, width: 600, height: 1200, children: [] as any[], parent: page });
    section.appendChild = (k: any) => { section.children.push(k); k.parent = section; };
    section.resizeWithoutConstraints = (w: number, h: number) => Object.assign(section, { width: w, height: h });
    const screen = mk({ id: '2:1', type: 'FRAME', name: 'Connectors', x: 0, y: 0, width: 400, height: 800 });
    section.appendChild(screen);
    const variant: any = { type: 'COMPONENT', name: 'Type=Default', createInstance: () => {
      const inst = mk({ id: `9:${next++}`, type: 'INSTANCE', width: 192, height: 120, componentProperties: { 'Decision#1:0': { type: 'TEXT', value: '' }, 'Why#1:1': { type: 'TEXT', value: '' } }, findAll: () => [], reactions: [] });
      inst.setProperties = (p: Record<string, string>) => { for (const [k, v] of Object.entries(p)) inst.componentProperties[k].value = v; inst.height = 100 + Math.ceil(String(inst.componentProperties['Decision#1:0'].value).length / 20) * 20; };
      inst.resize = (w: number, h: number) => Object.assign(inst, { width: w, height: h });
      inst.remove = () => { section.children.splice(section.children.indexOf(inst), 1); };
      return inst;
    } };
    const set: any = { type: 'COMPONENT_SET', name: 'Decision', children: [variant], defaultVariant: variant };
    variant.parent = set;
    const figma = { currentPage: page, root: { findAllWithCriteria: () => [] }, loadAllPagesAsync: async () => {}, loadFontAsync: async () => {}, getNodeByIdAsync: async (id: string) => [section, screen, ...section.children].find((n: any) => n.id === id) ?? null };
    return { figma, section, screen };
  }
  const three = [
    { decision: 'Readiness first', why: 'she starts there' },
    'Counts beside the name. Why: one glance per row',
    { decision: 'Errors name who acts, and this one is a much longer decision line', why: 'nobody waits' },
  ];

  it('makes 3 tagged stickies 96px under the screen with one height per row, and fits the section', async () => {
    const { figma, section, screen } = world();
    const DS = await kit(figma);
    const out = await DS.decisions(screen, three, { iteration: '1.19' });
    expect(out.stickies).toHaveLength(3);
    const stickies = section.children.filter((k: any) => k.type === 'INSTANCE');
    expect(stickies.map((s: any) => s.name)).toEqual(['Decision 1 · Connectors', 'Decision 2 · Connectors', 'Decision 3 · Connectors']);
    expect(stickies[1].componentProperties['Decision#1:0'].value).toBe('Counts beside the name.');
    expect(stickies[1].componentProperties['Why#1:1'].value).toBe('Why: one glance per row');
    expect(stickies[0].data).toEqual({ 'designstudio_decision/screen': '2:1', 'designstudio_decision/n': '1', 'designstudio_decision/iteration': '1.19' });
    // Two fit beside each other under a 400 wide screen: (400 + 16) / (192 + 16) = 2.
    expect(stickies.map((s: any) => [s.x, s.y])).toEqual([[0, 896], [208, 896], [0, 896 + stickies[0].height + 16]]);
    expect(stickies[0].height).toBe(stickies[1].height);
    expect(section.height).toBeGreaterThanOrEqual(stickies[2].y + stickies[2].height + 320);
    const check = await DS.check([screen.id]);
    expect(check.fewStickies).toEqual([]);
  });

  it('updates in place and removes the ones above the new count', async () => {
    const { figma, section, screen } = world();
    const DS = await kit(figma);
    const first = await DS.decisions(screen, [...three, { decision: 'Fourth', why: 'x' }], { iteration: '1.19' });
    const again = await DS.decisions(screen, three, { iteration: '1.19' });
    expect(again.stickies).toEqual(first.stickies.slice(0, 3));
    expect(again.removed).toBe(1);
    expect(section.children.filter((k: any) => k.type === 'INSTANCE')).toHaveLength(3);
  });

  it('refuses stickies of another iteration, more than 5, and a file with no Decision component', async () => {
    const a = world();
    let DS = await kit(a.figma);
    await DS.decisions(a.screen, three, { iteration: '1.18' });
    await expect(DS.decisions(a.screen, three, { iteration: '1.19' })).rejects.toThrow(/belongs to iteration 1.18/);
    await expect(DS.decisions(a.screen, [...three, ...three], {})).rejects.toThrow(/at most 5/);
    const b = world({ comp: false });
    DS = await kit(b.figma);
    await expect(DS.decisions(b.screen, three)).rejects.toThrow('No Decision sticky component: make one first');
    expect((await DS.check([b.screen.id])).fewStickies).toEqual([['2:1', 'Connectors', 0]]);
  });
});
