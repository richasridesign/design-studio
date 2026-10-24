import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agent } from '../../figma-plugin/agent';
import { READS } from '../../figma-plugin/reads';
import { FIGMA_KIT_BODY } from './dsSources.js';
import { openFigmaPlugin } from './figmaPlugin.js';
import { MAP_SCRIPT } from './fileMap.js';
import { containingScript, OUTLINE_SCRIPT } from './figmaCache.js';
import { DECISION_NS, stickyScript } from './history.js';
import { READ_SCRIPT } from './iterations.js';
import { pluginScript } from './pluginRead.js';

// The plugin's named reads must give what the use_figma bodies give, since callers take either. Both run here on
// one fake file, and the socket path is checked end to end with the real plugin agent behind a fake socket.

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const json = (v: unknown) => JSON.parse(JSON.stringify(v === undefined ? null : v));

type N = Record<string, any>;
function fakeFile(opts: { frames?: number; stall?: boolean } = {}) {
  const all = new Map<string, N>();
  let seq = 1;
  const node = (type: string, name: string, x: number, y: number, w: number, h: number, extra: N = {}, kids: N[] = []): N => {
    const data: Record<string, string> = extra.data ?? {};
    const n: N = { id: extra.id ?? `${seq++}:1`, type, name, x, y, width: w, height: h, children: kids, parent: null, getSharedPluginData: (_ns: string, k: string) => data[k] ?? '', findAll: (f: (x: N) => boolean) => [...walk(n)].filter((x) => x !== n && f(x)), ...extra };
    delete n.data;
    for (const k of kids) k.parent = n;
    all.set(n.id, n);
    return n;
  };
  function* walk(n: N): Generator<N> {
    yield n;
    for (const k of n.children ?? []) yield* walk(k);
  }
  const variantSet = node('COMPONENT_SET', 'Button', 0, 5000, 400, 200, { componentPropertyDefinitions: { State: { type: 'VARIANT', variantOptions: ['Default', 'Hover'] }, Label: { type: 'TEXT' } }, key: 'k-button', description: 'Primary action' }, [
    node('COMPONENT', 'State=Default', 0, 0, 100, 40),
    node('COMPONENT', 'State=Hover', 120, 0, 100, 40),
  ]);
  const broken = node('COMPONENT_SET', 'Broken', 0, 6000, 400, 200, { key: 'k-broken' }, [node('COMPONENT', 'A=1', 0, 0, 10, 10)]);
  Object.defineProperty(broken, 'componentPropertyDefinitions', { get() { throw new Error('variant errors'); } });
  const decision = node('COMPONENT_SET', 'Decision', 0, 7000, 200, 100, { componentPropertyDefinitions: {} }, [node('COMPONENT', 'Type=Default', 0, 0, 200, 100)]);
  const sticky = (name: string, x: number, text: string, data: Record<string, string> = {}) => node('INSTANCE', name, x, 900, 200, 120, { data, getMainComponentAsync: async () => decision.children[0], componentProperties: { 'Decision#1:0': { type: 'TEXT', value: text }, 'Size#1:1': { type: 'VARIANT', value: 'M' } } });
  const flow = node('SECTION', 'V1.2 · Flow 1 · Connectors', 100, 200, 2000, 1400, { data: { kind: 'flow', iteration: '1.2', flow: 'connectors' }, absoluteBoundingBox: { x: 100, y: 200, width: 2000, height: 1400 } }, [
    node('FRAME', 'Connectors', 0, 0, 1440, 900, { data: { kind: '' } }, [node('TEXT', 'Title', 10, 10, 100, 20, { characters: 'Connectors' }), node('INSTANCE', 'Button', 20, 40, 100, 40, { getMainComponentAsync: async () => variantSet.children[0] })]),
    node('FRAME', 'Home (Entry, unchanged)', 1500, 0, 400, 800),
    node('INSTANCE', 'Wide card', 0, 1000, 1000, 200, { getMainComponentAsync: async () => variantSet.children[0], componentProperties: {} }),
    node('GROUP', 'Loose group', 0, 1300, 50, 50, {}, [node('RECTANGLE', 'r', 0, 0, 5, 5)]),
    sticky('Decision 1 · Connectors', 0, 'Readiness first', { screen: '9:9', n: '1', iteration: '1.2' }),
    sticky('Something', 220, 'Counts beside the name'),
    node('STICKY', 'Note', 440, 900, 100, 100, { text: { characters: 'Plain sticky' } }),
    node('ELLIPSE', 'Dot', 0, 0, 4, 4),
  ]);
  const iteration = node('SECTION', 'V1.2 · Trust · Mon 19 Oct 2026', 0, 0, 3000, 2000, { data: { kind: 'iteration', iteration: '1.2' } }, [flow, node('SECTION', 'V1.2 · Flow 2', 0, 1700, 800, 200, { data: { flow: 'second' } })]);
  const above = node('SECTION', 'V1.1', 0, -3000, 3000, 2600);
  const below = node('FRAME', 'Board', 0, 2400, 1000, 1000, {}, [node('SECTION', 'Inner', 0, 0, 500, 500, {}, [node('FRAME', 'Deep screen', 0, 0, 300, 300)])]);
  const many = Array.from({ length: opts.frames ?? 0 }, (_, i) => node('FRAME', `Screen ${i} ${'x'.repeat(190)}`, i * 10, 9000, 400, 800));
  const page1 = node('PAGE', 'Design Studio', 0, 0, 0, 0, { flowStartingPoints: [{ nodeId: flow.children[0].id, name: 'Start' }] }, [iteration, above, below, ...many]);
  const page2 = node('PAGE', 'Components', 0, 0, 0, 0, {}, [variantSet, broken, decision, node('COMPONENT', 'Loose icon', 0, 8000, 20, 20, { key: 'k-icon' })]);
  for (const p of [page1, page2]) {
    p.loadAsync = async () => {};
    p.findAllWithCriteria = ({ types }: { types: string[] }) => [...walk(p)].filter((x) => x !== p && types.includes(x.type));
  }
  const root = { id: '0:0', type: 'DOCUMENT', name: 'Scratch', children: [page1, page2] };
  for (const p of [page1, page2]) p.parent = root;
  const vars = [
    { id: 'v1', name: 'brand/primary', resolvedType: 'COLOR', variableCollectionId: 'c1', valuesByMode: { m1: { r: 0.1, g: 0.2, b: 0.9, a: 1 } } },
    { id: 'v2', name: 'surface/link', resolvedType: 'COLOR', variableCollectionId: 'c1', valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' } } },
    { id: 'v3', name: 'space/4', resolvedType: 'FLOAT', variableCollectionId: 'c1', valuesByMode: { m1: 4 } },
  ];
  const figma = {
    root,
    currentPage: page1,
    getNodeByIdAsync: (id: string) => (opts.stall ? new Promise(() => {}) : Promise.resolve(all.get(id) ?? null)),
    variables: {
      getLocalVariableCollectionsAsync: async () => [{ id: 'c1', name: 'Tokens', defaultModeId: 'm1' }],
      getLocalVariablesAsync: async () => vars,
      getVariableByIdAsync: async (id: string) => vars.find((v) => v.id === id) ?? null,
    },
    getLocalTextStylesAsync: async () => [{ id: 's1', name: 'Body', fontSize: 14, fontName: { family: 'Inter', style: 'Regular' }, lineHeight: { unit: 'PIXELS', value: 20 } }],
    getLocalPaintStylesAsync: async () => [{ id: 's2', name: 'Fill', paints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] }],
    getLocalEffectStylesAsync: async () => [{ id: 's3', name: 'Shadow' }],
    viewport: { center: { x: 0, y: 0 }, zoom: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    on: () => {},
  };
  return { figma, ids: { flow: flow.id, iteration: iteration.id, text: flow.children[0].children[0].id, wide: flow.children[2].id, screen: flow.children[0].id } };
}

describe('the plugin reads', () => {
  it('give what the use_figma bodies give', async () => {
    const { figma, ids } = fakeFile();
    const pairs: Array<[string, unknown, string]> = [
      ['outline', {}, OUTLINE_SCRIPT],
      ['map', {}, MAP_SCRIPT],
      ['kit', {}, FIGMA_KIT_BODY],
      ['containing', { ids: [ids.text, ids.wide, ids.flow, '404:1'] }, containingScript([ids.text, ids.wide, ids.flow, '404:1'])],
      ['stickies', { ids: [ids.iteration, '404:1'], ns: DECISION_NS, tag: 'designstudio' }, stickyScript([ids.iteration, '404:1'])],
      ['restack', { id: ids.iteration, tag: 'designstudio' }, READ_SCRIPT(ids.iteration)],
      ['restack', { id: ids.flow, tag: 'designstudio' }, READ_SCRIPT(ids.flow)],
    ];
    for (const [name, args, body] of pairs) {
      const want = json(await new AsyncFunction('figma', body)(figma));
      expect(json(await READS[name](figma, args)), name).toEqual(want);
    }
    // The fake is rich enough to mean something.
    const map = json(await READS.map(figma, {}));
    expect(map.sets.find((s: any) => s[1] === 'Button')[4]).toHaveLength(2);
    expect(json(await READS.stickies(figma, { ids: [ids.iteration] })).stickies).toHaveLength(3);
  });
});

/** A plugin connection on a fake socket, with the real plugin agent (figma-plugin/agent.ts) behind it. */
function connect(figma: any, hello: object = {}) {
  const ws = Object.assign(new EventEmitter(), { readyState: 1, sent: [] as any[], send(data: string) {
    const m = JSON.parse(data);
    ws.sent.push(m);
    queueMicrotask(() => void a.onmessage(m));
  } });
  openFigmaPlugin(ws as any, { moved: () => {}, changed: () => {} });
  const a = agent(figma, (m: any) => {
    if (m.t !== 'hello') return ws.emit('message', JSON.stringify(m));
    ws.emit('message', JSON.stringify({ ...m, ...hello }));
  }, () => 'KeyAAAAAAAAAA');
  a.hello();
  return { ws, close: () => { ws.readyState = 3; ws.emit('close'); } };
}

const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
const USE = 'mcp__plugin_figma_figma__use_figma';
/** The Claude path, played against the same fake file. */
function claudeRun(figma: any) {
  const log = { runs: 0 };
  const run = (async (_prompt: string, o: any) => {
    log.runs++;
    const call = (ev: string, input: any, id: string) => o.hooks[ev][0].hooks[0](input, id);
    for (let i = 0; i < 20; i++) {
      const pre = await call('PreToolUse', { tool_name: USE, tool_input: {} }, `u${i}`);
      if (pre.hookSpecificOutput.permissionDecision !== 'allow') break;
      const out = await new AsyncFunction('figma', pre.hookSpecificOutput.updatedInput.code)(figma);
      await call('PostToolUse', { tool_name: USE, tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, `u${i}`);
    }
    return { data: { ok: true }, tokens: 1, costUsd: 0.004, text: '' };
  }) as any;
  return { run, log };
}

describe('reads over the plugin socket', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ds-reads-'));
  writeFileSync(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KeyAAAAAAAAAA', name: 'Scratch' }));

  it('come from the plugin in the file, in slices, with no Claude run', async () => {
    // Over 256,000 characters, so the value comes back in two slices.
    const { figma } = fakeFile({ frames: 1500 });
    const { run, log } = claudeRun(figma);
    const conn = connect(figma);
    const r = await pluginScript<any>('KeyAAAAAAAAAA', OUTLINE_SCRIPT, 'outline', { dir, run, mcp: MCP, socket: { name: 'outline' } });
    expect(log.runs).toBe(0);
    expect(r.costUsd).toBe(0);
    expect(r.value).toEqual(json(await new AsyncFunction('figma', OUTLINE_SCRIPT)(figma)));
    expect(r.value[0][2]).toHaveLength(1503);
    // A write, or a read with no plugin name, never goes to the socket.
    await pluginScript('KeyAAAAAAAAAA', OUTLINE_SCRIPT, 'outline', { dir, run, mcp: MCP });
    expect(log.runs).toBe(1);
    expect(conn.ws.sent.filter((m) => m.t === 'read')).toHaveLength(1);
    conn.close();
  });

  it('go to Claude when the plugin is an older build, is matched only by name, or Figma does not answer it', async () => {
    const { figma } = fakeFile();
    const old = connect(figma, { reads: undefined });
    const a = claudeRun(figma);
    const first = await pluginScript<any>('KeyAAAAAAAAAA', MAP_SCRIPT, 'map', { dir, run: a.run, mcp: MCP, socket: { name: 'map' } });
    expect(a.log.runs).toBe(1);
    expect(old.ws.sent.filter((m) => m.t === 'read')).toHaveLength(0);
    old.close();
    // Another file can have the same name, and what a read gives is kept, so a plugin with no file key is never read.
    const keyless = connect(figma, { fileKey: null });
    await pluginScript<any>('KeyAAAAAAAAAA', MAP_SCRIPT, 'map', { dir, run: a.run, mcp: MCP, socket: { name: 'map' } });
    expect(a.log.runs).toBe(2);
    expect(keyless.ws.sent.filter((m) => m.t === 'read')).toHaveLength(0);
    keyless.close();
    // Not the front tab in Figma: node lookups never answer, so the plugin says so after its probe.
    const stalled = connect(fakeFile({ stall: true }).figma);
    const b = claudeRun(figma);
    const second = await pluginScript<any>('KeyAAAAAAAAAA', MAP_SCRIPT, 'map', { dir, run: b.run, mcp: MCP, socket: { name: 'map' } });
    expect(b.log.runs).toBe(1);
    expect(stalled.ws.sent.filter((m) => m.t === 'read')).toHaveLength(1);
    expect(second.value).toEqual(first.value);
    // The next read does not ask it again for a while.
    await pluginScript<any>('KeyAAAAAAAAAA', OUTLINE_SCRIPT, 'outline', { dir, run: b.run, mcp: MCP, socket: { name: 'outline' } });
    expect(b.log.runs).toBe(2);
    expect(stalled.ws.sent.filter((m) => m.t === 'read')).toHaveLength(1);
    stalled.close();
  }, 10_000);
});
