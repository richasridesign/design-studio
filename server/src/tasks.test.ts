import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Tasks, afterRestart, cleanTask, taskFile, type ChatHandle, type HandleState, type StartInput, type TaskDeps } from './tasks.js';
import { rollup, taskFlowPrompt, mentionsComponents, pauseText, modelName, DEFAULT_TASK_MODEL, type Task } from '../../shared/tasks.js';
import type { Project } from '../../shared/project.js';

/** A fake chat: starts running, and the test finishes it, asks a question, or fails it. */
class FakeChat implements ChatHandle {
  s: HandleState = { running: true, pending: 0, error: false, tokens: 0, costUsd: 0, model: null, sessionId: null, closed: false };
  fns = new Set<() => void>();
  stopped = false;
  constructor(public id: string, public input: StartInput) {}
  state() { return this.s; }
  onChange(fn: () => void) { this.fns.add(fn); return () => this.fns.delete(fn); }
  async stop() { this.stopped = true; this.set({ running: false }); }
  set(p: Partial<HandleState>) { this.s = { ...this.s, ...p }; for (const f of this.fns) f(); }
  finish(tokens = 1000, error = false) { this.set({ running: false, tokens, costUsd: tokens / 1e5, error, model: this.input.model, sessionId: `s-${this.id}` }); }
}

const FLOWS = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, slug: `flow-${i + 1}`, name: `Flow ${i + 1}`, entry: [] }));

function project(node: string | null = '50:1'): Project {
  return { key: 'KEY', adoptedAt: 1, flows: FLOWS, iterations: [{ id: '1.18', state: 'frozen', adopted: true }, { id: '1.19', topic: 'Readiness', state: 'working', ...(node ? { node } : {}) }] };
}

