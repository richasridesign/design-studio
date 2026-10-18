import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkFlows, NO_FIGMA_ACCESS, runFlowCheck } from './flowcheck.js';
import { captureUseFigma, findPayload, flowCheckScript, loadDocumentViaPlugin, type PluginPayload } from './flowcheckPlugin.js';
import { FigmaError } from './figma.js';

// A fake Plugin API: nodes are Proxies that throw on any write, so the script is proven read only, and instances
// throw on the sync mainComponent getter, as they do in dynamic-page mode.
function node(props: Record<string, any>, children?: any[]): any {
  const raw: Record<string, any> = { visible: true, reactions: [], ...props };
  if (children) raw.children = children;
  if (raw.type === 'INSTANCE') {
    const main = raw.main;
    delete raw.main;
    Object.defineProperty(raw, 'mainComponent', { get: () => { throw new Error('Use getMainComponentAsync'); } });
    raw.getMainComponentAsync = async () => main;
  }
  const p = new Proxy(raw, {
    set: () => { throw new Error('The script must not write'); },
    defineProperty: () => { throw new Error('The script must not write'); },
    deleteProperty: () => { throw new Error('The script must not write'); },
  });
  return p;
}

const set = { id: 'set:btn', type: 'COMPONENT_SET', name: 'Button' };
const mainBtn = { id: 'c:btn', type: 'COMPONENT', name: 'Type=Primary, State=Default', parent: set };
const mainHover = { id: 'c:btnHover', type: 'COMPONENT', name: 'Type=Primary, State=Hover', parent: set };
const mainIcon = { id: 'c:icon', type: 'COMPONENT', name: 'Icon', parent: { type: 'PAGE' } };

const text = (id: string, characters: string) => node({ id, type: 'TEXT', name: characters, characters });
const vector = (id: string, name = 'Vector') => node({ id, type: 'VECTOR', name, absoluteBoundingBox: { x: 0, y: 0, width: 16, height: 16 } });
const btn = (id: string, label: string, extra: Record<string, any> = {}) =>
  node({ id, type: 'INSTANCE', name: 'Button', main: mainBtn, componentProperties: { 'Type': { type: 'VARIANT', value: 'Primary' }, 'Label#1:2': { type: 'TEXT', value: label } }, ...extra }, [text(`${id}t`, label), node({ id: `${id}i`, type: 'INSTANCE', name: 'Icon', main: mainIcon }, [vector(`${id}v`)])]);
const frame = (id: string, name: string, x: number, y: number, children: any[], extra: Record<string, any> = {}) =>
  node({ id, type: 'FRAME', name, absoluteBoundingBox: { x, y, width: 1440, height: 900 }, ...extra }, children);
const section = (id: string, name: string, x: number, y: number, w: number, h: number, children: any[]) =>
  node({ id, type: 'SECTION', name, absoluteBoundingBox: { x, y, width: w, height: h } }, children);
const click = (dest: string) => ({ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: dest, navigation: 'NAVIGATE', transition: null }] });
const hover = () => ({ trigger: { type: 'ON_HOVER' }, action: { type: 'NODE', destinationId: 'c:btnHover', navigation: 'CHANGE_TO' } });

function fakeFigma() {
  let loaded = 0;
  // Main flow: Home links to Done (same flow), a wired and hovered button, an unwired one, and a stale link into Old.
  const main = section('1:1', 'Main', 0, 0, 4000, 2000, [
    frame('2:1', 'Home', 100, 100, [
      btn('3:1', 'Continue', { reactions: [click('2:2'), hover()] }),
      btn('3:2', 'Save'),
      btn('3:3', 'Back', { reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'CONDITIONAL', conditionalBlocks: [{ actions: [{ type: 'NODE', destinationId: '2:9', navigation: 'NAVIGATE' }] }] }] }, hover()] }),
      node({ id: '3:9', type: 'FRAME', name: 'Hidden', visible: false }, [btn('3:10', 'Ghost')]),
    ]),
    // Done overlaps Home on the canvas.
    frame('2:2', 'Done', 1000, 300, [text('3:20', 'All set')]),
  ]);
  const old = section('1:2', 'Old', 5000, 0, 2000, 1200, [frame('2:9', 'Old home', 5100, 100, [])]);
  const page1 = node({ id: '0:1', type: 'PAGE', name: 'Flows', loadAsync: async () => { loaded++; } }, [main, old, node({ id: '9:1', type: 'TEXT', name: 'Title', characters: 'Flows', absoluteBoundingBox: { x: 0, y: -200, width: 100, height: 40 } })]);
  const page2 = node({ id: '0:2', type: 'PAGE', name: 'Components', loadAsync: async () => { loaded++; } }, [node({ id: '8:1', type: 'COMPONENT', name: 'Button' })]);
  const root = node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [page1, page2]);
  return { figma: new Proxy({ root }, { set: () => { throw new Error('The script must not write'); } }), loaded: () => loaded };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = (script: string, figma: any): Promise<PluginPayload> => new AsyncFunction('figma', script)(figma);

