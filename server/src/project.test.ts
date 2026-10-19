import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const { chatContext, cleanProject, confirmAdopt, createIteration, ensureIterationFolders, listProjects, readProject, setIterationState, tagList, tagScript, updateProject } = await import('./project.js');
const { projectRoot, roots } = await import('./roots.js');
const { mapFiles } = await import('./fileMap.js');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
const USE = 'mcp__plugin_figma_figma__use_figma';

let n = 0;
async function project(name = 'checkout') {
  const dir = path.join(ROOTS.projects, `${name}-${++n}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Checkout', url: 'https://www.figma.com/design/KEY' }));
  return dir;
}

/** A fake Claude run that executes the use_figma script against a fake figma object, like figmaCache.test.ts. */
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

function fakeFigma(ids: string[]) {
  const nodes = new Map(ids.map((id) => [id, { id, type: 'SECTION', data: {} as Record<string, string>, setSharedPluginData(ns: string, k: string, v: string) { this.data[`${ns}/${k}`] = v; } }]));
  return { figma: { getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null }, nodes };
}

const INPUT = {
  page: { id: '0:1', name: 'Flows' },
  flows: [{ name: 'Onboarding', entry: ['1:1'], baseline: '10:1' }, { name: 'Connectors', entry: ['2:1'] }],
  iterations: [
    { id: '1', node: '9:1', name: 'LATEST', flows: { onboarding: { node: '10:1' }, connectors: { node: '10:2' } } },
    { id: '1.18', node: '9:2', name: 'V1.18 · Trust and safety · Mon 19 Oct 2026', topic: 'Trust and safety', date: '2026-10-19', flows: { onboarding: { node: '11:1' } } },
  ],
  parked: { node: '9:9' },
};

describe('roots', () => {
  it('lists only the two temp roots', () => {
    expect(roots()).toEqual([path.resolve(ROOTS.chats), path.resolve(ROOTS.projects)]);
  });

  it('finds the project root from a flow iteration folder, and stops at the root', async () => {
    const dir = await project();
    const deep = path.join(dir, 'flows', '01-onboarding', 'iterations', '1.19');
    await mkdir(deep, { recursive: true });
    expect(projectRoot(deep)).toBe(dir);
    expect(projectRoot(dir)).toBe(dir);
    expect(projectRoot(ROOTS.projects)).toBe(path.resolve(ROOTS.projects));
    expect(projectRoot(path.join(ROOTS.chats, 'no-file'))).toBe(path.join(ROOTS.chats, 'no-file'));
  });
});

describe('cleanProject', () => {
  it('keeps the model fields, drops junk, and orders nothing', () => {
    const p = cleanProject({ key: 'K', flows: [{ name: 'A B', entry: ['1:1', 7] }, { nope: 1 }], iterations: [{ id: ' 1.19 ', state: 'working', extra: 1 }, { id: '' }], parked: { node: 3 } });
    expect(p).toEqual({ key: 'K', flows: [{ n: 1, slug: 'a-b', name: 'A B', entry: ['1:1'] }], iterations: [{ id: '1.19', state: 'working' }] });
    expect(cleanProject({})).toBeNull();
  });
});

describe('adoption', () => {
  it('writes project.json, the flow folders, and tags every known section once', async () => {
    const dir = await project();
    const { figma, nodes } = fakeFigma(['9:1', '9:2', '10:1', '10:2', '11:1', '9:9']);
    const { run, log } = fakeRun(figma);
    const r = await confirmAdopt(dir, 'KEY', INPUT, { run, mcp: MCP });
    expect(r.tagError).toBeNull();
    expect(r.project.flows.map((f) => f.slug)).toEqual(['onboarding', 'connectors']);
    expect(r.project.iterations.map((it) => [it.id, it.state, it.adopted])).toEqual([['1', 'frozen', true], ['1.18', 'frozen', true]]);
    expect(r.project.taggedAt).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(path.join(dir, 'flows', '01-onboarding', 'flow.json'), 'utf8'))).toEqual({ n: 1, slug: 'onboarding', name: 'Onboarding', entry: ['1:1'], baseline: '10:1' });
    expect(log.runs).toBe(1);
    expect(nodes.get('11:1')!.data).toEqual({ 'designstudio/kind': 'flow', 'designstudio/iteration': '1.18', 'designstudio/flow': 'onboarding', 'designstudio/project': 'KEY', 'designstudio/madeAt': expect.any(String) });
    expect(nodes.get('9:9')!.data['designstudio/kind']).toBe('parked');
    expect(nodes.get('9:1')!.data['designstudio/iteration']).toBe('1');
    // The script only sets plugin data.
    expect(log.scripts[0]).not.toMatch(/\.x =|\.y =|\.name =|appendChild|remove\(\)/);
  });

  it('keeps the tag failure out of the project file and reports it', async () => {
    const dir = await project();
    const run = (async () => { throw new Error('Figma is not connected'); }) as any;
    const r = await confirmAdopt(dir, 'KEY', INPUT, { run, mcp: MCP });
    expect(r.tagError).toMatch(/not connected/);
    expect((await readProject(dir))!.taggedAt).toBeUndefined();
  });

  it('needs at least one flow', async () => {
    const dir = await project();
    await expect(confirmAdopt(dir, 'KEY', { flows: [] })).rejects.toThrow(/at least one flow/);
  });

  it('tag script lists every node with its tag', () => {
    const p = cleanProject({ key: 'K', flows: [], iterations: [{ id: '1.18', node: '9:2', state: 'frozen', flows: { a: { node: '11:1', states: '11:2' } } }], parked: { node: '9:9' } })!;
    expect(tagList(p)).toEqual([['9:2', { kind: 'iteration', iteration: '1.18' }], ['11:1', { kind: 'flow', iteration: '1.18', flow: 'a' }], ['11:2', { kind: 'states', iteration: '1.18', flow: 'a' }], ['9:9', { kind: 'parked' }]]);
    expect(tagScript('K', tagList(p))).toContain('"11:2","states","1.18","a"');
  });
});

describe('iterations and chat folders', () => {
  it('makes a working iteration with folders for the chosen flows, and a chat there knows its flow', async () => {
    const dir = await project();
    await confirmAdopt(dir, 'KEY', INPUT, { run: (async () => ({ data: { ok: true }, tokens: 0, costUsd: 0, text: '' })) as any, mcp: MCP });
    const it = await createIteration(dir, { id: '1.19', topic: 'Connectors readiness', date: '2026-10-20', flows: ['connectors', 'nope'] }, 5);
    expect(it).toEqual({ id: '1.19', topic: 'Connectors readiness', date: '2026-10-20', state: 'working', createdAt: 5, flows: {} });
    const idir = path.join(dir, 'flows', '02-connectors', 'iterations', '1.19');
    expect(JSON.parse(await readFile(path.join(idir, 'iteration.json'), 'utf8'))).toEqual({ id: '1.19', flow: 'connectors', createdAt: 5 });
    expect(JSON.parse(await readFile(path.join(dir, 'iterations', '1.19', 'iteration.json'), 'utf8')).topic).toBe('Connectors readiness');
    const ctx = await chatContext(idir);
    expect(ctx?.scope).toBe('flow');
    expect(ctx?.flow?.slug).toBe('connectors');
    expect(ctx?.iteration?.id).toBe('1.19');
    expect((await chatContext(dir))?.scope).toBe('project');
    expect(await chatContext(path.join(ROOTS.chats, 'loose'))).toBeNull();
    await expect(createIteration(dir, { id: '1.19', topic: 'Again' })).rejects.toThrow(/already exists/);
    await expect(createIteration(dir, { id: 'x', topic: 'Again' })).rejects.toThrow(/major.minor/);
    expect((await setIterationState(dir, '1.19', 'frozen', 9)).iterations.at(-1)).toMatchObject({ state: 'frozen', frozenAt: 9 });
    // The same folder again: nothing rewritten.
    expect(await ensureIterationFolders(dir, 'connectors', '1.19')).toBe(idir);
    expect(JSON.parse(await readFile(path.join(idir, 'iteration.json'), 'utf8')).createdAt).toBe(5);
  });

  it('refuses a flow chat on a file with no project', async () => {
    const dir = await project();
    await expect(ensureIterationFolders(dir, 'a', '1')).rejects.toThrow(/Adopt it first/);
  });

  it('serialises writes to project.json', async () => {
    const dir = await project();
    await confirmAdopt(dir, 'KEY', { flows: [{ name: 'A' }] }, { run: (async () => ({ data: { ok: true }, tokens: 0, costUsd: 0, text: '' })) as any, mcp: MCP });
    await Promise.all([1, 2, 3].map((i) => updateProject(dir, (p) => ({ ...p!, iterations: [...p!.iterations, { id: `1.${i}`, state: 'frozen' as const }] }))));
    expect((await readProject(dir))!.iterations.map((it) => it.id).sort()).toEqual(['1.1', '1.2', '1.3']);
  });
});

describe('listProjects', () => {
  it('lists folders from both roots, moves a node id to the tagged section when it was cut and pasted, and marks a lost one', async () => {
    const dir = await project('listed');
    await confirmAdopt(dir, 'KEY', INPUT, { run: (async () => ({ data: { ok: true }, tokens: 0, costUsd: 0, text: '' })) as any, mcp: MCP });
    // The map read after Richa moved the 1.18 section: its id changed (tag kept), and the parked section is gone.
    const S = (id: string, name: string, tag: string | null, kids: any[] = []) => ['S', id, name, 0, 0, 100, 100, kids, 0, tag];
    const map = { readAt: 1, raw: { pages: [['0:1', 'Flows', [S('9:1', 'LATEST', 'iteration;1;'), S('77:1', 'V1.18 · Trust and safety · Mon 19 Oct 2026', 'iteration;1.18;', [S('11:1', 'V1.18 · Flow 1 · Onboarding', 'flow;1.18;onboarding')])], []]], sets: [], comps: [], vars: [], styles: [] } };
    const files = mapFiles(dir, 'KEY');
    await mkdir(path.dirname(files.json), { recursive: true });
    await writeFile(files.json, JSON.stringify(map));
    const old = path.join(ROOTS.chats, 'old-chat');
    await mkdir(old, { recursive: true });
    await writeFile(path.join(old, 'figma.json'), JSON.stringify({ key: 'OLD', name: 'Old file', url: 'https://www.figma.com/design/OLD' }));
    const list = await listProjects();
    const mine = list.find((p) => p.cwd === dir)!;
    expect(list.find((p) => p.cwd === old)).toMatchObject({ key: 'OLD', project: null });
    expect(mine.project!.iterations.find((it) => it.id === '1.18')).toMatchObject({ node: '77:1', flows: { onboarding: { node: '11:1' } } });
    expect(mine.project!.iterations.find((it) => it.id === '1.18')!.missing).toBeUndefined();
    expect(mine.project!.parked).toEqual({ node: '9:9' });
    expect(list.every((p) => p.cwd.startsWith(ROOTS.chats) || p.cwd.startsWith(ROOTS.projects))).toBe(true);
  });
});
