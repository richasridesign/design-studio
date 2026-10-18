import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFrames } from './check.js';
import { outline } from './review.js';
import { textNodes } from './crit.js';
import { expandFrame, framesFromParts, framesScript, readEstimate, readFrames, type FramesPart } from './frameRead.js';
import { PAGE_CHARS, pagedScript, unpack } from './pluginRead.js';

const MIXED = Symbol('mixed');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = (script: string, figma: any) => new AsyncFunction('figma', script)(figma);

// Plugin API nodes that throw on any write, so the script is proven read only.
function node(props: Record<string, any>, children?: any[]): any {
  const raw: Record<string, any> = { visible: true, opacity: 1, fills: [], strokes: [], reactions: [], fillStyleId: '', strokeStyleId: '', boundVariables: {}, ...props };
  if (children) raw.children = children;
  return new Proxy(raw, { set: () => { throw new Error('The script must not write'); }, defineProperty: () => { throw new Error('The script must not write'); } });
}
const solid = (r: number, g: number, b: number, extra: Record<string, any> = {}) => ({ type: 'SOLID', color: { r, g, b }, opacity: 1, visible: true, ...extra });
const box = (x: number, y: number, width: number, height: number) => ({ absoluteBoundingBox: { x, y, width, height } });

const library = { id: 'c:1', type: 'COMPONENT', name: 'Size=Small', remote: true, parent: { id: 's:1', type: 'COMPONENT_SET', name: 'Button' } };
const local = { id: 'c:2', type: 'COMPONENT', name: 'Card', remote: false, parent: { type: 'PAGE' } };

function fakeFile(extraChildren = 0) {
  const text = (id: string, characters: string, extra: Record<string, any> = {}) => node({ id, type: 'TEXT', name: characters, characters, fontSize: 14, fontWeight: 400, textStyleId: '', fills: [solid(0.5, 0.5, 0.5)], ...box(0, 0, 100, 20), ...extra });
  const frame = node({ id: '1:1', type: 'FRAME', name: 'Home', fills: [solid(1, 1, 1)], fillStyleId: 'S:abc', layoutMode: 'VERTICAL', itemSpacing: 13, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, cornerRadius: 6, ...box(0, 0, 1440, 900) }, [
    text('2:1', 'Welcome back', { fontSize: MIXED, getRangeFontSize: () => 24, fontWeight: MIXED, getRangeFontWeight: () => 700, textStyleId: MIXED, getRangeTextStyleId: () => 'S:title' }),
    text('2:2', 'Tiny grey note', { fontSize: 10, fills: MIXED, getRangeFills: () => [solid(0.8, 0.8, 0.8)] }),
    node({ id: '2:3', type: 'INSTANCE', name: 'Button', reactions: [{}, {}], getMainComponentAsync: async () => library, ...box(0, 0, 80, 32) }, [text('2:4', 'Save')]),
    node({ id: '2:5', type: 'INSTANCE', name: 'Card', getMainComponentAsync: async () => local, cornerRadius: MIXED, ...box(0, 0, 300, 200) }),
    node({ id: '2:6', type: 'RECTANGLE', name: 'Bg', fills: [solid(0, 0, 1, { visible: false }), { type: 'GRADIENT_LINEAR', visible: true }], boundVariables: { fills: [{ id: 'v' }], topLeftRadius: { id: 'r' }, width: undefined }, ...box(0, 0, 10, 10) }),
    node({ id: '2:7', type: 'FRAME', name: 'Hidden', visible: false }, [text('2:8', 'Ghost')]),
    ...Array.from({ length: extraChildren }, (_, i) => text(`9:${i}`, `Row ${i} ${'lorem ipsum dolor sit amet '.repeat(3)}${i * 7919}`)),
  ]);
  const other = node({ id: '5:1', type: 'FRAME', name: 'Other page frame', ...box(2000, 0, 390, 800) }, [text('5:2', 'Hi')]);
  const byId: Record<string, any> = { '1:1': frame, '5:1': other, '0:1': { id: '0:1', type: 'PAGE' } };
  return new Proxy({ getNodeByIdAsync: async (id: string) => byId[id] ?? null }, { set: () => { throw new Error('The script must not write'); } });
}