describe('flowCheckScript', () => {
  it('reads the file without writing and returns a compact tree with component maps', async () => {
    const fake = fakeFigma();
    const out = await runScript(flowCheckScript(), fake.figma);
    expect(fake.loaded()).toBe(2);
    expect(out.flowcheck).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.components).toEqual({ 'c:btn': { name: 'Type=Primary, State=Default', componentSetId: 'set:btn' }, 'c:icon': { name: 'Icon' } });
    expect(out.componentSets).toEqual({ 'set:btn': { name: 'Button' } });
    const json = JSON.stringify(out);
    // Icon vectors are dropped, hidden nodes stay shallow, and a page without sections is not walked.
    expect(json).not.toContain('"3:1v"');
    expect(json).not.toContain('"3:10"');
    expect(json).not.toContain('"8:1"');
    expect(json).toContain('"i":"3:9","n":"Hidden","t":"FRAME","h":1');
  });

  it('feeds checkFlows real findings once expanded', async () => {
    const fake = fakeFigma();
    const wrapped = { content: [{ type: 'text', text: JSON.stringify(await runScript(flowCheckScript(), fake.figma)) }] };
    const payload = findPayload(wrapped)!;
    const { document, maps } = await loadFromPayload(payload);
    const r = checkFlows(document, maps);
    const mainFlow = r.flows.find((f) => f.name === 'Main')!;
    const rules = mainFlow.findings.map((f) => `${f.rule}:${f.nodeId}`);
    expect(rules).toContain('no-click:3:2');
    expect(rules).toContain('no-hover:3:2');
    expect(rules).toContain('stale-link:3:3');
    expect(rules.some((x) => x.startsWith('overlap:'))).toBe(true);
    expect(rules).not.toContain('no-click:3:1');
    expect(rules.some((x) => x.endsWith(':3:10'))).toBe(false);
    expect(r.flows.find((f) => f.name === 'Old')!.state).toBe('pass');
  });

  it('stops at the node cap and says so', async () => {
    const out = await runScript(flowCheckScript({ maxNodes: 5 }), fakeFigma().figma);
    expect(out.truncated).toBe(true);
    expect(out.nodes).toBe(5);
  });

  it('stays well under the use_figma code limit', () => {
    expect(flowCheckScript().length).toBeLessThan(50000);
    expect(flowCheckScript()).not.toMatch(/setCurrentPageAsync|loadAllPagesAsync|saveVersionHistoryAsync|setPluginData/);
  });
});

async function loadFromPayload(payload: PluginPayload) {
  const msgs = toolMessages(JSON.stringify(payload));
  return loadDocumentViaPlugin('abc', { dir: os.tmpdir(), mcp: MCP, run: fakeLean(msgs) });
}

const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };

function toolMessages(content: unknown): any[] {
  return [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__plugin_figma_figma__use_figma', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content }] } },
  ];
}

// Plays messages into onMessage like the SDK stream, and stops when aborted.
function fakeLean(msgs: any[], seen?: { prompt?: string; opts?: any }) {
  return (async (prompt: string, opts: any) => {
    if (seen) Object.assign(seen, { prompt, opts });
    for (const m of msgs) {
      if (opts.signal?.aborted) return { data: null, tokens: 0, costUsd: 0, text: '', error: 'aborted' };
      opts.onMessage?.(m);
    }
    return { data: { ok: false, note: 'nothing' }, tokens: 0, costUsd: 0, text: '' };
  }) as any;
}

