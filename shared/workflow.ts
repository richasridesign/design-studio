// Workflows: the steps a flow chat takes in one iteration. Two of them: Review and update (the default for a flow
// with screens) and From scratch (a flow with no screens anywhere). The state sits in workflow.json in the flow's
// iteration folder, so every chat on that flow and iteration shares it. Steps are a guide, never a gate: any step
// can be made current at any time. Pure: the server reads and writes the file, the UI only renders the view.

import { unpackTag, compareIds, type Flow, type MapPages, type MapRow, type Project } from './project.js';
import type { ReviewRun, Severity } from './design.js';
import { splitRun, type Triage } from './triage.js';

export const WORKFLOW_FILE = 'workflow.json';

export const WORKFLOW_IDS = ['review-update', 'scratch'] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];
export const STEP_IDS = ['review', 'update', 'explore', 'pick', 'hifi', 'system', 'iterate'] as const;
export type StepId = (typeof STEP_IDS)[number];

export const WORKFLOW_STEPS: Record<WorkflowId, StepId[]> = {
  'review-update': ['review', 'update'],
  scratch: ['explore', 'pick', 'hifi', 'system', 'iterate'],
};

export const WORKFLOW_INFO: Record<WorkflowId, { name: string; detail: string }> = {
  'review-update': { name: 'Review and update', detail: 'Review the screens, then update them. Or just give feedback.' },
  scratch: { name: 'From scratch', detail: 'Explore 2 or 3 low fidelity options, then high fidelity and a design system.' },
};

export const STEP_NAME: Record<StepId, string> = {
  review: 'Review',
  update: 'Update',
  explore: 'Explore',
  pick: 'Pick',
  hifi: 'High fidelity',
  system: 'Design system',
  iterate: 'Keep iterating',
};

export type StepMark = { state: 'done' | 'skipped'; at: number };
export type OptionId = 'A' | 'B' | 'C';
export type WorkOption = { id: OptionId; name: string; node: string };

export type WorkflowState = {
  workflow: WorkflowId;
  step: StepId;
  round: number;
  /** Marks of this round only: a new round starts with none. */
  marks: Partial<Record<StepId, StepMark>>;
  /** Update became current because a turn edited Figma, not from a review. */
  fromFeedback?: boolean;
  /** When the step last changed. */
  at: number;
  /** A step button asked for its prompt: the next message of that chat carries the step's instruction once. */
  ask?: { step: StepId; at: number; chat: string };
  /** What set_status changes reported this round: how many, on which screens. */
  work?: { changes: number; screens: string[] };
  /** Explore's low fidelity options, from set_status options. */
  options?: WorkOption[];
  picked?: { id: OptionId; why?: string };
  /** The last review stopped with an error. Cleared when the step moves or a review starts again. */
  failed?: { at: number; reason: string };
};

export type WorkflowEvent =
  | { type: 'step'; step: StepId; at: number; ask?: { chat: string } }
  | { type: 'done'; step: StepId; at: number }
  | { type: 'skip'; step: StepId; at: number }
  | { type: 'reviewed'; at: number }
  | { type: 'edited'; at: number }
  | { type: 'again'; at: number }
  | { type: 'switch'; workflow: WorkflowId; at: number }
  | { type: 'changes'; count: number; screens: string[]; at: number }
  | { type: 'options'; options: WorkOption[]; at: number }
  | { type: 'pick'; id: OptionId; why?: string; at: number }
  | { type: 'failed'; reason: string; at: number };

export const isWorkflow = (v: unknown): v is WorkflowId => WORKFLOW_IDS.includes(v as WorkflowId);
export const isStep = (v: unknown): v is StepId => STEP_IDS.includes(v as StepId);

/** A missing file: Review and update at Review, or From scratch at Explore when the flow has no screens anywhere. */
export function defaultState(hasScreens: boolean, at = 0): WorkflowState {
  return hasScreens ? { workflow: 'review-update', step: 'review', round: 1, marks: {}, at } : { workflow: 'scratch', step: 'explore', round: 1, marks: {}, at };
}

