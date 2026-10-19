import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { assignStickies, historyView, isHistoryPath, markFlowEdited, onHistoryWrite, readingOrder, recordChanges, stickyScript, syncDecisions } = await import('./history.js');
const { parseHistory } = await import('../../shared/history.js');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
const USE = 'mcp__plugin_figma_figma__use_figma';

function fakeRun(figma: any) {
  const log = { runs: 0, scripts: [] as string[] };
  const run = (async (_prompt: string, o: any) => {
    log.runs++;
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

let n = 0;
/** A project with one flow and two iterations, and the chat folder of Flow 1 in 1.19. */
async function setup(state: 'working' | 'frozen' = 'working') {
  const root = path.join(ROOTS.projects, `p-${++n}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'File', url: 'https://www.figma.com/design/KEY' }));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({
    key: 'KEY',
    flows: [{ n: 1, slug: 'connectors', name: 'Connectors', entry: [] }],
    iterations: [
      { id: '1.18', state: 'frozen', topic: 'Trust' },
      { id: '1.19', state, topic: 'Readiness', date: '2026-10-20', node: '50:1', flows: { connectors: { node: '50:2' } } },
    ],
  }));
  const cwd = path.join(root, 'flows', '01-connectors', 'iterations', '1.19');
  await mkdir(cwd, { recursive: true });
  return { root, cwd, file: path.join(root, 'flows', '01-connectors', 'history.md') };
}

const text = (characters: string) => ({ type: 'TEXT', characters });
function figmaWith() {
  const main = { name: 'Type=Default', parent: { type: 'COMPONENT_SET', name: 'Decision' } };
  const sticky = (id: string, name: string, x: number, y: number, decision: string, why: string, data: Record<string, string> = {}) => ({
    id, name, type: 'INSTANCE', x, y, width: 200, height: 120,
    getSharedPluginData: (_ns: string, k: string) => data[k] ?? '',
    getMainComponentAsync: async () => main,
    componentProperties: { 'Decision#1:0': { type: 'TEXT', value: decision }, 'Why#1:1': { type: 'TEXT', value: why } },
    findAll: () => [],
  });
  const screen = (id: string, name: string, x: number, y: number) => ({ id, name, type: 'FRAME', x, y, width: 400, height: 800, getSharedPluginData: () => '' });
  const section = {
    id: '50:2', type: 'SECTION', name: 'V1.19 · Flow 1 · Connectors',
    children: [
      screen('60:1', 'Connectors', 0, 0),
      screen('60:2', 'Connected', 480, 0),
      { ...screen('60:3', 'Home (Entry, unchanged)', 960, 0) },
      sticky('70:1', 'Decision 1 · Connectors', 0, 896, 'Readiness shows which workflows are close', 'Why: she starts with the closest one.', { screen: '60:1', n: '1', iteration: '1.19' }),
      sticky('70:2', 'Decision 2 · Connectors', 216, 896, 'Counts sit beside the name', 'Why: one glance per row.'),
      sticky('70:3', 'Sticky', 0, 1032, 'Errors name who acts', 'Why: nobody waits.'),
      sticky('70:9', 'Decision 1 · Connected', 480, 896, 'Old decision', 'Why: from another round.', { iteration: '1.18' }),
    ],
  };
  return { getNodeByIdAsync: async (id: string) => (id === '50:2' ? section : null) };
}

describe('history file', () => {
  it('knows its path and keeps Claude off it', () => {
    expect(isHistoryPath('/x/p/flows/01-connectors/history.md')).toBe(true);
    expect(isHistoryPath('/x/p/flows/01-connectors/iterations/1.19/history.md')).toBe(false);
    expect(isHistoryPath('/x/p/notes.md')).toBe(false);
  });

  it('shows nothing for a chat that is not on a flow', async () => {
    const { root } = await setup();
    expect(await historyView(root)).toEqual({ flow: null, iteration: null, md: '', syncedAt: null, stale: false });
  });

  it('records set_status changes in the flow chat\'s own block and tells listeners', async () => {
    const { cwd, file } = await setup();
    const seen: string[] = [];
    const off = onHistoryWrite((f) => seen.push(f));
    expect(await recordChanges(cwd, [{ what: 'Readiness column added.', why: 'she starts with the closest workflow', screens: ['Connectors'] }], new Date(2026, 9, 20, 14, 2))).toBe(1);
    off();
    const md = await readFile(file, 'utf8');
    expect(md).toContain('# Flow 1 · Connectors');
    expect(md).toContain('## 1.19 · Readiness · Tue 20 Oct 2026');
    expect(md).toContain('State: Working · [Open in Figma](https://www.figma.com/design/KEY?node-id=50-2)');
    expect(md).toContain('- Tue 20 Oct 14:02 · Readiness column added on Connectors. Why: she starts with the closest workflow');
    expect(seen).toEqual([file]);
    const view = await historyView(cwd);
    expect(view.flow).toEqual({ n: 1, name: 'Connectors', slug: 'connectors' });
    expect(view.stale).toBe(true);
  });

  it('reads the stickies once, puts each under its screen and skips entry copies and other iterations', async () => {
    const { cwd, file } = await setup();
    const { run, log } = fakeRun(figmaWith());
    const r = await syncDecisions(cwd, { run, mcp: MCP }, new Date('2026-10-20T15:10:00Z'));
    expect(r).toEqual({ synced: true, screens: 2 });
    expect(log.runs).toBe(1);
    // Read only.
    expect(log.scripts[0]).not.toMatch(/\.x =|\.name =|appendChild|remove\(\)|setSharedPluginData/);
    const md = await readFile(file, 'utf8');
    const block = parseHistory(md).blocks[0];
    expect(block.body).toContain('#### Connectors · [Open in Figma](https://www.figma.com/design/KEY?node-id=60-1)\n- **Readiness shows which workflows are close** Why: she starts with the closest one.\n- **Counts sit beside the name** Why: one glance per row.\n- **Errors name who acts** Why: nobody waits.');
    expect(block.body).toContain('No stickies: Connected');
    expect(block.body).not.toContain('Old decision');
    expect(block.body).not.toContain('Entry, unchanged');
    const view = await historyView(cwd);
    expect(view.stale).toBe(false);
    expect(view.syncedAt).toBe(Date.parse('2026-10-20T15:10:00Z'));
    await markFlowEdited(cwd, new Date('2026-10-20T15:40:00Z'));
    expect((await historyView(cwd)).stale).toBe(true);
  });

  it('never reads a frozen iteration again once it was read', async () => {
    const { cwd } = await setup('frozen');
    const { run, log } = fakeRun(figmaWith());
    await syncDecisions(cwd, { run, mcp: MCP }, new Date('2026-10-20T15:10:00Z'));
    expect(await syncDecisions(cwd, { run, mcp: MCP })).toEqual({ synced: false, screens: 0 });
    expect(log.runs).toBe(1);
    expect((await historyView(cwd)).stale).toBe(false);
  });

  it('sorts screens in reading order', () => {
    const order = readingOrder([{ x: 500, y: 10 }, { x: 0, y: 1200 }, { x: 0, y: 0 }]);
    expect(order).toEqual([{ x: 0, y: 0 }, { x: 500, y: 10 }, { x: 0, y: 1200 }]);
  });

  it('places a sticky by position when it has no tag or name', () => {
    const out = assignStickies({
      screens: [{ id: '1:1', name: 'A', x: 0, y: 0, w: 400, h: 800 }, { id: '1:2', name: 'B', x: 480, y: 0, w: 400, h: 800 }],
      stickies: [{ id: '2:1', name: 'Sticky', x: 500, y: 900, w: 200, h: 100, parts: [{ text: 'Pick B\nWhy: it is shorter' }] }],
      missing: [],
    }, '1.19', 'KEY');
    expect(out[1].stickies).toEqual([{ decision: 'Pick B', why: 'it is shorter' }]);
    expect(out[0].stickies).toEqual([]);
  });

  it('builds a script that runs on its own', () => {
    expect(() => new AsyncFunction('figma', stickyScript(['1:1']))).not.toThrow();
  });
});
