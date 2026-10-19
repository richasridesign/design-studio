import path from 'node:path';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cleanId, workingIteration, type Project } from '../../shared/project.js';
import {
  COMPONENTS_SLUG, MAX_TASK_PROMPT, TASK_CAP, componentsPrompt, isOpen, taskFlowPrompt, taskId as makeId, taskModel,
  type PauseReason, type Task, type TaskFlow, type TaskFlowState,
} from '../../shared/tasks.js';

// Runs one prompt across several flows of an iteration: one chat per flow, at most `parallel()` chats at a time
// across every task, the rest waiting in the task file until a slot opens. Before each chat starts the weekly usage
// is checked, and the task pauses at the cap. A "components first" step runs alone before the flows. When the
// iteration has no Figma section yet, the first flow runs alone so only one chat makes it.
//
// The task file is <root>/iterations/<id>/tasks/<task id>.json. Chats run in their flow's iteration folder, so each
// one keeps its own plan, review and spend, and every Figma edit goes through the file's write lock (session.ts).

export type HandleState = { running: boolean; pending: number; error: boolean; tokens: number; costUsd: number; model: string | null; sessionId: string | null; closed: boolean };

/** A started chat, as the runner sees it. The server wraps an AgentSession; tests pass a fake. */
export type ChatHandle = {
  id: string;
  state(): HandleState;
  /** Called on any change of the chat; returns the unsubscribe. */
  onChange(fn: () => void): () => void;
  stop(): Promise<void>;
};

export type StartInput = { cwd: string; model: string; prompt: string; taskId: string; title: string };

export type TaskDeps = {
  startChat(i: StartInput): Promise<ChatHandle>;
  /** The highest weekly window in percent, or null when no limit event was seen yet (then nothing is blocked). */
  weeklyPct(): number | null;
  parallel(): number;
  readProject(root: string): Promise<Project | null>;
  /** The folder a flow's chat runs in (made when new). */
  flowFolder(root: string, slug: string, iteration: string): Promise<string>;
  /** Project roots to read saved tasks from, once, after a restart. */
  roots(): Promise<string[]>;
  /** Reads the map again after the first flow ran; true when the iteration has its Figma section now. */
  sectionReady?(root: string, key: string, iteration: string): Promise<boolean>;
  onChange?(t: Task): void;
  now?(): number;
};

export type StartTaskInput = { prompt: string; flows: string[]; model?: string; componentsFirst?: boolean; iteration?: string };

export const tasksFolder = (root: string, iteration: string) => path.join(root, 'iterations', iteration, 'tasks');
export const taskFile = (t: Pick<Task, 'root' | 'iteration' | 'id'>) => path.join(tasksFolder(t.root, t.iteration), `${t.id}.json`);
export const componentsFolder = (root: string, id: string) => path.join(root, 'tasks', `${id}-components`);

const STATES: TaskFlowState[] = ['waiting', 'running', 'needs_you', 'done', 'failed', 'stopped'];