const MAX_SCREENS = 40;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isOption = (v: unknown): v is OptionId => v === 'A' || v === 'B' || v === 'C';
export const WHY_MAX = 160;

function cleanOptions(v: unknown): WorkOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: WorkOption[] = [];
  for (const o of v as Array<Record<string, unknown>>) {
    if (!o || !isOption(o.id) || out.some((x) => x.id === o.id)) continue;
    const name = text(o.name, 60);
    if (name) out.push({ id: o.id, name, node: text(o.node, 40) });
  }
  return out.length ? out.sort((a, b) => a.id.localeCompare(b.id)) : undefined;
}

/** Reads workflow.json. Anything broken falls back to the default, so a bad file never hides the strip. */
export function cleanState(input: unknown, fallback: WorkflowState): WorkflowState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const o = input as Record<string, unknown>;
  if (!isWorkflow(o.workflow)) return fallback;
  const workflow = o.workflow;
  const steps = WORKFLOW_STEPS[workflow];
  const step = isStep(o.step) && steps.includes(o.step) ? o.step : steps[0];
  const round = Math.min(99, Math.max(1, Math.round(num(o.round)) || 1));
  const marks: WorkflowState['marks'] = {};
  const m = o.marks && typeof o.marks === 'object' && !Array.isArray(o.marks) ? (o.marks as Record<string, { state?: unknown; at?: unknown }>) : {};
  for (const id of steps) {
    const v = m[id];
    if (v && (v.state === 'done' || v.state === 'skipped') && num(v.at)) marks[id] = { state: v.state, at: num(v.at) };
  }
  const out: WorkflowState = { workflow, step, round, marks, at: num(o.at) };
  if (o.fromFeedback === true && step === 'update') out.fromFeedback = true;
  const ask = o.ask as { step?: unknown; at?: unknown; chat?: unknown } | undefined;
  if (ask && isStep(ask.step) && num(ask.at) && text(ask.chat, 80)) out.ask = { step: ask.step, at: num(ask.at), chat: text(ask.chat, 80) };
  const work = o.work as { changes?: unknown; screens?: unknown } | undefined;
  if (work && num(work.changes) > 0) out.work = { changes: Math.round(num(work.changes)), screens: Array.isArray(work.screens) ? work.screens.map((s) => text(s, 160)).filter(Boolean).slice(0, MAX_SCREENS) : [] };
  const options = cleanOptions(o.options);
  if (options) out.options = options;
  const picked = o.picked as { id?: unknown; why?: unknown } | undefined;
  if (picked && isOption(picked.id)) out.picked = text(picked.why, WHY_MAX) ? { id: picked.id, why: text(picked.why, WHY_MAX) } : { id: picked.id };
  const failed = o.failed as { at?: unknown; reason?: unknown } | undefined;
  if (failed && num(failed.at) && text(failed.reason, 200)) out.failed = { at: num(failed.at), reason: text(failed.reason, 200) };
  return out;
}

const following = (w: WorkflowId, step: StepId): StepId | null => {
  const list = WORKFLOW_STEPS[w];
  return list[list.indexOf(step) + 1] ?? null;
};

/**
 * How the steps move, from what the app sees:
 * - a review run for this flow iteration finishes: Review is done and Update becomes current;
 * - a turn that edited Figma while Review is current, or after Update was done: Update becomes current, from feedback
 *   (after a done Update that starts the next round);
 * - Mark done or set_status stepDone: that step is done, and the next one becomes current;
 * - set_status options: Explore is done and Pick is current; a pick: Pick is done, High fidelity is current.
 * Events for the other workflow's steps are ignored.
 */
