import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedOutline, containingScript, fileOutline, framesContaining, OUTLINE_SCRIPT, renderFrame, thumbs } from './figmaCache.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = (script: string, figma: any) => new AsyncFunction('figma', script)(figma);
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
const USE = 'mcp__plugin_figma_figma__use_figma';
const SHOT = 'mcp__plugin_figma_figma__get_screenshot';

// A small read-only file: two pages, frames inside a section, and a loaded flag per page.
function fakeFile() {
  const loaded: string[] = [];
  const page = (id: string, name: string, children: any[]): any => {
    const p: any = { id, name, type: 'PAGE', children, loadAsync: async () => { loaded.push(id); } };
    for (const c of children) c.parent = p;
    return p;
  };
  const leaf: any = { id: '3:3', name: 'Label', type: 'TEXT' };
  const card: any = { id: '2:2', name: 'Card', type: 'FRAME', width: 200, height: 100, children: [leaf] };
  leaf.parent = card;
  const home: any = { id: '1:1', name: 'Home', type: 'FRAME', width: 1440.4, height: 900, children: [card] };
  card.parent = home;
  const section: any = { id: '1:9', name: 'Flow', type: 'SECTION', width: 3000, height: 1000, children: [] };
  const p1 = page('0:1', 'Design', [home, section, { id: '1:5', name: 'Note', type: 'TEXT', width: 1, height: 1 }]);
  const p2 = page('0:2', 'Parts', [{ id: '5:1', name: 'Button', type: 'COMPONENT_SET', width: 300, height: 80 }]);
  const all = new Map<string, any>([[home.id, home], [card.id, card], [leaf.id, leaf], [section.id, section]]);
  const root = { children: [p1, p2] };
  return { figma: { root, getNodeByIdAsync: async (id: string) => all.get(id) ?? null }, loaded };
}

function fakeRun(figma: any, log = { runs: 0, shots: [] as string[], max: [] as number[] }) {
  const run = (async (prompt: string, o: any) => {
    log.runs++;
    const call = (ev: string, input: any, id: string) => o.hooks[ev][0].hooks[0](input, id);
    for (let i = 0; i < 10; i++) {
      const pre = await call('PreToolUse', { tool_name: USE, tool_input: {} }, `u${i}`);
      if (pre.hookSpecificOutput.permissionDecision !== 'allow') break;
      const out = await runScript(pre.hookSpecificOutput.updatedInput.code, figma);
      await call('PostToolUse', { tool_name: USE, tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, `u${i}`);
    }
    for (const id of prompt.match(/node ids, with fileKey "[^"]+": (.*?)\. /)?.[1].split(', ') ?? []) {
      const pre = await call('PreToolUse', { tool_name: SHOT, tool_input: { nodeId: id } }, `s${id}`);
      log.shots.push(id);
      log.max.push(pre.hookSpecificOutput.updatedInput.maxDimension);
      await new Promise((r) => setTimeout(r, 5));
      await call('PostToolUse', { tool_name: SHOT, tool_input: { nodeId: id }, tool_response: [{ type: 'text', text: JSON.stringify({ image_url: `https://img.example/${id}.png` }) }] }, `s${id}`);
    }
    return { data: { ok: true }, tokens: 1, costUsd: 0.001, text: '' };
  }) as any;
  return { run, log };
}

const chatDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'figma-cache-'));
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Checkout', url: 'https://www.figma.com/design/KEY' }));
  return dir;
};

afterEach(() => vi.unstubAllGlobals());