async function setup(o: { node?: string | null; parallel?: number; weekly?: () => number | null; sectionReady?: () => Promise<boolean>; failStart?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ds-task-'));
  const chats: FakeChat[] = [];
  let weekly = o.weekly ?? (() => 10);
  const proj = project(o.node === undefined ? '50:1' : o.node);
  const deps: TaskDeps = {
    startChat: async (input) => {
      if (o.failStart && input.cwd.includes(o.failStart)) throw new Error('Figma plugin is not connected');
      const c = new FakeChat(`c${chats.length + 1}`, input);
      chats.push(c);
      return c;
    },
    weeklyPct: () => weekly(),
    parallel: () => o.parallel ?? 3,
    readProject: async () => proj,
    flowFolder: async (r, slug, it) => path.join(r, 'flows', slug, 'iterations', it),
    roots: async () => [root],
    sectionReady: o.sectionReady,
  };
  const tasks = new Tasks(deps);
  const running = () => chats.filter((c) => c.s.running);
  const tick = () => tasks.flushed();
  return { root, tasks, chats, running, tick, setWeekly: (f: () => number | null) => { weekly = f; }, deps };
}

const all = FLOWS.map((f) => f.slug);

describe('run across flows', () => {
  it('runs 8 flows 3 at a time, starting the next when one finishes', async () => {
    const { root, tasks, chats, running, tick } = await setup();
    const t = await tasks.start(root, { prompt: 'Fix the toast offset', flows: all });
    expect(chats).toHaveLength(3);
    expect(t.flows.map((f) => f.state)).toEqual(['running', 'running', 'running', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(rollup(t).line).toBe('0 of 8 done, 3 running');
    chats[0].finish(1200);
    await tick();
    expect(chats).toHaveLength(4);
    expect(running()).toHaveLength(3);
    for (let i = 0; i < 20 && running().length; i++) { running()[0].finish(1000); await tick(); }
    const done = (await tasks.get(t.id))!;
    expect(done.state).toBe('done');
    expect(chats).toHaveLength(8);
    const r = rollup(done);
    expect(r.line).toBe('8 of 8 done');
    expect(r.tokens).toBe(1200 + 7 * 1000);
    expect(done.flows[0]).toMatchObject({ state: 'done', tokens: 1200, sessionId: 's-c1', model: DEFAULT_TASK_MODEL });
    // The task file holds the same state.
    const saved = JSON.parse(await readFile(taskFile(done), 'utf8'));
    expect(saved.state).toBe('done');
    expect(path.dirname(taskFile(done))).toBe(path.join(root, 'iterations', '1.19', 'tasks'));
  });

  it('gives each chat its flow, the task id, Sonnet by default and the prompt first', async () => {
    const { root, tasks, chats } = await setup();
    const t = await tasks.start(root, { prompt: 'Rename Sync now', flows: ['flow-3'] });
    expect(chats[0].input).toMatchObject({ model: DEFAULT_TASK_MODEL, taskId: t.id, cwd: path.join(root, 'flows', 'flow-3', 'iterations', '1.19') });
    expect(chats[0].input.prompt.startsWith('Rename Sync now')).toBe(true);
    expect(chats[0].input.prompt).toContain('Do only Flow 3 · Flow 3');
    expect(chats[0].input.title).toBe('3 · Flow 3: Rename Sync now');
    expect(modelName(DEFAULT_TASK_MODEL)).toBe('Sonnet');
  });

  it('runs on Opus when picked, and records the model the chat reports', async () => {
    const { root, tasks, chats, tick } = await setup();
    const t = await tasks.start(root, { prompt: 'x', flows: ['flow-1'], model: 'claude-opus-5-5' });
    expect(chats[0].input.model).toBe('claude-opus-5-5');
    chats[0].set({ model: 'claude-opus-5-5[1m]' });
    await tick();
    expect((await tasks.get(t.id))!.flows[0].model).toBe('claude-opus-5-5[1m]');
    // An unknown model falls back to Sonnet.
    const t2 = await tasks.start(root, { prompt: 'y', flows: ['flow-2'], model: 'gpt' });
    expect(t2.model).toBe(DEFAULT_TASK_MODEL);
  });

  it('shares the parallel limit across tasks', async () => {
    const { root, tasks, chats } = await setup({ parallel: 3 });
    await tasks.start(root, { prompt: 'a', flows: all.slice(0, 2) });
    const b = await tasks.start(root, { prompt: 'b', flows: all.slice(2, 5) });
    expect(chats).toHaveLength(3);
    expect(b.flows.map((f) => f.state)).toEqual(['running', 'waiting', 'waiting']);
  });

  it('pauses at the 70% weekly cap before a chat starts, and resumes', async () => {
    let pct: number | null = 65;
    const { root, tasks, chats, tick } = await setup({ weekly: () => pct });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 4) });
    expect(chats).toHaveLength(3);
    pct = 71;
    chats[0].finish();
    await tick();
    let now = (await tasks.get(t.id))!;
    expect(now).toMatchObject({ state: 'paused', reason: 'weekly', pausedAt: 71 });
    expect(pauseText(now)).toBe('Weekly usage is at 71%, at or above the 70% cap. Resume when it drops.');
    expect(chats).toHaveLength(3);
    // Resume while still above: it pauses again at once.
    await tasks.resume(t.id);
    expect((await tasks.get(t.id))!.state).toBe('paused');
    pct = 40;
    await tasks.resume(t.id);
    now = (await tasks.get(t.id))!;
    expect(now.state).toBe('running');
    expect(chats).toHaveLength(4);
  });

  it('treats an unknown weekly usage as allowed', async () => {
    const { root, tasks, chats } = await setup({ weekly: () => null });
    await tasks.start(root, { prompt: 'x', flows: all.slice(0, 2) });
    expect(chats).toHaveLength(2);
  });

  it('marks a chat that asks a question as needing her, holding its slot', async () => {
    const { root, tasks, chats, tick } = await setup({ parallel: 1 });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 2) });
    chats[0].set({ pending: 1 });
    await tick();
    expect((await tasks.get(t.id))!.flows.map((f) => f.state)).toEqual(['needs_you', 'waiting']);
    expect(rollup((await tasks.get(t.id))!).line).toBe('0 of 2 done, 1 need you');
    chats[0].set({ pending: 0 });
    chats[0].finish();
    await tick();
    expect(chats).toHaveLength(2);
  });

  it('counts a failed turn and a failed start, and still finishes', async () => {
    const { root, tasks, chats, tick } = await setup({ failStart: 'flow-2' });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 3) });
    expect((await tasks.get(t.id))!.flows[1]).toMatchObject({ state: 'failed', note: 'Figma plugin is not connected' });
    chats[0].finish(500, true);
    chats[1].finish();
    await tick();
    const done = (await tasks.get(t.id))!;
    expect(done.state).toBe('done');
    expect(rollup(done).line).toBe('1 of 3 done, 2 failed');
  });

  it('runs the shared component step alone first, then fans out', async () => {
    const { root, tasks, chats, tick } = await setup();
    const t = await tasks.start(root, { prompt: 'Add a Hover variant to the Toast component', flows: all.slice(0, 4), componentsFirst: true });
    expect(chats).toHaveLength(1);
    expect(chats[0].input.cwd).toBe(path.join(root, 'tasks', `${t.id}-components`));
    expect(chats[0].input.prompt).toContain('shared component step');
    expect(t.components?.state).toBe('running');
    chats[0].finish(3000);
    await tick();
    expect(chats).toHaveLength(4);
    expect(rollup((await tasks.get(t.id))!).tokens).toBe(3000);
  });

  it('pauses when the component step fails, and skips it on resume', async () => {
    const { root, tasks, chats, tick } = await setup();
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 2), componentsFirst: true });
    chats[0].finish(10, true);
    await tick();
    expect((await tasks.get(t.id))!).toMatchObject({ state: 'paused', reason: 'components' });
    await tasks.resume(t.id);
    expect(chats).toHaveLength(3);
  });

  it('runs one flow alone when the iteration has no Figma section yet', async () => {
    let ready = false;
    const { root, tasks, chats, tick } = await setup({ node: null, sectionReady: async () => ready });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 4) });
    expect(chats).toHaveLength(1);
    // The first flow ended but no section showed up: pause rather than let 3 chats make 3 sections.
    chats[0].finish();
    await tick();
    expect((await tasks.get(t.id))!).toMatchObject({ state: 'paused', reason: 'section' });
    // Resume: the next flow runs alone again; this time the section is there, so the rest fan out.
    await tasks.resume(t.id);
    expect(chats).toHaveLength(2);
    ready = true;
    chats[1].finish();
    await tick();
    expect(chats).toHaveLength(4);
  });

  it('pauses by hand: running chats finish, waiting ones wait', async () => {
    const { root, tasks, chats, tick } = await setup({ parallel: 2 });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 4) });
    await tasks.pause(t.id);
    chats[0].finish();
    await tick();
    expect(chats).toHaveLength(2);
    expect((await tasks.get(t.id))!.state).toBe('paused');
    await tasks.resume(t.id);
    expect(chats).toHaveLength(3);
  });

  it('stops every chat and every waiting flow', async () => {
    const { root, tasks, chats, tick } = await setup({ parallel: 2 });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 4) });
    await tasks.stop(t.id);
    await tick();
    const s = (await tasks.get(t.id))!;
    expect(s.state).toBe('stopped');
    expect(s.flows.map((f) => f.state)).toEqual(['stopped', 'stopped', 'stopped', 'stopped']);
    expect(chats.every((c) => c.stopped)).toBe(true);
    expect(chats).toHaveLength(2);
  });

  it('settles a flow whose chat was closed', async () => {
    const { root, tasks, chats, tick } = await setup({ parallel: 1 });
    const t = await tasks.start(root, { prompt: 'x', flows: all.slice(0, 2) });
    tasks.chatClosed(chats[0].id);
    await tick();
    const s = (await tasks.get(t.id))!;
    expect(s.flows[0]).toMatchObject({ state: 'stopped', note: 'The chat was closed' });
    expect(chats).toHaveLength(2);
  });

  it('refuses a task with no prompt, no flow or no working iteration', async () => {
    const { root, tasks, deps } = await setup();
    await expect(tasks.start(root, { prompt: ' ', flows: all })).rejects.toThrow('Write the prompt first');
    await expect(tasks.start(root, { prompt: 'x', flows: [] })).rejects.toThrow('Pick at least one flow');
    await expect(tasks.start(root, { prompt: 'x', flows: all, iteration: '1.18' })).rejects.toThrow('frozen');
    deps.readProject = async () => ({ ...project(), iterations: [] });
    await expect(tasks.start(root, { prompt: 'x', flows: all })).rejects.toThrow('no working iteration');
  });

  it('after a restart, open flows stop and the task pauses', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ds-task-'));
    const dir = path.join(root, 'iterations', '1.19', 'tasks');
    await mkdir(dir, { recursive: true });
    const saved = { id: 't1', root, key: 'KEY', iteration: '1.19', prompt: 'x', model: DEFAULT_TASK_MODEL, cap: 70, componentsFirst: false, components: null, state: 'running', createdAt: 1, updatedAt: 1,
      flows: [{ slug: 'a', n: 1, name: 'A', state: 'done', model: DEFAULT_TASK_MODEL, tokens: 5, costUsd: 0 }, { slug: 'b', n: 2, name: 'B', state: 'running', chatId: 'c9', model: DEFAULT_TASK_MODEL, tokens: 3, costUsd: 0 }, { slug: 'c', n: 3, name: 'C', state: 'waiting', model: DEFAULT_TASK_MODEL, tokens: 0, costUsd: 0 }] };
    await writeFile(path.join(dir, 't1.json'), JSON.stringify(saved));
    const tasks = new Tasks({ startChat: async () => { throw new Error('no'); }, weeklyPct: () => 0, parallel: () => 3, readProject: async () => project(), flowFolder: async () => root, roots: async () => [root] });
    const [t] = await tasks.list();
    expect(t).toMatchObject({ state: 'paused', reason: 'restart' });
    expect(t.flows.map((f) => f.state)).toEqual(['done', 'stopped', 'waiting']);
    expect(t.flows[1].note).toBe('Stopped by a restart');
    expect(t.flows[1].chatId).toBeUndefined();
    await tasks.flushed();
    expect(JSON.parse(await readFile(path.join(dir, 't1.json'), 'utf8')).state).toBe('paused');
    expect(await readdir(dir)).toEqual(['t1.json']);
  });
});

describe('task helpers', () => {
  it('cleans saved tasks', () => {
    expect(cleanTask(null)).toBeNull();
    expect(cleanTask({ id: 'x', root: '/r', flows: [{ slug: 'a', state: 'bogus' }] })!.flows[0].state).toBe('waiting');
  });
  it('a finished task stays as it is after a restart', () => {
    const t = { state: 'done', flows: [], components: null } as unknown as Task;
    expect(afterRestart(t).state).toBe('done');
  });
  it('ticks "components first" when the prompt names shared parts', () => {
    expect(mentionsComponents('Add a hover variant to the toast')).toBe(true);
    expect(mentionsComponents('Fix the Button component')).toBe(true);
    expect(mentionsComponents('Shorten the subtitle')).toBe(false);
  });
  it('builds the flow prompt', () => {
    expect(taskFlowPrompt(' Fix it ', { n: 2, name: 'Home' }, 1, '1.2')).toContain('across 1 flow in iteration 1.2. Do only Flow 2 · Home');
  });
});
