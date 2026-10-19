import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkFlows, runFlowCheck } from './flowcheck.js';
import { flowCheckBody, flowCheckScript, pluginFlowCheck } from './flowcheckPlugin.js';
import { expandNode, runPayload, type PluginPayload } from './flowRules.js';
import { pagedScript, unpack } from './pluginRead.js';
import { FigmaError } from './figmaError.js';

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
    const payload = await runScript(flowCheckScript(), fakeFigma().figma);
    const r = checkFlows(expandNode(payload.document), { components: payload.components, componentSets: payload.componentSets });
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

  it('reads hover targets, toast boxes and long notes, and walks only the named sections when asked', async () => {
    const cardSet = { id: 'set:card', type: 'COMPONENT_SET', name: 'Colleague card' };
    const ready = { id: 'c:ready', type: 'COMPONENT', name: 'Status=Partly ready', parent: cardSet };
    const setupHover = { id: 'c:setupHover', type: 'COMPONENT', name: 'Status=Needs setup Hover', parent: cardSet };
    const toastMain = { id: 'c:toast', type: 'COMPONENT', name: 'Toast', parent: { type: 'PAGE' } };
    const long = 'Activation keeps the test strip so Richa can try it as an employee first. '.repeat(4);
    const card = node({ id: '4:1', type: 'INSTANCE', name: 'Card', main: ready, reactions: [click('2:1'), { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: 'c:setupHover', navigation: 'CHANGE_TO' }] }] });
    const toast = node({ id: '4:2', type: 'INSTANCE', name: 'Saved message', main: toastMain, absoluteBoundingBox: { x: 620, y: 140, width: 400, height: 48 } });
    const note = node({ id: '4:3', type: 'TEXT', name: 'Note', characters: long, absoluteBoundingBox: { x: 0, y: 1000, width: 400, height: 200 } });
    const listNote = node({ id: '4:4', type: 'TEXT', name: 'Note', characters: long, getStyledTextSegments: () => [{ listOptions: { type: 'UNORDERED' } }] });
    const main = section('1:1', 'Main', 0, 0, 4000, 2000, [frame('2:1', 'Home', 100, 100, [card, toast]), note, listNote]);
    const other = section('1:2', 'Other', 5000, 0, 2000, 1200, [frame('2:9', 'Old home', 5100, 100, [])]);
    const page = node({ id: '0:1', type: 'PAGE', name: 'Flows', loadAsync: async () => {} }, [main, other]);
    const byId: Record<string, any> = { 'c:setupHover': setupHover };
    const figma = { root: node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [page]), getNodeByIdAsync: async (id: string) => byId[id] ?? null };
    const out = await runScript(flowCheckScript(), figma);
    expect(out.components['c:setupHover']).toEqual({ name: 'Status=Needs setup Hover', componentSetId: 'set:card' });
    const json = JSON.stringify(out.document);
    expect(json).toContain('"i":"4:2","n":"Saved message","t":"INSTANCE","m":"c:toast","b":[620,140,400,48]');
    expect(json).toContain(`"x":"${long.slice(0, 40)}","L":${long.trim().length},"u":0`);
    expect(json).toContain('"i":"4:4","n":"Note","t":"TEXT"');
    expect(json).toContain('"u":1');
    const r = runPayload(out);
    const rules = r.flows.find((f) => f.name === 'Main')!.findings.map((f) => `${f.rule}:${f.nodeId}`);
    expect(rules).toEqual(expect.arrayContaining(['wrong-hover:4:1', 'toast:4:2', 'long-note:4:3']));
    expect(rules).not.toContain('long-note:4:4');
    const only = await runScript(flowCheckScript({ only: ['1:1'] }), figma);
    expect(JSON.stringify(only.document)).not.toContain('"2:9"');
    expect(JSON.stringify(only.document)).toContain('"4:1"');
  });

  it('walks LATEST, Parked and Scope sections first so the node cap cuts old work, and keeps canvas order', async () => {
    const big = (id: string, name: string, x: number) => section(id, name, x, 0, 2000, 1200, [frame(`${id}0`, `${name} screen`, x + 100, 100, Array.from({ length: 6 }, (_, k) => node({ id: `${id}${k + 1}`, type: 'TEXT', name: 'T', characters: 'x' })))]);
    const page = node({ id: '0:1', type: 'PAGE', name: 'Hi fi', loadAsync: async () => {} }, [big('7:', 'Flow 1 · V1', 0), big('8:', 'LATEST flows', 3000), big('9:', 'Onboarding', 6000)]);
    const figma = { root: node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [page]) };
    const out = await runScript(flowCheckScript({ maxNodes: 17, first: ['onboarding'] }), figma);
    expect(out.truncated).toBe(true);
    const tops = out.document.c[0].c.map((t: any) => [t.n, Boolean(t.c)]);
    expect(tops).toEqual([['Flow 1 · V1', false], ['LATEST flows', true], ['Onboarding', true]]);
    // A section the cap cut into is not checked, so its missing stickies are not reported.
    const cut = await runScript(flowCheckScript({ maxNodes: 12, first: ['onboarding'] }), figma);
    const flows = runPayload(cut).flows.map((f) => [f.name, f.state, f.skipped ?? '']);
    expect(flows).toEqual(expect.arrayContaining([['LATEST flows', 'pass', ''], ['Onboarding', 'unchecked', 'cut']]));
  });

  it('walks working iteration sections first by id, whatever their name', async () => {
    const small = (id: string, name: string, x: number) => section(id, name, x, 0, 2000, 1200, [frame(`${id}0`, `${name} screen`, x + 100, 100, [text(`${id}1`, 'x')])]);
    const figma = { root: node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [node({ id: '0:1', type: 'PAGE', name: 'Hi fi', loadAsync: async () => {} }, [small('1:', 'Flow 1 · V1', 0), small('2:', 'V1.19 · Readiness', 3000)])]) };
    const out = await runScript(flowCheckScript({ maxNodes: 3, firstIds: ['2:'] }), figma);
    expect(out.document.c![0].c!.filter((t: any) => t.c).map((t: any) => t.n)).toEqual(['V1.19 · Readiness']);
  });

  it('matches Scope flows as whole words, prefers an exact name, and leaves old versions behind once LATEST holds the flow', async () => {
    const small = (id: string, name: string, x: number, kids: any[] = []) => section(id, name, x, 0, 2000, 1200, [frame(`${id}0`, `${name} screen`, x + 100, 100, [text(`${id}1`, 'x')]), ...kids]);
    const tops = (out: PluginPayload) => out.document.c![0].c!.filter((t: any) => t.c).map((t: any) => t.n);
    const page = (kids: any[]) => ({ root: node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [node({ id: '0:1', type: 'PAGE', name: 'Hi fi', loadAsync: async () => {} }, kids)]) });
    // 3 layers per top section, so a cap of 3 walks only the section that goes first.
    const loose = page([small('1:', 'Flow 1 · V1', 0), small('2:', 'Flow 10 · Reports', 3000), small('3:', 'Flow 1', 6000)]);
    expect(tops(await runScript(flowCheckScript({ maxNodes: 3, first: ['Flow 1'] }), loose))).toEqual(['Flow 1']);
    const phrase = page([small('2:', 'Flow 10 · Reports', 0), small('1:', 'Flow 1 · V1', 3000)]);
    expect(tops(await runScript(flowCheckScript({ maxNodes: 3, first: ['Flow 1'] }), phrase))).toEqual(['Flow 1 · V1']);
    const held = page([small('1:', 'Flow 1 · V1', 0), small('2:', 'Flow 10 · Reports', 3000), small('4:', 'LATEST flows', 6000, [section('4:9', 'Flow 1 · First run (V1.14 · LATEST)', 6000, 1300, 1000, 500, [])])]);
    expect(tops(await runScript(flowCheckScript({ maxNodes: 3, first: ['Flow 1'] }), held))).toEqual(['LATEST flows']);
    const parked = page([small('5:', 'Parked · old work', 0, [section('5:9', 'Flow 7 · Checkout (PARKED)', 0, 1300, 1000, 500, [])]), small('6:', 'Flow 1 · V1', 3000), small('7:', 'Flow 7 · Checkout', 6000)]);
    expect(tops(await runScript(flowCheckScript({ maxNodes: 6, first: ['Flow 7'] }), parked))).toEqual(['Parked · old work', 'Flow 7 · Checkout']);
  });

  it('looks up link destinations the walk did not reach, with the sections around them', async () => {
    const latest = section('1:1', 'LATEST flows', 0, 0, 4000, 2000, [frame('2:1', 'Home', 100, 100, [btn('3:1', 'Back', { reactions: [click('2:9'), click('2:1'), hover()] })])]);
    const old = section('1:2', 'Flow 1 · V1', 5000, 0, 2000, 1200, [frame('2:9', 'Old home', 5100, 100, [])]);
    const figma = {
      root: node({ id: '0:0', type: 'DOCUMENT', name: 'Doc' }, [node({ id: '0:1', type: 'PAGE', name: 'Flows', loadAsync: async () => {} }, [latest, old])]),
      getNodeByIdAsync: async (id: string) => (id === '2:9' ? { id, type: 'FRAME', name: 'Old home', width: 1440, height: 900, parent: { id: '1:2', type: 'SECTION', name: 'Flow 1 · V1', parent: { id: '0:1', type: 'PAGE', name: 'Flows', parent: { type: 'DOCUMENT' } } } } : null),
    };
    const out = await runScript(flowCheckScript({ only: ['1:1'] }), figma);
    expect(out.outside).toEqual({ '2:9': { n: 'Old home', t: 'FRAME', w: 1440, h: 900, s: [['1:2', 'Flow 1 · V1']], p: ['0:1', 'Flows'] } });
    const f = runPayload(out).flows.find((x) => x.name === 'LATEST flows')!.findings.filter((x) => x.rule === 'stale-link');
    expect(f.map((x) => x.message)).toEqual(['Button "Back" opens "Old home" in "Flow 1 · V1", which is an old version.']);
  });

  it('stays well under the use_figma code limit', () => {
    expect(flowCheckScript().length).toBeLessThan(50000);
    expect(flowCheckScript()).not.toMatch(/setCurrentPageAsync|loadAllPagesAsync|saveVersionHistoryAsync|setPluginData/);
  });
});