// The same frame as the REST nodes endpoint gave it, for comparing what the checks see.
const restHome = {
  id: '1:1', name: 'Home', type: 'FRAME', fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }], styles: { fill: 'x' }, layoutMode: 'VERTICAL', itemSpacing: 13, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, cornerRadius: 6, absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    { id: '2:1', name: 'Welcome back', type: 'TEXT', characters: 'Welcome back', style: { fontSize: 24, fontWeight: 700 }, styles: { text: 'x' }, fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1 }], absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
    { id: '2:2', name: 'Tiny grey note', type: 'TEXT', characters: 'Tiny grey note', style: { fontSize: 10, fontWeight: 400 }, fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, opacity: 1 }], absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
    { id: '2:3', name: 'Button', type: 'INSTANCE', componentId: 'c:1', reactions: [{}, {}], absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 32 }, children: [{ id: '2:4', name: 'Save', type: 'TEXT', characters: 'Save', style: { fontSize: 14, fontWeight: 400 }, fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1 }], absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } }] },
    { id: '2:5', name: 'Card', type: 'INSTANCE', componentId: 'c:2', absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 } },
    { id: '2:6', name: 'Bg', type: 'RECTANGLE', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: false }, { type: 'GRADIENT_LINEAR' }], boundVariables: { fills: [{}] }, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } },
    { id: '2:7', name: 'Hidden', type: 'FRAME', visible: false },
  ],
};
const restComponents = { 'c:1': { name: 'Size=Small', remote: true }, 'c:2': { name: 'Card', remote: false } };

async function readAll(ids: string[], figma: any) {
  const body = framesScript(ids);
  const first = await runScript(pagedScript(body, 0), figma);
  const parts = [first.data];
  for (let p = 1; p < first.pages; p++) parts.push((await runScript(pagedScript(body, p), figma)).data);
  return { part: JSON.parse(unpack(parts.join(''))) as FramesPart, pages: first.pages as number };
}

describe('framesScript', () => {
  it('reads frames without writing and lists ids it cannot find', async () => {
    const { part } = await readAll(['1:1', '5:1', '404:1', '0:1'], fakeFile());
    expect(part.frames.map((f) => f.i)).toEqual(['1:1', '5:1']);
    expect(part.missing).toEqual(['404:1', '0:1']);
    expect(part.truncated).toBe(false);
    expect(part.components).toEqual({ 'c:1': { name: 'Size=Small', remote: true, componentSetId: 's:1', setName: 'Button' }, 'c:2': { name: 'Card', remote: false } });
  });

  it('carries reactions and looks up hover targets for the Code scan', async () => {
    const hoverMain = { id: 'c:1h', type: 'COMPONENT', name: 'Size=Small, State=Hover', remote: true, parent: { id: 's:1', type: 'COMPONENT_SET', name: 'Button' } };
    const btn = node({ id: '7:2', type: 'INSTANCE', name: 'Button', getMainComponentAsync: async () => library, ...box(0, 0, 80, 36), reactions: [
      { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'CONDITIONAL', conditionalBlocks: [{ actions: [{ type: 'NODE', destinationId: '7:9', navigation: 'NAVIGATE' }] }] }] },
      { trigger: { type: 'ON_HOVER' }, action: { type: 'NODE', destinationId: 'c:1h', navigation: 'CHANGE_TO' } },
      { trigger: null, actions: [] },
    ] });
    const f = node({ id: '7:1', type: 'FRAME', name: 'Home', ...box(0, 0, 1440, 900) }, [btn]);
    const byId: Record<string, any> = { '7:1': f, 'c:1h': hoverMain };
    const { part } = await readAll(['7:1'], { getNodeByIdAsync: async (id: string) => byId[id] ?? null });
    expect(part.components['c:1h']).toEqual({ name: 'Size=Small, State=Hover', remote: true, componentSetId: 's:1', setName: 'Button' });
    const doc = expandFrame(part.frames[0]);
    expect(doc.children[0].reactions).toEqual([
      { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '7:9', navigation: 'NAVIGATE' }] },
      { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: 'c:1h', navigation: 'CHANGE_TO' }] },
    ]);
    expect(checkFrames([{ document: doc, components: part.components }], null).filter((x) => x.area === 'interaction')).toEqual([]);
  });

  it('gives the checks, the outline and the copy list what the REST endpoint gave', async () => {
    const { part } = await readAll(['1:1'], fakeFile());
    const { docs } = framesFromParts(['1:1'], [part]);
    const doc = docs[0];
    const strip = (fs: any[]) => fs.map(({ id, rule, severity, nodeName }) => ({ id, rule, severity, nodeName }));
    expect(strip(checkFrames(docs, null))).toEqual(strip(checkFrames([{ document: restHome, components: restComponents }], null)));
    expect(outline(doc.document, doc.components)).toBe(outline(restHome, restComponents));
    expect(textNodes(doc.document)).toEqual(textNodes(restHome));
  });

  it('reads the first range of mixed text and leaves a mixed radius out', async () => {
    const { part } = await readAll(['1:1'], fakeFile());
    const home = expandFrame(part.frames[0]);
    const title = home.children.find((c: any) => c.id === '2:1');
    expect(title.style).toEqual({ fontSize: 24, fontWeight: 700 });
    expect(title.styles).toEqual({ text: 'style' });
    expect(home.children.find((c: any) => c.id === '2:2').fills[0].color).toEqual({ r: 0.8, g: 0.8, b: 0.8, a: 1 });
    expect(home.children.find((c: any) => c.id === '2:5').cornerRadius).toBeUndefined();
    expect(home.children.find((c: any) => c.id === '2:6').boundVariables).toEqual({ fills: true, topLeftRadius: true });
    expect(home.children.find((c: any) => c.id === '2:7')).toEqual({ id: '2:7', name: 'Hidden', type: 'FRAME', visible: false });
  });

  it('rebuilds the same tree when a page ends in the middle of a frame', async () => {
    const figma = fakeFile(1500);
    const { part, pages } = await readAll(['1:1', '5:1'], figma);
    expect(pages).toBeGreaterThan(1);
    expect(part.frames).toHaveLength(2);
    expect(part.frames[0].c!.filter((c) => c.i.startsWith('9:'))).toHaveLength(1500);
    expect(part.frames[1].c![0].x).toBe('Hi');
    expect(PAGE_CHARS).toBe(18000);
  });

  it('stops at the node cap and says so', async () => {
    const body = framesScript(['1:1'], 3);
    const r = await runScript(pagedScript(body, 0), fakeFile());
    const part = JSON.parse(unpack(r.data)) as FramesPart;
    expect(part.truncated).toBe(true);
    expect(part.nodes).toBe(3);
  });

  it('stays read only and under the code limit', () => {
    const s = pagedScript(framesScript(['1:1', '2:2', '3:3']), 0);
    expect(s.length).toBeLessThan(50000);
    expect(s).not.toMatch(/setCurrentPageAsync|loadAllPagesAsync|saveVersionHistoryAsync|setPluginData/);
  });
});

