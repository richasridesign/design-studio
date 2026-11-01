import { describe, expect, it } from 'vitest';
import { FIGMA_KIT } from './figmaKit.js';

// The DS helpers that can point a link or a sticky at the wrong screen, run on a small fake file.

type N = Record<string, any>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function fakeFile() {
  const all = new Map<string, N>();
  let seq = 1;
  function make(type: string, name: string, x: number, y: number, w: number, h: number, extra: N = {}, kids: N[] = []): N {
    const data: Record<string, string> = { ...(extra.data ?? {}) };
    const n: N = {
      id: `${seq++}:1`, type, name, x, y, width: w, height: h, children: kids, parent: null, reactions: [], ...extra,
      get absoluteBoundingBox() { return { x: n.x, y: n.y, width: n.width, height: n.height }; },
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      getSharedPluginData: (_ns: string, k: string) => data[k] ?? '',
      setSharedPluginData: (_ns: string, k: string, v: string) => { data[k] = v; },
      setReactionsAsync: async (r: N[]) => { n.reactions = r; },
      findAll: (f: (x: N) => boolean) => [...walk(n)].filter((x) => x !== n && f(x)),
      findAllWithCriteria: ({ types }: { types: string[] }) => [...walk(n)].filter((x) => x !== n && types.includes(x.type)),
      insertChild: (i: number, k: N) => { n.children.splice(i, 0, k); k.parent = n; },
      resizeWithoutConstraints: (w: number, h: number) => { n.width = w; n.height = h; },
      appendChild: (k: N) => { n.children.push(k); k.parent = n; },
      // Like Figma's clone: new ids, the same plugin data, and links that still point where the source's did.
      clone: () => {
        const c = make(n.type, n.name, n.x, n.y, n.width, n.height, { data: { ...data }, reactions: n.reactions.map((r: N) => ({ ...r })), characters: n.characters }, n.children.map((k: N) => k.clone()));
        return c;
      },
    };
    delete n.data;
    for (const k of kids) k.parent = n;
    all.set(n.id, n);
    return n;
  }
  function* walk(n: N): Generator<N> {
    yield n;
    for (const k of n.children ?? []) yield* walk(k);
  }
  const click = (to: N, navigation = 'NAVIGATE') => [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: to.id, navigation, transition: null }] }];

  const hoverVariant = make('COMPONENT', 'State=Hover', 0, 0, 100, 40);
  const elsewhere = make('FRAME', 'Settings', 0, 0, 1440, 900);
  const other = make('PAGE', 'Archive', 0, 0, 0, 0, {}, [elsewhere, make('COMPONENT_SET', 'Button', 0, 2000, 300, 100, {}, [hoverVariant])]);

  const b = make('FRAME', '2 Review', 1600, 200, 1440, 900);
  const step = make('TEXT', 'overline', 1700, 300, 200, 16, { characters: 'STEP 2 · REVIEW' });
  const rule = make('TEXT', 'text', 1700, 330, 300, 16, { characters: 'Reminds once, then tells the owner' });
  const item = make('INSTANCE', 'Timeline item', 1690, 290, 400, 80, {}, [step, rule]);
  const button = make('INSTANCE', 'Button', 100, 1000, 100, 40);
  const a = make('FRAME', '1 Draft', 0, 200, 1440, 900, {}, [button]);
  b.children.push(item);
  item.parent = b;
  const sticky = make('INSTANCE', 'Decision 1 · 1 Draft', 0, 1200, 200, 120, { data: { screen: a.id, n: '1' } });
  const flow = make('SECTION', 'V0.3 · Flow 2 · Review', 0, 0, 3200, 1600, {}, [a, b, sticky]);
  const version = make('SECTION', 'V0.3 · Review · Sat 31 Oct 2026', 0, 0, 3400, 1800, {}, [flow]);
  const page = make('PAGE', 'Design', 0, 0, 0, 0, {}, [version]);
  const root = { id: '0:0', type: 'DOCUMENT', children: [page, other] };
  page.parent = root;
  other.parent = root;

  button.reactions = [
    ...click(b),
    ...click(elsewhere),
    { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: hoverVariant.id, navigation: 'CHANGE_TO', transition: null }] },
  ];
  const figma = { root, currentPage: page, getNodeByIdAsync: async (id: string) => all.get(id) ?? null };
  return { figma, all, nodes: { a, b, button, sticky, flow, version, rule, item, elsewhere } };
}

async function kit(figma: N) {
  return new AsyncFunction('figma', `${FIGMA_KIT}\nreturn DS;`)(figma);
}

describe('DS helpers', () => {
  it('cloneSection points links and stickies at the copies, never back at the source', async () => {
    const { figma, all, nodes } = fakeFile();
    const DS = await kit(figma);
    const r = await DS.cloneSection(nodes.flow, { name: 'V0.4 · Flow 2 · Review' });
    const copy = all.get(r.section)!;
    const newA = all.get(r.screens[nodes.a.id])!;
    const newB = all.get(r.screens[nodes.b.id])!;
    expect(newA.name).toBe('1 Draft');
    const btn = newA.children[0];
    const dests = btn.reactions.flatMap((x: N) => x.actions.map((y: N) => y.destinationId));
    expect(dests).toEqual([newB.id, expect.any(String)]);
    expect(dests).not.toContain(nodes.b.id);
    expect(dests).not.toContain(nodes.elsewhere.id);
    // The hover points at a variant on another page, and stays.
    expect(btn.reactions[1].actions[0].navigation).toBe('CHANGE_TO');
    expect(r.linksMoved).toBe(1);
    expect(r.linksDropped).toBe(1);
    const stickyCopy = copy.children.find((k: N) => k.name.startsWith('Decision'));
    expect(stickyCopy.getSharedPluginData('designstudio_decision', 'screen')).toBe(newA.id);
    // The source is untouched.
    expect(nodes.button.reactions[0].actions[0].destinationId).toBe(nodes.b.id);
    expect(nodes.sticky.getSharedPluginData('designstudio_decision', 'screen')).toBe(nodes.a.id);
  });

  it('link refuses a destination on another page or inside a screen', async () => {
    const { figma, nodes } = fakeFile();
    const DS = await kit(figma);
    await expect(DS.link(nodes.button, nodes.elsewhere)).rejects.toThrow(/on page Archive/);
    await expect(DS.link(nodes.button, nodes.item)).rejects.toThrow(/not a top-level frame/);
    await DS.link(nodes.button, nodes.b);
    expect(nodes.button.reactions.filter((r: N) => r.trigger.type === 'ON_CLICK')).toHaveLength(1);
    expect(nodes.button.reactions.some((r: N) => r.trigger.type === 'ON_HOVER')).toBe(true);
  });

  it('where names the screen, its number, the label above and the instance', async () => {
    const { figma, nodes } = fakeFile();
    const DS = await kit(figma);
    const w = DS.where(nodes.rule);
    expect(w.screen).toMatchObject({ id: nodes.b.id, number: '2' });
    expect(w.label).toBe('STEP 2 · REVIEW');
    expect(w.flow.id).toBe(nodes.flow.id);
    expect(w.version.id).toBe(nodes.version.id);
    expect(w.inInstance.id).toBe(nodes.item.id);
    expect((await DS.screen('2', nodes.version)).id).toBe(nodes.b.id);
    const hits = DS.texts(nodes.version, 'tells', { where: true });
    expect(hits).toEqual([expect.objectContaining({ id: nodes.rule.id, where: expect.objectContaining({ label: 'STEP 2 · REVIEW' }) })]);
  });
});