describe('flowCheckBody (the check inside Figma)', () => {
  it('gives the same findings inside the plugin as on the server, through one packed page', async () => {
    const body = await flowCheckBody();
    const script = pagedScript(body, 0);
    expect(script.length).toBeLessThan(50000);
    expect(script).not.toMatch(/setCurrentPageAsync|loadAllPagesAsync|saveVersionHistoryAsync|setPluginData/);
    const page = (await runScript(script, fakeFigma().figma)) as any;
    expect(page).toMatchObject({ ds: 1, page: 0, pages: 1 });
    const inPlugin = JSON.parse(unpack(page.data));
    const onServer = runPayload(await runScript(flowCheckScript(), fakeFigma().figma));
    expect(inPlugin).toEqual(JSON.parse(JSON.stringify(onServer)));
    expect(inPlugin.flows.find((f: any) => f.name === 'Main').state).toBe('fail');
  });

  it('passes the scope into the check', async () => {
    const body = await flowCheckBody({ ...(await import('../../shared/scope.js')).EMPTY_SCOPE });
    expect(body).toContain('__fc.runPayload(__payload,');
  });
});

describe('pluginFlowCheck', () => {
  it('hands the bundled check to the plugin reader and returns its findings with the cost', async () => {
    const seen: { prompt?: string; opts?: any } = {};
    const run = (async (prompt: string, opts: any) => {
      seen.prompt = prompt;
      seen.opts = opts;
      // Play one use_figma call through the hooks, running the injected code against the fake file.
      const pre = await opts.hooks.PreToolUse[0].hooks[0]({ tool_name: 'mcp__plugin_figma_figma__use_figma', tool_input: { code: 'PAGE' } }, 'tu1');
      const code = pre.hookSpecificOutput.updatedInput.code;
      const out = await runScript(code, fakeFigma().figma);
      await opts.hooks.PostToolUse[0].hooks[0]({ tool_name: 'mcp__plugin_figma_figma__use_figma', tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, 'tu1');
      return { data: { ok: true }, tokens: 10, costUsd: 0.002, text: '' };
    }) as any;
    const r = await pluginFlowCheck('KEY123', (await import('../../shared/scope.js')).EMPTY_SCOPE, { dir: os.tmpdir(), mcp: MCP, run });
    expect(r.flows.find((f) => f.name === 'Main')!.state).toBe('fail');
    expect(r.costUsd).toBe(0.002);
    expect(seen.prompt).toContain('fileKey "KEY123"');
    expect(seen.opts.allowed).toContain('mcp__plugin_figma_figma__use_figma');
    expect(seen.opts.tools).toEqual([]);
  });
});

const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };

describe('runFlowCheck', () => {
  it('stores what the plugin read found, via plugin', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const payload = await runScript(flowCheckScript(), fakeFigma().figma);
    const read = async () => runPayload(payload);
    const run = await runFlowCheck({ dir, fileKey: 'abc', read });
    expect(run.via).toBe('plugin');
    expect(run.flows.find((f) => f.name === 'Main')!.state).toBe('fail');
  });

  it('passes plugin errors through', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const read = async () => { throw new FigmaError('Figma is not logged in. Log in to Figma, then try again.', 401); };
    await expect(runFlowCheck({ dir, fileKey: 'abc', read })).rejects.toThrow(/Log in to Figma/);
  });
});
