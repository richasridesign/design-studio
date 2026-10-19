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

const { eventFromBody, readWorkflow, takeAsk, workflowEvent, workflowView } = await import('./workflow.js');
const { mapFiles } = await import('./fileMap.js');
const { historyAfterFigma, instructions } = await import('./options.js');

const OPTS = { preset: 'full' as const, areas: [], reviewing: false };

let n = 0;
/** A project with Flow 3 · Connectors, 1.19 working, and the chat folder of that flow in 1.19. */
async function setup(opts: { screens?: boolean; state?: 'working' | 'frozen'; map?: boolean } = {}) {
  const root = path.join(ROOTS.projects, `p-${++n}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'File', url: 'https://www.figma.com/design/KEY' }));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({
    key: 'KEY',
    flows: [{ n: 3, slug: 'connectors', name: 'Connectors', entry: [] }],
    iterations: [{ id: '1.19', state: opts.state ?? 'working', topic: 'Readiness', flows: { connectors: { node: '50:2' } } }],
  }));
  if (opts.map !== false) {
    const kids = opts.screens === false ? [] : [['F', '50:3', 'Home', 0, 0, 390, 800], ['F', '50:4', 'Detail', 500, 0, 390, 800], ['F', '50:5', 'Start (Entry, unchanged)', 1000, 0, 390, 800]];
    const file = mapFiles(root, 'KEY').json;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ key: 'KEY', name: 'File', readAt: 1, raw: { pages: [['0:1', 'Flows', [['S', '50:2', 'V1.19 · Flow 3 · Connectors', 0, 0, 3000, 2000, kids, 0, 'flow;1.19;connectors']]]] } }));
  }
  const cwd = path.join(root, 'flows', '03-connectors', 'iterations', '1.19');
  await mkdir(cwd, { recursive: true });
  return { root, cwd };
}

describe('workflow.json', () => {
  it('starts at Review with the flow subsection screens, without writing a file', async () => {
    const { cwd } = await setup();
    const v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect(v.state).toMatchObject({ workflow: 'review-update', step: 'review', round: 1 });
    expect(v.screens.frames.map((f) => f.id)).toEqual(['50:3', '50:4']);
    expect(v.card.line).toBe('Reviews 2 screens in 1.19 · Flow 3. Depth: Full, about $0.26.');
    await expect(readFile(path.join(cwd, 'workflow.json'), 'utf8')).rejects.toThrow();
  });

  it('starts From scratch when the flow has no screens anywhere', async () => {
    const { cwd } = await setup({ screens: false });
    expect(await readWorkflow(cwd)).toMatchObject({ workflow: 'scratch', step: 'explore' });
  });

  it('a review run after the step moved counts as reviewed', async () => {
    const { cwd } = await setup();
    await workflowEvent(cwd, { type: 'step', step: 'review', at: 100 });
    await writeFile(path.join(cwd, 'review.json'), JSON.stringify({ runs: [
      { id: 'old', kind: 'review', at: 50, round: 1, preset: 'full', frames: [], check: [], results: [], tokens: 0, costUsd: 0 },
    ] }));
    expect((await readWorkflow(cwd))?.step).toBe('review');
    await writeFile(path.join(cwd, 'review.json'), JSON.stringify({ runs: [
      { id: 'new', kind: 'review', at: 200, round: 1, preset: 'full', frames: [], check: [{ id: 'c', area: 'check', node: '50:3', severity: 'major', rule: 'grid', fix: 'x' }], results: [], tokens: 0, costUsd: 0 },
    ] }));
    const v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect(v.state).toMatchObject({ step: 'update', marks: { review: { state: 'done', at: 200 } } });
    expect(v.card.line).toBe('Review done: 1 major.');
  });

  it('writes events one at a time and keeps them all', async () => {
    const { cwd } = await setup();
    await Promise.all([1, 2, 3].map((i) => workflowEvent(cwd, { type: 'changes', count: 1, screens: [`S${i}`], at: i })));
    const saved = JSON.parse(await readFile(path.join(cwd, 'workflow.json'), 'utf8'));
    expect(saved.work.changes).toBe(3);
    expect(saved.work.screens.sort()).toEqual(['S1', 'S2', 'S3']);
  });

  it('a step ask is used up once, by the chat that asked', async () => {
    const { cwd } = await setup();
    await workflowEvent(cwd, eventFromBody({ action: 'ask', step: 'update' }, 'chat-1', 10));
    expect(await takeAsk(cwd, 'chat-2')).toBeNull();
    expect(await takeAsk(cwd, 'chat-1')).toMatchObject({ step: 'update', chat: 'chat-1' });
    expect(await takeAsk(cwd, 'chat-1')).toBeNull();
    expect((await readWorkflow(cwd))?.step).toBe('update');
  });

  it('a frozen iteration takes no events and offers the next one', async () => {
    const { cwd } = await setup({ state: 'frozen' });
    expect(await workflowEvent(cwd, { type: 'edited', at: 1 })).toBeNull();
    const v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect(v.card.button).toMatchObject({ label: 'Start the next iteration', action: 'next-iteration' });
  });

  it('a chat that is not on a flow has no workflow', async () => {
    const { root } = await setup();
    expect(await workflowView(root, OPTS)).toEqual({ scope: 'none' });
    expect(await workflowEvent(root, { type: 'edited', at: 1 })).toBeNull();
  });

  it('an edit in Figma while Review is current makes Update current, from feedback; a read moves nothing', async () => {
    const { cwd } = await setup();
    const hook = historyAfterFigma(cwd);
    const call = (code: string) => hook({ tool_name: 'use_figma', tool_input: { code } } as never, 'u1', { signal: new AbortController().signal });
    await call('const n = await figma.getNodeByIdAsync("50:3"); return n.name;');
    await new Promise((r) => setTimeout(r, 30));
    await expect(readFile(path.join(cwd, 'workflow.json'), 'utf8')).rejects.toThrow();
    await call('const n = await figma.getNodeByIdAsync("50:3"); n.name = "Home";');
    await vi.waitFor(async () => expect(await readWorkflow(cwd)).toMatchObject({ step: 'update', fromFeedback: true }));
  });

  it('a step ask on a flow with no file yet writes nothing for other chats', async () => {
    const { cwd } = await setup();
    expect(await takeAsk(cwd, 'chat-1')).toBeNull();
    await expect(readFile(path.join(cwd, 'workflow.json'), 'utf8')).rejects.toThrow();
  });

  it('tells flow chats about the workflow, and only them', () => {
    expect(instructions(null, '', null, 'Flow 3 block', '/p/flows/03-connectors/history.md')).toContain('pass stepDone');
    expect(instructions(null)).not.toContain('stepDone');
  });

  it('checks what the UI posts', () => {
    expect(() => eventFromBody({ action: 'nope' }, 'c')).toThrow(/Pick step/);
    expect(() => eventFromBody({ action: 'switch', workflow: 'x' }, 'c')).toThrow(/workflow/);
    expect(() => eventFromBody({ action: 'done' }, 'c')).toThrow(/step/);
    expect(eventFromBody({ action: 'done', step: 'update' }, 'c', 5)).toEqual({ type: 'done', step: 'update', at: 5 });
    expect(eventFromBody({ action: 'pick', id: 'B', why: 'Fewer steps' }, 'c', 5)).toEqual({ type: 'pick', id: 'B', why: 'Fewer steps', at: 5 });
  });
});