describe('fileOutline', () => {
  it('reads the top-level frames once, then serves them from disk until asked for fresh', async () => {
    const { figma, loaded } = fakeFile();
    const { run, log } = fakeRun(figma);
    const dir = await chatDir();
    expect(await cachedOutline(dir, 'KEY')).toBeNull();
    const o = await fileOutline(dir, 'KEY', { mcp: MCP, run });
    expect(o.name).toBe('Checkout');
    expect(o.pages).toEqual([
      { id: '0:1', name: 'Design', frames: [{ id: '1:1', name: 'Home', page: 'Design', type: 'FRAME', w: 1440, h: 900 }, { id: '1:9', name: 'Flow', page: 'Design', type: 'SECTION', w: 3000, h: 1000 }] },
      { id: '0:2', name: 'Parts', frames: [{ id: '5:1', name: 'Button', page: 'Parts', type: 'COMPONENT_SET', w: 300, h: 80 }] },
    ]);
    expect(loaded).toEqual(['0:1', '0:2']);
    await fileOutline(dir, 'KEY', { mcp: MCP, run });
    expect(log.runs).toBe(1);
    await fileOutline(dir, 'KEY', { mcp: MCP, run, fresh: true });
    expect(log.runs).toBe(2);
    expect((await cachedOutline(dir, 'KEY'))!.pages[0].frames[0].name).toBe('Home');
  });

  it('never reads Figma for the sample file', async () => {
    const run = vi.fn();
    expect((await fileOutline(os.tmpdir(), 'sample', { mcp: MCP, run: run as any })).pages[0].frames.map((f) => f.name)).toEqual(['Cart', 'Empty cart']);
    expect(run).not.toHaveBeenCalled();
  });

  it('only reads', () => {
    expect(OUTLINE_SCRIPT).not.toMatch(/setCurrentPageAsync|loadAllPagesAsync/);
  });
});

describe('framesContaining', () => {
  it('finds the top-level frame of nested ids', async () => {
    const { figma } = fakeFile();
    expect(await runScript(containingScript(['3:3', '1:1', '9:9']), figma)).toEqual({ '3:3': '1:1', '1:1': '1:1' });
    const { run } = fakeRun(figma);
    expect(await framesContaining(await chatDir(), 'KEY', ['1:1', '1:9'], ['3:3'], { mcp: MCP, run })).toEqual(['1:1']);
  });

  it('skips the read when every id is a frame', async () => {
    const run = vi.fn();
    expect(await framesContaining(os.tmpdir(), 'KEY', ['1:1', '1:9'], ['1:9'], { mcp: MCP, run: run as any })).toEqual(['1:9']);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('thumbs', () => {
  it('saves thumbnails in the chat folder, serves them from disk, and takes them again at a higher rev', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(`png ${url}`)));
    const { run, log } = fakeRun({});
    const dir = await chatDir();
    const a = await thumbs(dir, 'KEY', [['1:1', 0], ['1:9', 0]], { mcp: MCP, run });
    expect(a['1:1']).toMatch(/^\/api\/chat-file\/\.figma-cache\/KEY\/thumbs\/1-1\.png\?v=\d+$/);
    expect(await readFile(path.join(dir, '.figma-cache/KEY/thumbs/1-9.png'), 'utf8')).toBe('png https://img.example/1:9.png');
    expect(log.max).toEqual([480, 480]);
    await thumbs(dir, 'KEY', [['1:1', 0]], { mcp: MCP, run });
    expect(log.runs).toBe(1);
    await thumbs(dir, 'KEY', [['1:1', 2]], { mcp: MCP, run });
    expect(log.runs).toBe(2);
    expect(log.shots).toEqual(['1:1', '1:9', '1:1']);
  });

  it('shares one read between requests for the same frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('png')));
    const { run, log } = fakeRun({});
    const dir = await chatDir();
    const [a, b] = await Promise.all([thumbs(dir, 'KEY', [['1:1', 0]], { mcp: MCP, run }), thumbs(dir, 'KEY', [['1:1', 0], ['1:9', 0]], { mcp: MCP, run })]);
    expect(a['1:1']).toBeTruthy();
    expect(b['1:9']).toBeTruthy();
    expect(log.shots.filter((x) => x === '1:1')).toHaveLength(1);
  });
});

describe('renderFrame', () => {
  it('saves the current frame at review size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('png')));
    const { run, log } = fakeRun({});
    const dir = await chatDir();
    expect(await renderFrame(dir, 'KEY', '1:1', { mcp: MCP, run })).toMatch(/^\/api\/chat-file\/\.figma-cache\/KEY\/render\/1-1\.png\?v=/);
    expect(log.max).toEqual([1600]);
  });
});