describe('readEstimate', () => {
  it('grows with the frame count', () => {
    expect(readEstimate(1)).toBe('about 15 seconds');
    expect(readEstimate(6)).toBe('about 25 seconds');
    expect(readEstimate(40)).toBe('about 2 minutes');
  });
});

describe('readFrames', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads frames in parts and saves screenshots in one run', async () => {
    const figma = fakeFile();
    const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
    let runs = 0;
    let useCalls = 0;
    const run = (async (_prompt: string, o: any) => {
      runs++;
      const call = (ev: string, input: any, id: string) => o.hooks[ev][0].hooks[0](input, id);
      for (let i = 0; i < 20; i++) {
        const pre = await call('PreToolUse', { tool_name: 'mcp__plugin_figma_figma__use_figma', tool_input: {} }, `u${i}`);
        if (pre.hookSpecificOutput.permissionDecision !== 'allow') break;
        useCalls++;
        const out = await runScript(pre.hookSpecificOutput.updatedInput.code, figma);
        await call('PostToolUse', { tool_name: 'mcp__plugin_figma_figma__use_figma', tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, `u${i}`);
      }
      for (const id of ['1:1', '5:1']) {
        const pre = await call('PreToolUse', { tool_name: 'mcp__plugin_figma_figma__get_screenshot', tool_input: { nodeId: id } }, `s${id}`);
        expect(pre.hookSpecificOutput.updatedInput.maxDimension).toBe(1600);
        await call('PostToolUse', { tool_name: 'mcp__plugin_figma_figma__get_screenshot', tool_input: { nodeId: id }, tool_response: [{ type: 'text', text: JSON.stringify({ image_url: `https://img.example/${id}.png` }) }] }, `s${id}`);
      }
      return { data: { ok: true }, tokens: 1, costUsd: 0.003, text: '' };
    }) as any;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(`png of ${url}`)));
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frames-'));
    const ids = ['1:1', '404:1', '5:1', '1:1'];
    const r = await readFrames('KEY', ids, { dir, mcp: MCP, run, shots: { dir: 'review/shots', maxDimension: 1600 } });
    expect(runs).toBe(1);
    expect(useCalls).toBe(1);
    expect(r.docs.map((d) => d.id)).toEqual(['1:1', '5:1']);
    expect(r.missing).toEqual(['404:1']);
    expect(r.shots).toEqual(['review/shots/1-1.png', 'review/shots/5-1.png']);
    expect(await readFile(path.join(dir, 'review/shots/5-1.png'), 'utf8')).toBe('png of https://img.example/5:1.png');
    expect(r.costUsd).toBe(0.003);
  });
});