export function nextState(s: WorkflowState, e: WorkflowEvent): WorkflowState {
  const steps = WORKFLOW_STEPS[s.workflow];
  const moved = (step: StepId, extra: Partial<WorkflowState> = {}): WorkflowState => {
    const { fromFeedback: _f, failed: _x, ...rest } = s;
    return { ...rest, step, at: e.at, ...extra };
  };
  switch (e.type) {
    case 'step': {
      if (!steps.includes(e.step)) return s;
      const next = moved(e.step);
      if (e.ask) next.ask = { step: e.step, at: e.at, chat: e.ask.chat };
      return next;
    }
    case 'done':
    case 'skip': {
      if (!steps.includes(e.step)) return s;
      const marks = { ...s.marks, [e.step]: { state: e.type === 'done' ? 'done' : 'skipped', at: e.at } as StepMark };
      const after = e.step === s.step ? following(s.workflow, e.step) : null;
      return after ? moved(after, { marks }) : { ...s, marks, at: e.at };
    }
    case 'reviewed':
      if (s.workflow !== 'review-update') return s;
      // A review after a done Update is the next round's review.
      if (s.marks.update?.state === 'done') return { workflow: s.workflow, round: s.round + 1, marks: { review: { state: 'done', at: e.at } }, step: 'update', at: e.at };
      return moved('update', { marks: { ...s.marks, review: { state: 'done', at: e.at } } });
    case 'edited':
      if (s.workflow !== 'review-update') return s;
      if (s.marks.update?.state === 'done') return { workflow: s.workflow, round: s.round + 1, marks: {}, step: 'update', fromFeedback: true, at: e.at };
      if (s.step === 'review') return { ...moved('update'), fromFeedback: true };
      return s;
    case 'again':
      return { workflow: s.workflow, round: s.round + 1, marks: {}, step: steps[0], at: e.at };
    case 'switch':
      if (e.workflow === s.workflow) return s;
      return { workflow: e.workflow, step: WORKFLOW_STEPS[e.workflow][0], round: 1, marks: {}, at: e.at };
    case 'changes': {
      const screens = [...new Set([...(s.work?.screens ?? []), ...e.screens.map((x) => text(x, 160)).filter(Boolean)])].slice(0, MAX_SCREENS);
      return { ...s, work: { changes: (s.work?.changes ?? 0) + Math.max(0, Math.round(e.count)), screens } };
    }
    case 'options': {
      if (s.workflow !== 'scratch') return s;
      const options = cleanOptions(e.options);
      if (!options) return s;
      const { picked: _p, ...rest } = s;
      if (s.step !== 'explore') return { ...rest, options, at: e.at };
      return { ...rest, options, step: 'pick', marks: { ...s.marks, explore: { state: 'done', at: e.at } }, at: e.at };
    }
    case 'pick': {
      if (s.workflow !== 'scratch') return s;
      const why = text(e.why, WHY_MAX);
      if (!s.options?.some((o) => o.id === e.id)) return s;
      return moved('hifi', { marks: { ...s.marks, explore: s.marks.explore ?? { state: 'done', at: e.at }, pick: { state: 'done', at: e.at } }, picked: why ? { id: e.id, why } : { id: e.id } });
    }
    case 'failed':
      return { ...s, failed: { at: e.at, reason: text(e.reason, 200) || 'unknown error' } };
  }
}

/** True when the strip shows nothing done yet, so a workflow switch needs no confirm. */
export const nothingDone = (s: WorkflowState) => s.round === 1 && !Object.keys(s.marks).length && !s.work && !s.options && !s.fromFeedback;

// ---------- Which screens a flow's review covers ----------

export type FrameSource =
  | { kind: 'iteration'; iteration: string; node: string }
  | { kind: 'older'; iteration: string; node: string }
  | { kind: 'baseline'; node: string }
  | { kind: 'none' };
export type FlowFrames = { frames: Array<{ id: string; name: string }>; source: FrameSource };

const ENTRY = /\(entry, unchanged\)/i;
const STICKY = /^\s*decision\s*\d+\s*[·•:|-]/i;

function rowsOf(pages: MapPages): Map<string, MapRow> {
  const rows = new Map<string, MapRow>();
  for (const [, , top] of pages) {
    const walk = (n: MapRow) => {
      rows.set(n[1], n);
      for (const k of n[7] ?? []) walk(k);
    };
    for (const n of top) walk(n);
  }
  return rows;
}