/** Keeps a saved task readable after a hand edit or an older shape. */
export function cleanTask(o: any): Task | null {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || typeof o.root !== 'string' || !Array.isArray(o.flows)) return null;
  const flow = (f: any): TaskFlow => ({
    slug: String(f?.slug ?? ''),
    n: Number(f?.n) || 0,
    name: String(f?.name ?? ''),
    state: STATES.includes(f?.state) ? f.state : 'waiting',
    model: String(f?.model ?? taskModel(o.model)),
    tokens: Number(f?.tokens) || 0,
    costUsd: Number(f?.costUsd) || 0,
    ...(typeof f?.cwd === 'string' ? { cwd: f.cwd } : {}),
    ...(typeof f?.chatId === 'string' ? { chatId: f.chatId } : {}),
    ...(typeof f?.sessionId === 'string' ? { sessionId: f.sessionId } : {}),
    ...(Number.isFinite(f?.startedAt) ? { startedAt: f.startedAt } : {}),
    ...(Number.isFinite(f?.endedAt) ? { endedAt: f.endedAt } : {}),
    ...(typeof f?.note === 'string' ? { note: f.note } : {}),
  });
  return {
    id: o.id,
    root: o.root,
    key: String(o.key ?? ''),
    iteration: String(o.iteration ?? ''),
    prompt: String(o.prompt ?? ''),
    model: taskModel(o.model),
    cap: Number(o.cap) || TASK_CAP,
    componentsFirst: Boolean(o.componentsFirst),
    components: o.components ? flow(o.components) : null,
    flows: o.flows.map(flow),
    state: ['running', 'paused', 'done', 'stopped'].includes(o.state) ? o.state : 'paused',
    ...(o.reason ? { reason: o.reason } : {}),
    ...(Number.isFinite(o.pausedAt) ? { pausedAt: o.pausedAt } : {}),
    ...(o.needsSection ? { needsSection: true } : {}),
    ...(Number.isFinite(o.leads) ? { leads: o.leads } : {}),
    createdAt: Number(o.createdAt) || 0,
    updatedAt: Number(o.updatedAt) || 0,
  } as Task;
}

/** What a saved task becomes after a restart: its chats are gone, so open flows stop and the task pauses. */
export function afterRestart(t: Task): Task {
  const stop = (f: TaskFlow): TaskFlow => (isOpen(f.state) ? { ...f, state: 'stopped', note: 'Stopped by a restart', chatId: undefined } : { ...f, chatId: undefined });
  const flows = t.flows.map(stop);
  const components = t.components ? stop(t.components) : null;
  if (t.state !== 'running' && t.state !== 'paused') return { ...t, flows, components };
  const waiting = flows.some((f) => f.state === 'waiting') || components?.state === 'waiting';
  return { ...t, flows, components, state: waiting ? 'paused' : 'done', ...(waiting ? { reason: 'restart' as PauseReason } : { reason: undefined }) };
}

type Internal = Task;
type Watch = { handle: ChatHandle; off: () => void; saw: boolean };

export class Tasks {
  private tasks = new Map<string, Internal>();
  private watches = new Map<string, Watch>();
  private starting = 0;
  private loaded: Promise<void> | null = null;
  private pumping: Promise<void> = Promise.resolve();
  private writes = new Map<string, Promise<void>>();

  constructor(private deps: TaskDeps) {}

  private now = () => (this.deps.now ?? Date.now)();

  private load() {
    this.loaded ??= (async () => {
      for (const root of await this.deps.roots().catch(() => [] as string[])) {
        const its = await readdir(path.join(root, 'iterations')).catch(() => [] as string[]);
        for (const it of its) {
          const dir = tasksFolder(root, it);
          for (const name of await readdir(dir).catch(() => [] as string[])) {
            if (!name.endsWith('.json')) continue;
            const t = cleanTask(await readFile(path.join(dir, name), 'utf8').then(JSON.parse).catch(() => null));
            if (!t || this.tasks.has(t.id)) continue;
            const next = afterRestart(t);
            this.tasks.set(t.id, next);
            if (JSON.stringify(next) !== JSON.stringify(t)) void this.save(next);
          }
        }
      }
    })();
    return this.loaded;
  }

  async list(root?: string): Promise<Task[]> {
    await this.load();
    return [...this.tasks.values()].filter((t) => !root || t.root === root).sort((a, b) => b.createdAt - a.createdAt).map(publicTask);
  }

  async get(id: string): Promise<Task | null> {
    await this.load();
    const t = this.tasks.get(id);
    return t ? publicTask(t) : null;
  }

  /** Busy chat slots across every task (the ones starting count too). */
  busy() {
    let n = this.starting;
    for (const t of this.tasks.values()) for (const f of [...(t.components ? [t.components] : []), ...t.flows]) if (isOpen(f.state)) n++;
    return n;
  }

