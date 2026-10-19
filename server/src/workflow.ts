import path from 'node:path';
import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  WORKFLOW_FILE, cleanState, defaultState, flowFrames, isStep, isWorkflow, nextState, reviewTally, stepCard, stepViews, workflowLabel,
  type FlowFrames, type ReviewTally, type StepCard, type StepView, type WorkflowEvent, type WorkflowState,
} from '../../shared/workflow.js';
import { PRESET_INFO, roundCost, type Area, type ReviewPreset } from '../../shared/design.js';
import { historyContext, type HistoryContext } from './history.js';
import { cachedMap } from './fileMap.js';
import { readReview } from './review.js';
import { readTriage } from './triage.js';

// workflow.json in a flow chat's folder (flows/NN-slug/iterations/<id>/): the step state of the flow's workflow in
// that iteration, shared by every chat on it. Only this module writes it, one write at a time per file. The file
// watcher sends file_changed for it, so open chats refresh without a broadcast of their own.

export const workflowFile = (cwd: string) => path.join(cwd, WORKFLOW_FILE);

const queues = new Map<string, Promise<unknown>>();

type Flow = { ctx: HistoryContext; frames: FlowFrames; mapRead: boolean };

async function flowOf(cwd: string): Promise<Flow | null> {
  const ctx = await historyContext(cwd).catch(() => null);
  if (!ctx) return null;
  const map = await cachedMap(ctx.root, ctx.project.key).catch(() => null);
  return { ctx, frames: flowFrames(map?.raw.pages, ctx.project, ctx.flow, ctx.iteration.id), mapRead: !!map };
}

const readJson = (file: string) => readFile(file, 'utf8').then(JSON.parse, () => null);

/** The default needs the map: no screens anywhere means From scratch. With no map read yet, Review and update. */
const fallback = (f: Flow) => defaultState(!f.mapRead || f.frames.frames.length > 0);

/**
 * The state on disk, else the default. A review run that finished after the step last moved counts as "reviewed",
 * so a review started anywhere (the card, /review, the Review tab) moves the strip.
 */
async function current(cwd: string, f: Flow): Promise<{ state: WorkflowState; saved: boolean }> {
  const raw = await readJson(workflowFile(cwd));
  let state = cleanState(raw, fallback(f));
  const before = state;
  if (state.workflow === 'review-update') {
    const run = (await readReview(cwd)).runs.filter((r) => r.kind === 'review' && r.at > state.at).sort((a, b) => a.at - b.at).at(-1);
    if (run) state = nextState(state, { type: 'reviewed', at: run.at });
  }
  return { state, saved: !!raw && state === before };
}

function write(cwd: string, fn: (s: WorkflowState) => WorkflowState, f: Flow): Promise<WorkflowState> {
  const file = workflowFile(cwd);
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const { state, saved } = await current(cwd, f);
    const next = fn(state);
    if (next !== state || !saved) {
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${file}.tmp`, file);
    }
    return next;
  });
  queues.set(file, run);
  void run.finally(() => { if (queues.get(file) === run) queues.delete(file); }).catch(() => {});
  return run;
}

/** Applies one event to a flow chat's workflow. Null for a chat that is not on a flow, or a frozen iteration. */
export async function workflowEvent(cwd: string, e: WorkflowEvent): Promise<WorkflowState | null> {
  const f = await flowOf(cwd);
  if (!f || f.ctx.iteration.state === 'frozen') return null;
  return write(cwd, (s) => nextState(s, e), f);
}

/** The state alone (the session's note, the project row tag). Never writes. */
export async function readWorkflow(cwd: string): Promise<WorkflowState | null> {
  const f = await flowOf(cwd);
  return f ? (await current(cwd, f)).state : null;
}

/** Uses up a step button's ask for this chat: the step's prompt rides along once with the chat's next message. */
export async function takeAsk(cwd: string, chat: string): Promise<WorkflowState['ask'] | null> {
  const f = await flowOf(cwd);
  if (!f) return null;
  // Most messages carry no ask: read first, so a flow with no file yet is not written.
  if ((await current(cwd, f)).state.ask?.chat !== chat) return null;
  let ask: WorkflowState['ask'] | null = null;
  await write(cwd, (s) => {
    if (s.ask?.chat !== chat) return s;
    ask = s.ask;
    const { ask: _a, ...rest } = s;
    return rest;
  }, f);
  return ask;
}

/** The screens a review of this flow chat covers (see flowFrames). Empty for a chat that is not on a flow. */
export async function reviewFrames(cwd: string): Promise<string[]> {
  return ((await flowOf(cwd))?.frames.frames ?? []).map((f) => f.id);
}

export type WorkflowView =
  | { scope: 'none' }
  | {
      scope: 'flow';
      flow: { n: number; name: string; slug: string };
      iteration: { id: string; state: 'working' | 'frozen' };
      state: WorkflowState;
      steps: StepView[];
      card: StepCard;
      label: string | null;
      screens: FlowFrames;
      review: ReviewTally | null;
    };

/** What the UI may post. ask: make a step current and send its prompt once with this chat's next message. */
const ACTIONS = ['step', 'done', 'skip', 'again', 'switch', 'pick', 'ask'] as const;

/** What the strip and the step card show. preset and areas are the Review tab's depth in this chat. */
export async function workflowView(cwd: string, opts: { preset: ReviewPreset; areas: Area[]; reviewing: boolean }): Promise<WorkflowView> {
  const f = await flowOf(cwd);
  if (!f) return { scope: 'none' };
  const { state } = await current(cwd, f);
  const review = reviewTally((await readReview(cwd)).runs, await readTriage(cwd));
  const it = f.ctx.iteration;
  const card = stepCard(state, {
    flow: f.ctx.flow,
    iteration: { id: it.id, state: it.state },
    screens: f.frames.frames.length,
    source: f.frames.source,
    cost: roundCost(opts.preset === 'check' ? 'full' : opts.preset, opts.areas),
    depth: PRESET_INFO[opts.preset === 'check' ? 'full' : opts.preset].label,
    review,
    reviewing: opts.reviewing,
    // The design system step's evidence belongs to From scratch, filled in with that workflow.
    system: null,
  });
  return {
    scope: 'flow',
    flow: { n: f.ctx.flow.n, name: f.ctx.flow.name, slug: f.ctx.flow.slug },
    iteration: { id: it.id, state: it.state },
    state,
    steps: stepViews(state),
    card,
    label: workflowLabel(state),
    screens: f.frames,
    review,
  };
}

/** A POST from the strip or the card: { action, step?, workflow?, id?, why? }. */
export function eventFromBody(body: unknown, chat: string, now = Date.now()): WorkflowEvent {
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) throw new Error('Pick step, done, skip, again, switch, pick or ask');
  if (action === 'again') return { type: 'again', at: now };
  if (action === 'switch') {
    if (!isWorkflow(b.workflow)) throw new Error('Pick a workflow: review-update or scratch');
    return { type: 'switch', workflow: b.workflow, at: now };
  }
  if (action === 'pick') {
    if (b.id !== 'A' && b.id !== 'B' && b.id !== 'C') throw new Error('Pick option A, B or C');
    return { type: 'pick', id: b.id, why: typeof b.why === 'string' ? b.why : undefined, at: now };
  }
  if (!isStep(b.step)) throw new Error('Name the step');
  if (action === 'ask') return { type: 'step', step: b.step, at: now, ask: { chat } };
  return { type: action, step: b.step, at: now };
}