/** The screens directly inside a section: frames and components, without entry copies and Decision stickies. */
export const screensIn = (row: MapRow | undefined) =>
  (row?.[7] ?? []).filter((k) => (k[0] === 'F' || k[0] === 'C') && !ENTRY.test(k[2]) && !STICKY.test(k[2])).map((k) => ({ id: k[1], name: k[2] }));

const age = (id: string) => Number(id.split(':')[0]) || 0;

/** A flow's subsection in one iteration: project.json first, then the newest tagged section in the map. */
function subsection(project: Project, rows: Map<string, MapRow>, slug: string, iteration: string): string | null {
  const known = project.iterations.find((it) => it.id === iteration)?.flows?.[slug]?.node;
  if (known && rows.has(known)) return known;
  const tagged = [...rows.values()].filter((r) => r[0] === 'S').filter((r) => {
    const t = unpackTag(r[9]);
    return t?.kind === 'flow' && t.iteration === iteration && t.flow === slug;
  });
  return tagged.sort((a, b) => age(b[1]) - age(a[1]))[0]?.[1] ?? known ?? null;
}

/**
 * The screens a review of this flow covers: the flow subsection of this iteration, else the newest older iteration's
 * subsection with screens, else the flow's baseline section. Entry copies and stickies are left out.
 */
export function flowFrames(pages: MapPages | null | undefined, project: Project, flow: Pick<Flow, 'slug' | 'baseline'>, iteration: string): FlowFrames {
  const rows = rowsOf(pages ?? []);
  const own = subsection(project, rows, flow.slug, iteration);
  const here = screensIn(own ? rows.get(own) : undefined);
  if (own && here.length) return { frames: here, source: { kind: 'iteration', iteration, node: own } };
  const tagIds = [...rows.values()].map((r) => unpackTag(r[9])).filter((t) => t?.kind === 'flow' && t.flow === flow.slug && t.iteration).map((t) => t!.iteration!);
  const ids = [...new Set([...project.iterations.map((it) => it.id), ...tagIds])].filter((id) => compareIds(id, iteration) < 0).sort(compareIds).reverse();
  for (const id of ids) {
    const node = subsection(project, rows, flow.slug, id);
    const list = screensIn(node ? rows.get(node) : undefined);
    if (node && list.length) return { frames: list, source: { kind: 'older', iteration: id, node } };
  }
  const base = flow.baseline ? screensIn(rows.get(flow.baseline)) : [];
  if (flow.baseline && base.length) return { frames: base, source: { kind: 'baseline', node: flow.baseline } };
  return { frames: [], source: { kind: 'none' } };
}

/** Where the review's screens come from, for the card: "in 1.19", "in 1.18, the newest with screens", "in the baseline". */
export function sourceLine(s: FrameSource): string {
  if (s.kind === 'iteration') return `in ${s.iteration}`;
  if (s.kind === 'older') return `in ${s.iteration}, the newest iteration with screens`;
  if (s.kind === 'baseline') return 'in the baseline';
  return '';
}

// ---------- The last review, counted for the card ----------

export type ReviewTally = { at: number; round: number; open: Record<Severity, number>; decide: number };

/** Open findings of the last review run (not audits), by severity, after her triage. Null when there is none. */
export function reviewTally(runs: ReviewRun[], triage: Triage | null): ReviewTally | null {
  const run = runs.filter((r) => r.kind === 'review').sort((a, b) => a.at - b.at).at(-1);
  if (!run) return null;
  const open = splitRun(run, triage).open;
  const count = (s: Severity) => open.filter((f) => f.severity === s && !f.decide).length;
  return { at: run.at, round: run.round, open: { blocking: count('blocking'), major: count('major'), minor: count('minor') }, decide: open.filter((f) => f.decide).length };
}

// ---------- What the strip and the step card show ----------

export type StepView = { id: StepId; name: string; state: 'current' | 'done' | 'skipped' | 'todo' };

export type CardAction =
  | 'review' | 'feedback' | 'plan-updates' | 'open-review' | 'mark-done' | 'review-again' | 'freeze'
  | 'next-iteration' | 'adopt' | 'pick-screens' | 'explore' | 'pick' | 'build' | 'system' | 'skip-system' | 'switch-review-update';