  async start(root: string, input: StartTaskInput): Promise<Task> {
    await this.load();
    const prompt = String(input.prompt ?? '').trim().slice(0, MAX_TASK_PROMPT);
    if (!prompt) throw new Error('Write the prompt first');
    const project = await this.deps.readProject(root);
    if (!project) throw new Error('This file has no flows yet. Adopt it first from the sidebar.');
    const it = input.iteration ? project.iterations.find((x) => x.id === cleanId(input.iteration!)) : workingIteration(project);
    if (!it) throw new Error('There is no working iteration. Create one first (New iteration).');
    if (it.state !== 'working') throw new Error(`Iteration ${it.id} is frozen. Reopen it or create a new iteration.`);
    const slugs = new Set(input.flows ?? []);
    const flows = project.flows.filter((f) => slugs.has(f.slug));
    if (!flows.length) throw new Error('Pick at least one flow');
    const model = taskModel(input.model);
    const now = this.now();
    const blank = (slug: string, n: number, name: string): TaskFlow => ({ slug, n, name, state: 'waiting', model, tokens: 0, costUsd: 0 });
    const t: Internal = {
      id: makeId(new Date(now)),
      root,
      key: project.key,
      iteration: it.id,
      prompt,
      model,
      cap: TASK_CAP,
      componentsFirst: Boolean(input.componentsFirst),
      components: input.componentsFirst ? blank(COMPONENTS_SLUG, 0, 'Shared components') : null,
      flows: flows.map((f) => blank(f.slug, f.n, f.name)),
      state: 'running',
      createdAt: now,
      updatedAt: now,
      ...(it.node ? {} : { needsSection: flows.length > 1 }),
    };
    this.tasks.set(t.id, t);
    await this.save(t);
    await this.pump();
    return publicTask(this.tasks.get(t.id)!);
  }

  async pause(id: string) {
    const t = await this.must(id);
    if (t.state === 'running') this.update(t, { state: 'paused', reason: 'user' });
    return publicTask(t);
  }

  async resume(id: string) {
    const t = await this.must(id);
    if (t.state !== 'paused') return publicTask(t);
    const patch: Partial<Internal> = { state: 'running', reason: undefined, pausedAt: undefined };
    // A failed or stopped component step is skipped on resume: she looked at it and chose to go on.
    if (t.reason === 'components' && t.components && !isOpen(t.components.state) && t.components.state !== 'done') patch.componentsFirst = false;
    this.update(t, patch);
    await this.pump();
    return publicTask(this.tasks.get(id)!);
  }

  async stop(id: string) {
    const t = await this.must(id);
    if (t.state === 'done' || t.state === 'stopped') return publicTask(t);
    const end = this.now();
    const halt = async (f: TaskFlow) => {
      if (f.state === 'waiting') return { ...f, state: 'stopped' as const, endedAt: end };
      if (!isOpen(f.state)) return f;
      const w = this.watches.get(`${t.id}#${f.slug}`);
      await w?.handle.stop().catch(() => {});
      return { ...f, state: 'stopped' as const, endedAt: end, note: 'Stopped by you' };
    };
    // The task is stopped first, so a chat that settles while it is being interrupted never starts the next one.
    this.update(t, { state: 'stopped', reason: undefined });
    const components = t.components ? await halt(t.components) : null;
    const flows = await Promise.all(t.flows.map(halt));
    this.update(t, { components, flows });
    for (const f of [...flows, ...(components ? [components] : [])]) this.unwatch(`${t.id}#${f.slug}`);
    return publicTask(t);
  }

  /** The server closed a chat (she closed it, or it went idle): an open flow on it settles from its last state. */
  chatClosed(chatId: string) {
    for (const t of this.tasks.values()) {
      for (const f of [...(t.components ? [t.components] : []), ...t.flows]) {
        if (f.chatId !== chatId) continue;
        if (isOpen(f.state)) this.settle(t, f.slug, { state: 'stopped', note: 'The chat was closed' });
        else this.patchFlow(t, f.slug, { chatId: undefined });
      }
    }
  }

  private async must(id: string) {
    await this.load();
    const t = this.tasks.get(id);
    if (!t) throw new Error('Task not found');
    return t;
  }