describe('findPayload', () => {
  const p = { flowcheck: 1, document: { i: '0:0', n: 'D', t: 'DOCUMENT', c: [] }, components: {}, componentSets: {}, nodes: 1, truncated: false };
  it('reads the payload from text blocks, double-encoded strings, wrapped text and structured content', () => {
    expect(findPayload([{ type: 'text', text: JSON.stringify(p) }])).toEqual(p);
    expect(findPayload([{ type: 'text', text: JSON.stringify(JSON.stringify(p)) }])).toEqual(p);
    expect(findPayload(`Result: ${JSON.stringify(p)}`)).toEqual(p);
    expect(findPayload({ structuredContent: { result: p } })).toEqual(p);
    expect(findPayload([{ type: 'text', text: 'Error: not logged in' }])).toBeNull();
  });
});

describe('loadDocumentViaPlugin', () => {
  it('asks for one use_figma call with the script, captures the tool result and stops the query', async () => {
    const seen: { prompt?: string; opts?: any } = {};
    const payload = await runScript(flowCheckScript(), fakeFigma().figma);
    const msgs = [...toolMessages([{ type: 'text', text: JSON.stringify(payload) }]), { type: 'assistant', message: { content: [{ type: 'text', text: 'should not be read' }] } }];
    const r = await loadDocumentViaPlugin('KEY123', { dir: os.tmpdir(), mcp: MCP, run: fakeLean(msgs, seen) });
    expect(r.document.children[0].name).toBe('Flows');
    expect(seen.opts.allowed).toEqual(['mcp__plugin_figma_figma__use_figma']);
    expect(seen.opts.tools).toEqual([]);
    expect(seen.opts.maxTurns).toBeLessThanOrEqual(4);
    expect(seen.opts.signal.aborted).toBe(true);
    expect(seen.prompt).toContain('fileKey "KEY123"');
    expect(seen.prompt).toContain(flowCheckScript());
  });

  it('names the plugin error when the tool result has no data', async () => {
    const run = fakeLean(toolMessages([{ type: 'text', text: 'You need to log in to Figma' }]));
    await expect(loadDocumentViaPlugin('abc', { dir: os.tmpdir(), mcp: MCP, run })).rejects.toThrow(/Figma plugin: You need to log in to Figma/);
  });

  it('ignores tool results for other tools', () => {
    const got: any[] = [];
    const on = captureUseFigma((c) => got.push(c));
    on({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__plugin_figma_figma__get_metadata' }] } } as any);
    on({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: '{"flowcheck":1,"document":{}}' }] } } as any);
    expect(got).toEqual([]);
  });
});

describe('runFlowCheck through the plugin', () => {
  const noToken = async () => { throw new FigmaError('Add a Figma personal access token in Settings first', 412); };

  it('falls back to the plugin without a token and stores via plugin', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const payload = await runScript(flowCheckScript(), fakeFigma().figma);
    const loadPlugin = (key: string, o: { dir: string }) => loadDocumentViaPlugin(key, { dir: o.dir, mcp: MCP, run: fakeLean(toolMessages(JSON.stringify(payload))) });
    const run = await runFlowCheck({ dir, fileKey: 'abc', load: noToken, loadPlugin, figma: async () => ({ configured: true }) });
    expect(run.via).toBe('plugin');
    expect(run.flows.find((f) => f.name === 'Main')!.state).toBe('fail');
  });

  it('names both ways in when there is no token and no plugin', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    await expect(runFlowCheck({ dir, fileKey: 'abc', load: noToken, loadPlugin: async () => { throw new Error('not called'); }, figma: async () => ({ configured: false }) })).rejects.toThrow(NO_FIGMA_ACCESS);
  });

  it('does not fall back on other REST errors', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const load = async () => { throw new FigmaError('Figma file not found, or the token cannot open it', 404); };
    await expect(runFlowCheck({ dir, fileKey: 'abc', load, loadPlugin: async () => { throw new Error('not called'); }, figma: async () => ({ configured: true }) })).rejects.toThrow(/not found/);
  });
});