export type CardButton = { label: string; action: CardAction; primary: boolean };
export type StepCard = { line: string; button?: CardButton; link?: { label: string; action: CardAction }; pick?: boolean };

export type WorkflowEvidence = {
  flow: Pick<Flow, 'n' | 'name'>;
  iteration: { id: string; state: 'working' | 'frozen' };
  screens: number;
  source: FrameSource;
  /** "about $0.40", from roundCost with the Review tab's depth. */
  cost: string;
  /** "Full", the Review tab's depth. */
  depth: string;
  review: ReviewTally | null;
  /** A review is running in this chat right now. */
  reviewing: boolean;
  /** The file has a design system profile, with its component count. */
  system?: { components: number } | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function stepViews(s: WorkflowState): StepView[] {
  return WORKFLOW_STEPS[s.workflow].map((id) => ({ id, name: STEP_NAME[id], state: id === s.step ? 'current' : s.marks[id]?.state === 'done' ? 'done' : s.marks[id]?.state === 'skipped' ? 'skipped' : 'todo' }));
}

type CardMaker = (line: string, button?: Omit<CardButton, 'primary'> & { primary?: boolean }, link?: StepCard['link']) => StepCard;
export type CardContext = { s: WorkflowState; e: WorkflowEvidence; card: CardMaker; done: boolean; it: string; where: string };

/**
 * The card each step shows, one entry per step id. Review and update fills review and update; the From scratch
 * entries are a first version for its own phase to refine. Copy follows the plan's copy table.
 */
export const STEP_CARDS: Record<StepId, (c: CardContext) => StepCard> = {
  review: ({ s, e, card, where }) => {
    if (e.reviewing) return card(`Reviewing ${plural(e.screens, 'screen')}, about 3 minutes. You can keep chatting.`);
    if (s.failed && e.screens) return card(`The review stopped: ${s.failed.reason.replace(/[.\s]+$/, '')}. Nothing was changed.`, { label: 'Try again', action: 'review', primary: false });
    if (!e.screens) return card(`No screens to review ${e.source.kind === 'none' ? 'in this flow yet' : sourceLine(e.source)}. Give feedback, or ask Claude to design them.`, undefined, { label: 'Give feedback', action: 'feedback' });
    const src = e.source.kind === 'iteration' ? `in ${where}` : `of Flow ${e.flow.n} ${sourceLine(e.source)}`;
    // An older or baseline source may miss her newest work: offer to name the screens instead.
    const link = e.source.kind === 'iteration' ? { label: 'Or give feedback', action: 'feedback' as const } : { label: 'Pick screens', action: 'pick-screens' as const };
    return card(`Reviews ${plural(e.screens, 'screen')} ${src}. Depth: ${e.depth}, ${e.cost}.`, { label: 'Start review', action: 'review' }, link);
  },
  update: ({ s, e, card, done, it, where }) => {
    if (done) {
      const w = s.work;
      const line = w?.changes ? `Round ${s.round} done: ${plural(w.changes, 'fix', 'fixes')}${w.screens.length ? ` on ${plural(w.screens.length, 'screen')}` : ''}.` : `Round ${s.round} done.`;
      return card(line, { label: 'Review again', action: 'review-again' }, { label: `Freeze ${it}`, action: 'freeze' });
    }
    if (s.fromFeedback) return card('Updating from your feedback. Mark done when you are happy.', { label: 'Mark done', action: 'mark-done', primary: false });
    const r = e.review;
    if (r && s.marks.review?.state === 'done') {
      const parts = [r.open.blocking && `${r.open.blocking} blocking`, r.open.major && `${r.open.major} major`, r.open.minor && `${r.open.minor} minor`].filter(Boolean);
      const wait = r.decide ? ` ${r.decide} ${r.decide === 1 ? 'waits' : 'wait'} for your decision.` : '';
      return card(`Review done: ${parts.length ? parts.join(', ') : 'nothing open'}.${wait}`, { label: 'Plan the updates', action: 'plan-updates' }, { label: 'Open Review', action: 'open-review' });
    }
    return card(`Updates go in ${where}. Claude plans first and waits for your go.`, { label: 'Plan the updates', action: 'plan-updates' });
  },
  explore: ({ s, card }) =>
    s.options
      ? card(`${plural(s.options.length, 'option')} in Figma. Explore again for new ones, or pick one.`, { label: 'Explore options', action: 'explore', primary: false }, { label: 'Pick an option', action: 'pick' })
      : card('Claude makes 2 or 3 low fidelity options in Figma, inside this flow.', { label: 'Explore options', action: 'explore' }),
  // The card renders the options as radios with a Why field and its own Build button (PickCard.tsx).
  pick: ({ s, card }) =>
    s.options ? { ...card('Pick the option to take to high fidelity.'), pick: true } : card('No options to pick from yet. Claude makes them in Explore.', { label: 'Explore options', action: 'explore' }),
  hifi: ({ s, card, done }) => {
    const o = s.picked && s.options?.find((x) => x.id === s.picked!.id);
    if (done) return card(`${o ? `Option ${o.id}: ${o.name}` : 'The pick'} is built in high fidelity.`, { label: 'Make the design system', action: 'system' });
    return card(`Builds ${o ? `Option ${o.id}: ${o.name}` : 'the picked option'} with every state, wired.`, { label: 'Build it', action: 'build' }, o ? undefined : { label: 'Pick an option', action: 'pick' });
  },
  system: ({ e, card }) =>
    e.system
      ? card(`This file has a design system (${plural(e.system.components, 'component')}). Adds only what the new screens need, as new variants.`, { label: 'Extend the design system', action: 'system' }, { label: 'Skip', action: 'skip-system' })
      : card("Turns the screens' parts into variables, text styles and components.", { label: 'Make the design system', action: 'system' }, { label: 'Skip', action: 'skip-system' }),
  iterate: ({ e, card }) => card(`From scratch is done for ${e.flow.name}. Keep iterating with Review and update.`, { label: 'Switch to Review and update', action: 'switch-review-update' }),
};

/** The one card under the strip. At most one primary button; a plan or permission card on screen (busy) turns it Secondary. */
export function stepCard(s: WorkflowState, e: WorkflowEvidence, busy = false): StepCard {
  const it = e.iteration.id;
  const card: CardMaker = (line, button, link) => ({
    line,
    ...(button ? { button: { ...button, primary: (button.primary ?? true) && !busy } } : {}),
    ...(link ? { link } : {}),
  });
  if (e.iteration.state === 'frozen') return card(`${it} is frozen. Changes go in a new iteration.`, { label: 'Start the next iteration', action: 'next-iteration' });
  return STEP_CARDS[s.step]({ s, e, card, done: s.marks[s.step]?.state === 'done', it, where: `${it} · Flow ${e.flow.n}` });
}

/** The project row tag and the report: "Update, round 2". */
export function workflowLabel(s: WorkflowState | null): string | null {
  if (!s) return null;
  return `${STEP_NAME[s.step]}${s.round > 1 ? `, round ${s.round}` : ''}`;
}

// ---------- What Claude is told ----------

/** The step prompts a step button asks for. The visible message stays short; this rides along once. */
export function stepPrompt(step: StepId, flow: Pick<Flow, 'n' | 'name'>, iteration: string, s?: WorkflowState): string {
  const f = `Flow ${flow.n} · ${flow.name}`;
  switch (step) {
    case 'update':
      return `Update ${f} in ${iteration}. Fix the blocking and major issues and the failed house rules from the last review. Skip the findings and rules the designer closed by hand (fixed, won't fix or parked) and leave the ones that wait for the designer's decision. Plan the fixes first and wait for the designer's go before any Figma edit. Edit only in your flow subsection: a screen from an older iteration is copied in with DS.clone and rewired, never edited. Update the Decision stickies of every changed screen with DS.decisions. When you finish, call set_status with changes and stepDone "update".`;
    case 'explore':
      return `Explore ${f} in ${iteration}. Plan first: goal, users, screens, and what makes each option different; wait for the designer's go. After go, make 2 or 3 low fidelity options that differ in structure, not colour: greyscale, real copy, no library components, main path only. Make each option with DS.option(flowSubsection, { id: "A", name: "<short name>", iteration: "${iteration}" }): a subsection "V${iteration} · Flow ${flow.n} · Option A: <name>" inside your flow subsection, lined up 400px apart. Put 3 Decision stickies under the first screen of each option: the idea, who it serves best, what it gives up. End with set_status options from DS.options(flowSubsection) and one line per option with your recommendation. When the designer picks one in the chat, call set_status picked with the id and their reason.`;
    case 'hifi': {
      const o = s?.picked && s.options?.find((x) => x.id === s.picked!.id);
      const others = (s?.options ?? []).filter((x) => x.id !== s?.picked?.id).map((x) => x.id);
      const pick = o ? `The designer picked Option ${o.id}: ${o.name}${others.length ? ` over ${others.join(' and ')}` : ''}.${s?.picked?.why ? ` Why: ${s.picked.why.replace(/[.\s]+$/, '')}.` : ''} ` : '';
      return `${pick}Build ${o ? `Option ${o.id}` : 'the picked option'} of ${f} in high fidelity, in your flow subsection beside the options (they stay). Plan first and wait for the designer's go. Main path plus every state in the plan: empty, typing, filled, error, submitting, done. Use the library when design-system.md exists, else local variables and text styles, which the next step turns into the design system. Wire every click and hover. 3 to 5 Decision stickies per screen, carrying the pick's reasons. End each edit with DS.check and DS.fit. When you finish, call set_status with changes and stepDone "hifi".`;
    }
    case 'system':
      return `Make the design system for ${f}. Plan first and wait for the designer's go. Variables (colour, spacing, radius), text styles, and component sets with Default, Hover and Disabled variants on the components page. When the file already has a design system, extend it: new variants only, old ones stay as they are. Swap the screens' parts to instances and check each screen still renders. When you finish, call set_status with changes and stepDone "system".`;
    default:
      return '';
  }
}

/** The status line Claude gets in front of the next message when the step changes. Informs only, never a gate. */
export function workflowNote(s: WorkflowState, flow: Pick<Flow, 'n' | 'name'>, iteration: string): string {
  const steps = WORKFLOW_STEPS[s.workflow];
  const done = steps.filter((id) => s.marks[id]?.state === 'done').map((id) => STEP_NAME[id]);
  return [
    `Workflow: ${WORKFLOW_INFO[s.workflow].name} (${steps.map((id) => STEP_NAME[id]).join(', ')}), a guide only.`,
    `Step: ${STEP_NAME[s.step]}${s.round > 1 ? `, round ${s.round}` : ''}${s.fromFeedback ? ', from the designer\'s feedback' : ''}.`,
    done.length ? `Done this round: ${done.join(', ')}.` : '',
    s.workflow === 'review-update' ? 'The designer can also give feedback directly: make it in your flow subsection.' : '',
  ].filter(Boolean).join(' ');
}

/** The system prompt block for a flow chat, after the flow block. The step itself comes in the note. */
export const WORKFLOW_RULES = [
  'This chat follows a workflow shown above the chat: Review and update (review the screens, then update them, or take the designer\'s feedback directly) or From scratch (explore low fidelity options, then high fidelity and a design system). Each message starts with the current step when it changes.',
  'In High fidelity, Design system and Update, plan first and wait for the designer\'s go before any Figma edit.',
  'Every new or changed screen gets 3 to 5 Decision stickies right below it, written with DS.decisions(screen, [{ decision, why }], { iteration }). Decision 1 is this iteration\'s change. Entry copies get none.',
  'When you finish a step, pass stepDone with that step\'s id (update, hifi, system) in set_status.',
].join('\n');

/** The fix request the Review tab puts in the message box ("Fix the issues"). */
export const FIX_ASK = "Fix the blocking and major issues and the failed house rules from the last review. Skip the findings and rules I closed by hand (fixed, won't fix or parked). Leave the findings that wait for my decision. Plan the fixes first and wait for my approval.";