  private update(t: Internal, patch: Partial<Internal>) {
    Object.assign(t, patch, { updatedAt: this.now() });
    for (const k of Object.keys(patch) as Array<keyof Internal>) if (patch[k] === undefined) delete t[k];
    void this.save(t);
    this.deps.onChange?.(publicTask(t));
  }

  private patchFlow(t: Internal, slug: string, patch: Partial<TaskFlow>) {
    const fix = (f: TaskFlow) => {
      const next = { ...f, ...patch };
      for (const k of Object.keys(patch) as Array<keyof TaskFlow>) if (patch[k] === undefined) delete next[k];
      return next;
    };
    if (t.components?.slug === slug && slug === COMPONENTS_SLUG) this.update(t, { components: fix(t.components) });
    else this.update(t, { flows: t.flows.map((f) => (f.slug === slug ? fix(f) : f)) });
  }

  private flowOf(t: Internal, slug: string) {
    return slug === COMPONENTS_SLUG && t.components ? t.components : t.flows.find((f) => f.slug === slug);
  }

  private settle(t: Internal, slug: string, patch: Partial<TaskFlow>) {
    this.patchFlow(t, slug, { ...patch, endedAt: this.now() });
    this.unwatch(`${t.id}#${slug}`);
    void this.pump();
  }

  private unwatch(key: string) {
    this.watches.get(key)?.off();
    this.watches.delete(key);
  }

  /** One pass at a time: starts what fits, pauses at the cap, finishes tasks with nothing left. */
  pump(): Promise<void> {
    this.pumping = this.pumping.then(() => this.pass()).catch((err) => console.error('tasks:', err));
    return this.pumping;
  }

  private async pass() {
    const running = [...this.tasks.values()].filter((t) => t.state === 'running').sort((a, b) => a.createdAt - b.createdAt);
    for (const t of running) {
      const c = t.components;
      if (t.componentsFirst && c && c.state !== 'done') {
        if (c.state === 'waiting') await this.launch(t, c);
        else if (!isOpen(c.state)) this.update(t, { state: 'paused', reason: 'components' });
        continue;
      }
      if (t.needsSection) {
        // The first flow runs alone and makes the iteration section; the rest wait until the map shows it.
        if (t.flows.some((f) => isOpen(f.state))) continue;
        const finished = t.flows.filter((f) => f.state !== 'waiting').length;
        if (finished > (t.leads ?? 0)) {
          const ready = await this.deps.sectionReady?.(t.root, t.key, t.iteration).catch(() => false);
          if (ready) this.update(t, { needsSection: undefined, leads: undefined });
          else {
            this.update(t, { leads: finished });
            if (t.flows.some((f) => f.state === 'waiting')) this.update(t, { state: 'paused', reason: 'section' });
            else this.finishIfDone(t);
            continue;
          }
        }
        if (t.needsSection) {
          const next = t.flows.find((f) => f.state === 'waiting');
          if (next) await this.launch(t, next);
          this.finishIfDone(t);
          continue;
        }
      }
      for (const f of t.flows) {
        if (t.state !== 'running') break;
        if (f.state !== 'waiting') continue;
        if (this.busy() >= Math.max(1, this.deps.parallel())) break;
        await this.launch(t, f);
      }
      this.finishIfDone(t);
    }
  }

  private finishIfDone(t: Internal) {
    if (t.state !== 'running') return;
    const left = t.flows.some((f) => f.state === 'waiting' || isOpen(f.state)) || (t.components && isOpen(t.components.state));
    if (!left) this.update(t, { state: 'done', reason: undefined, needsSection: undefined });
  }

