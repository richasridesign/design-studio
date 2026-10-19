import path from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Both roots point at temp folders before settings.js loads, so nothing outside them is listed, moved or written.
const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { removeProject, renameToConvention, pendingRenames, TRASH } = await import('./projectAdmin.js');
const { confirmAdopt, createIteration, readProject, updateProject } = await import('./project.js');
const { mapFiles } = await import('./fileMap.js');
const { renamePlan, doublesText } = await import('../../shared/projectNames.js');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
const USE = 'mcp__plugin_figma_figma__use_figma';
const NO_FIGMA = { run: (async () => ({ data: { ok: true }, tokens: 0, costUsd: 0, text: '' })) as any, mcp: MCP };

let n = 0;
async function project(root = ROOTS.projects, name = 'checkout') {
  const dir = path.join(root, `${name}-${++n}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Checkout', url: 'https://www.figma.com/design/KEY' }));
  return dir;
}

/** A fake Claude run that executes each use_figma script against a fake figma, like project.test.ts. */
function fakeRun(figma: any) {
  const log = { scripts: [] as string[] };
  const run = (async (_prompt: string, o: any) => {
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

describe('remove project', () => {
  it('stops its tasks, closes its chats, then moves the folder to .trash in the same root', async () => {
    const dir = await project();
    await mkdir(path.join(dir, 'flows', '01-a', 'iterations', '1.19'), { recursive: true });
    const order: string[] = [];
    const r = await removeProject(path.join(dir, 'flows', '01-a', 'iterations', '1.19'), {
      stopTasks: async (root) => { order.push(`tasks ${root === dir}`); return 2; },
      closeChats: (root) => { order.push(`chats ${root === dir}`); return 3; },
      now: () => new Date(2026, 9, 19, 9, 5, 7),
    });
    expect(order).toEqual(['tasks true', 'chats true']);
    expect(r).toMatchObject({ from: dir, tasks: 2, chats: 3 });
    expect(r.to).toBe(path.join(ROOTS.projects, TRASH, `${path.basename(dir)}-20261019-090507`));
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(path.join(r.to, 'figma.json'))).toBe(true);
    expect(existsSync(path.join(r.to, 'flows', '01-a', 'iterations', '1.19'))).toBe(true);
  });

  it('uses the chats root trash for an older project there', async () => {
    const dir = await project(ROOTS.chats, 'old');
    const r = await removeProject(dir, { stopTasks: async () => 0, closeChats: () => 0 });
    expect(path.dirname(r.to)).toBe(path.join(ROOTS.chats, TRASH));
  });

  it('refuses a folder outside the roots, a root itself and a folder with no Figma file, and moves nothing', async () => {
    const deps = { stopTasks: vi.fn(async () => 0), closeChats: vi.fn(() => 0) };
    await expect(removeProject('/tmp', deps)).rejects.toThrow(/Only a project folder/);
    await expect(removeProject(ROOTS.projects, deps)).rejects.toThrow(/Only a project folder/);
    const bare = path.join(ROOTS.projects, 'bare');
    await mkdir(bare, { recursive: true });
    await expect(removeProject(bare, deps)).rejects.toThrow(/no Figma file/);
    expect(existsSync(bare)).toBe(true);
    expect(deps.stopTasks).not.toHaveBeenCalled();
    expect(deps.closeChats).not.toHaveBeenCalled();
  });

  it('keeps .trash out of the project list', async () => {
    const { listProjects } = await import('./project.js');
    const dir = await project();
    const r = await removeProject(dir, { stopTasks: async () => 0, closeChats: () => 0 });
    expect((await readdir(path.join(ROOTS.projects, TRASH))).length).toBeGreaterThan(0);
    expect((await listProjects()).some((p) => p.cwd === dir || p.cwd.startsWith(path.join(ROOTS.projects, TRASH)) || p.cwd === r.to)).toBe(false);
  });
});

const S = (id: string, name: string, tag: string | null, kids: any[] = []) => ['S', id, name, 0, 0, 100, 100, kids, 0, tag];

async function adoptedWithWorking() {
  const dir = await project();
  await confirmAdopt(dir, 'KEY', {
    flows: [{ name: 'Onboarding' }, { name: 'Connectors' }],
    iterations: [{ id: '1', node: '9:1', name: 'LATEST' }, { id: '1.18', node: '9:2', name: 'Trust pass', topic: 'Trust and safety', date: '2026-10-19' }],
  }, NO_FIGMA);
  await createIteration(dir, { id: '1.19', topic: 'Readiness', date: '2026-10-20' });
  await updateProject(dir, (p) => ({ ...p!, iterations: p!.iterations.map((it) => (it.id === '1.19' ? { ...it, node: '50:1', flows: { onboarding: { node: '51:1' }, connectors: { node: '52:1' } } } : it)) }));
  const map = { readAt: 1, raw: { pages: [['0:1', 'Flows', [
    S('9:1', 'LATEST', 'iteration;1;'),
    S('9:2', 'Trust pass', 'iteration;1.18;'),
    S('50:1', 'V1.19 · Readyness', 'iteration;1.19;', [S('51:1', 'Onboarding copy', 'flow;1.19;onboarding'), S('52:1', 'V1.19 · Flow 2 · Connectors', 'flow;1.19;connectors')]),
  ], []]], sets: [], comps: [], vars: [], styles: [] } };
  const files = mapFiles(dir, 'KEY');
  await mkdir(path.dirname(files.json), { recursive: true });
  await writeFile(files.json, JSON.stringify(map));
  return dir;
}

describe('rename to convention', () => {
  it('lists only the working iteration sections whose Figma name drifted, never frozen or adopted ones', async () => {
    const dir = await adoptedWithWorking();
    expect(await pendingRenames(dir, 'KEY')).toEqual([
      { node: '50:1', now: 'V1.19 · Readyness', want: 'V1.19 · Readiness · Tue 20 Oct 2026' },
      { node: '51:1', now: 'Onboarding copy', want: 'V1.19 · Flow 1 · Onboarding' },
    ]);
  });

  it('renames them in one script under the write lock, records the name and rereads the map', async () => {
    const dir = await adoptedWithWorking();
    const nodes = new Map(['50:1', '51:1', '9:2'].map((id) => [id, { id, type: 'SECTION', name: 'old' }]));
    const { run, log } = fakeRun({ getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null });
    const refresh = vi.fn();
    const r = await renameToConvention(dir, 'KEY', { run, mcp: MCP, refresh });
    expect(r).toEqual({ renamed: 2, missing: [] });
    expect(log.scripts).toHaveLength(1);
    expect(nodes.get('50:1')!.name).toBe('V1.19 · Readiness · Tue 20 Oct 2026');
    expect(nodes.get('51:1')!.name).toBe('V1.19 · Flow 1 · Onboarding');
    expect(nodes.get('9:2')!.name).toBe('old');
    expect((await readProject(dir))!.iterations.find((it) => it.id === '1.19')!.name).toBe('V1.19 · Readiness · Tue 20 Oct 2026');
    expect(refresh).toHaveBeenCalledWith(dir, 'KEY');
  });

  it('does nothing in Figma when every name is right', async () => {
    const dir = await project();
    const { run, log } = fakeRun({ getNodeByIdAsync: async () => null });
    expect(await renameToConvention(dir, 'KEY', { run, mcp: MCP })).toEqual({ renamed: 0, missing: [] });
    expect(log.scripts).toHaveLength(0);
  });

  it('skips LATEST by name and an iteration without a topic', () => {
    const p = { flows: [{ n: 1, slug: 'a', name: 'A', entry: [] }], iterations: [{ id: '1.19', state: 'working' as const, node: '1:1', flows: { a: { node: '2:1' } } }] };
    expect(renamePlan(p, [{ id: '1:1', name: 'whatever', tag: { kind: 'iteration', iteration: '1.19' } }, { id: '2:1', name: 'LATEST', tag: { kind: 'flow', iteration: '1.19', flow: 'a' } }])).toEqual([]);
  });
});

describe('duplicate tag warning', () => {
  it('counts the extra copies and names them', () => {
    const t = doublesText([{ tag: { kind: 'iteration', iteration: '1.18' }, ids: ['80:1', '9:2'] }, { tag: { kind: 'flow', iteration: '1.19', flow: 'connectors' }, ids: ['70:1', '60:1', '52:1'] }]);
    expect(t.short).toBe('3 duplicate sections');
    expect(t.detail).toContain('Iteration 1.18 (80:1, 9:2)');
    expect(t.detail).toContain('1.19 · connectors (70:1, 60:1, 52:1)');
  });
});

describe('project list', () => {
  it('counts the pending renames on the project', async () => {
    const { listProjects } = await import('./project.js');
    const dir = await adoptedWithWorking();
    expect((await listProjects()).find((p) => p.cwd === dir)!.renames).toBe(2);
  });
});