  /** Checks the cap, starts the chat, and follows it until it settles. */
  private async launch(t: Internal, f: TaskFlow) {
    if (t.state !== 'running') return;
    const pct = this.deps.weeklyPct();
    if (pct !== null && pct >= t.cap) return this.update(t, { state: 'paused', reason: 'weekly', pausedAt: pct });
    this.starting++;
    const key = `${t.id}#${f.slug}`;
    try {
      const total = t.flows.length;
      const cwd = f.slug === COMPONENTS_SLUG ? componentsFolder(t.root, t.id) : await this.deps.flowFolder(t.root, f.slug, t.iteration);
      if (f.slug === COMPONENTS_SLUG) await mkdir(cwd, { recursive: true });
      const prompt = f.slug === COMPONENTS_SLUG ? componentsPrompt(t.prompt, t.flows, t.iteration) : taskFlowPrompt(t.prompt, f, total, t.iteration);
      const title = `${f.slug === COMPONENTS_SLUG ? 'Components' : `${f.n} · ${f.name}`}: ${t.prompt.split('\n')[0].slice(0, 60)}`;
      this.patchFlow(t, f.slug, { state: 'running', cwd, startedAt: this.now(), note: undefined });
      const handle = await this.deps.startChat({ cwd, model: f.model || t.model, prompt, taskId: t.id, title });
      const w: Watch = { handle, saw: false, off: () => {} };
      this.watches.set(key, w);
      this.patchFlow(t, f.slug, { chatId: handle.id });
      w.off = handle.onChange(() => this.observe(t, f.slug, w));
      this.observe(t, f.slug, w);
    } catch (err) {
      this.patchFlow(t, f.slug, { state: 'failed', endedAt: this.now(), note: (err as Error).message.slice(0, 200) });
    } finally {
      this.starting--;
    }
  }

  private observe(t: Internal, slug: string, w: Watch) {
    if (this.watches.get(`${t.id}#${slug}`) !== w) return;
    const f = this.flowOf(t, slug);
    if (!f || !isOpen(f.state)) return;
    const s = w.handle.state();
    if (s.running) w.saw = true;
    const facts: Partial<TaskFlow> = {};
    if (s.tokens !== f.tokens) facts.tokens = s.tokens;
    if (s.costUsd !== f.costUsd) facts.costUsd = s.costUsd;
    if (s.model && s.model !== f.model) facts.model = s.model;
    if (s.sessionId && s.sessionId !== f.sessionId) facts.sessionId = s.sessionId;
    if (s.closed) return this.settle(t, slug, { ...facts, state: 'stopped', note: 'The chat was closed' });
    const state: TaskFlowState = s.pending > 0 ? 'needs_you' : s.running || !w.saw ? 'running' : s.error ? 'failed' : 'done';
    if (state === 'done' || state === 'failed') return this.settle(t, slug, { ...facts, state, ...(state === 'failed' ? { note: 'The last turn ended with an error' } : {}) });
    if (state !== f.state) facts.state = state;
    if (Object.keys(facts).length) this.patchFlow(t, slug, facts);
  }

  /** Writes the task file, one write at a time per task, the last state always winning. */
  private save(t: Task) {
    const snap = JSON.stringify(publicTask(t), null, 2);
    const file = taskFile(t);
    const run = (this.writes.get(t.id) ?? Promise.resolve()).then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, snap);
      await rename(`${file}.tmp`, file);
    }).catch((err) => console.error('task save:', err.message));
    this.writes.set(t.id, run);
    return run;
  }

  /**
   * Remove project: stops every open task on the root, waits for their file writes and drops them from memory, so a
   * chat that closes afterwards never writes a task file into the moved folder. Returns how many were open.
   */
  async forget(root: string): Promise<number> {
    await this.load();
    const mine = [...this.tasks.values()].filter((t) => t.root === root);
    const open = mine.filter((t) => t.state === 'running' || t.state === 'paused');
    for (const t of open) await this.stop(t.id);
    await this.flushed();
    for (const t of mine) { this.tasks.delete(t.id); this.writes.delete(t.id); }
    return open.length;
  }

  /** For tests: every pending file write done. */
  async flushed() {
    await this.pumping;
    await Promise.all(this.writes.values());
  }
}

const publicTask = (t: Task): Task => JSON.parse(JSON.stringify(t));
