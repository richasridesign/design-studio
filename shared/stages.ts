// Steps: a guide to the work in one chat, never a gate. A chat is one kind of work (a new flow, a fix across flows,
// a review, an idea to explore), and each kind shows only the steps it needs. Steps can be done in any order,
// marked Not needed, or done again (round 2, round 3). Checks say what the app sees; they never block.
// The ids are the storage keys from the first version (stages.json), so old approvals still load.

import type { DesignDoc, FlowPhase, ReviewDoc, SketchDoc } from './design.js';
import type { DecisionDoc } from './decisions.js';
import { filled } from './decisions.js';
import { scopeSummary, type Scope } from './scope.js';
import { flowIssues, type FlowCheckRun } from './flowcheck.js';
import { stateMap } from './stateMap.js';
import { closedTally, splitRun, triagedRules, type Triage } from './triage.js';
import { rulesSummary } from './rules.js';

export const STAGE_IDS = ['spec', 'research', 'explore', 'decide', 'build', 'validate', 'ship'] as const;
export type StageId = (typeof STAGE_IDS)[number];

// Her words: plan, sketch, build a version, review, hand off. Decide is folded into Sketch and kept only for old approvals.
export const STAGE_INFO: Record<StageId, { name: string; goal: string }> = {
  spec: { name: 'Plan', goal: 'Agree what to change, where and for whom' },
  research: { name: 'Research', goal: 'Look at how others solve it' },
  explore: { name: 'Sketch', goal: 'Sketch options and pick one' },
  decide: { name: 'Pick', goal: 'Pick one direction per screen' },
  build: { name: 'Build', goal: 'A new version in Figma, beside the old one' },
  validate: { name: 'Review', goal: 'Check the frames, fix, check again' },
  ship: { name: 'Hand off', goal: 'Share the frames, decisions and review' },
};

export const CHAT_KINDS = ['new', 'fix', 'review', 'explore', 'batch'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];
// Hand off is in no list: it never ran in practice. The handoff report stays on the Review tab.
export const KIND_INFO: Record<ChatKind, { label: string; steps: StageId[] }> = {
  new: { label: 'New flow or version', steps: ['spec', 'explore', 'build', 'validate'] },
  fix: { label: 'Fix across flows', steps: ['spec', 'build', 'validate'] },
  review: { label: 'Review only', steps: ['validate'] },
  explore: { label: 'Explore or research', steps: ['research', 'explore'] },
  // A long run: agree the checklist and scope, then review and fix in rounds until the stop time.
  batch: { label: 'Overnight batch', steps: ['spec', 'validate'] },
};

/** Steps that can run again. Review rounds also come from the review runs. */
export const REPEATS: StageId[] = ['build', 'validate'];

/** A cheap guess from the first message. Null means a plain chat, which shows no steps until she picks a kind. */
export function guessKind(text: string | null | undefined): ChatKind | null {
  const t = (text ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  if (/\breview only\b|\bonly (a )?review\b|\bjust (a )?review\b|\b(do not|don't|dont) (build|change|edit|fix|touch)\b|\bno edits\b|^\s*(please |can you )?(review|audit)\b/.test(t)) return 'review';
  if (/\bovernight\b|\buntil \d{1,2} ?(am|pm|a\.m\.|p\.m\.)|\bwhile i (sleep|am asleep|'m asleep)\b|\bfigure (it )?out yourself\b/.test(t)) return 'batch';
  if (/\bacross (all |the |every |each )*((\d+|two|three|four|five|six|seven|eight|nine|ten) )?flows\b|\b(in|to) (all|every|each) (of )?(the )?((\d+|eight) )?flows\b|\beverywhere\b|\bevery (dialog|screen|modal|card|button|table|toast|tooltip)s?\b|\bfix (it|this|that|them|these)\b/.test(t)) return 'fix';
  if (/\b(design|create|build|make|add|redesign)\b.{0,60}\b(screens?|flows?|pages?|dialogs?|modals?|features?|onboarding|forms?|states?)\b|\bnew (screen|flow|page|feature|version)\b/.test(t)) return 'new';
  if (/\b(explore|brainstorm|research|competitors?|what if|ideas?|inspiration|industry standard|options for)\b/.test(t)) return 'explore';
  return null;
}

/** A design run's phases, named by the step they belong to. The step is the main name; the phase is its sub-line. */
export const PHASE_STAGE: Record<Exclude<FlowPhase, 'done' | 'stopped'>, { stage: StageId; doing: string }> = {
  plan: { stage: 'spec', doing: 'writing the plan' },
  sketch: { stage: 'explore', doing: 'sketching directions' },
  pick: { stage: 'explore', doing: 'pick a direction' },
  file: { stage: 'build', doing: 'attach the Figma file' },
  system: { stage: 'build', doing: 'reading the design system' },
  design: { stage: 'build', doing: 'designing in Figma' },
  review: { stage: 'validate', doing: 'checking the frames' },
  fix: { stage: 'validate', doing: 'fixing issues' },
};

/** "Build: designing in Figma". Done and stopped are run states, not steps. */
export function phaseLine(phase: FlowPhase | null): string {
  if (!phase) return 'No design run';
  if (phase === 'done') return 'Design run done';
  if (phase === 'stopped') return 'Design run stopped';
  const p = PHASE_STAGE[phase];
  return `${STAGE_INFO[p.stage].name}: ${p.doing}`;
}

export type Approval = { at: number; note?: string };
export type StageApprovals = Partial<Record<StageId, Approval>>;

/** Where a check's evidence lives in the app. */
export type StageOpen = 'sketch' | 'figma' | 'review' | 'decisions' | 'report' | 'attach' | 'research' | 'states';
export type StageCheck = { label: string; state: 'met' | 'open' | 'unchecked'; detail: string; open?: StageOpen };
/** Done, Not needed, or still to do. Nothing is locked: any step can change at any time. A todo mark records a reopen. */
export type StageState = 'done' | 'skipped' | 'todo';
/** What she set on a step. A todo mark only carries a round (she started it again). */
export type StageMark = { state: StageState; at: number; note?: string; round?: number };
export type ChatSteps = { kind?: ChatKind | 'none'; marks: Partial<Record<StageId, StageMark>> };
export type Stage = {
  id: StageId; name: string; goal: string; state: StageState;
  /** 1 until the step runs again. Review also counts the review runs. */
  round: number;
  /** The first step still to do, a suggestion only. */
  next: boolean;
  checks: StageCheck[];
  /** Done, but a step before it was reopened or run again since: still shown, may be out of date. */
  stale: boolean;
  /** The done mark, kept as approval for the decision log. */
  approval?: Approval;
  mark?: StageMark;
};
/** What /api/stages returns for the open chat. kind null: a plain chat, no steps shown. */
export type StagesView = { kind: ChatKind | null; guessed: boolean; steps: Stage[]; /** Every done step in the folder, for the decision log. */ approvals?: StageApprovals };

export type StageEvidence = {
  brief: string | null;
  figma: boolean;
  /** Older callers and tests leave it out. */
  scope?: Scope | null;
  /** research.md from the Research first recipe. */
  research?: string | null;
  /** plan.md, the written brief. Its States section lists the states each screen needs. */
  plan?: string | null;
  sketch: SketchDoc | null;
  design: DesignDoc | null;
  review: ReviewDoc | null;
  /** The last Flow check run on the file's prototype. */
  flowcheck?: FlowCheckRun | null;
  /** Her short approval in the chat ("go", "A"), with or without a written plan. Logged, never required. */
  approvedInChat?: string | null;
  /** Findings the designer closed by hand (triage.json). */
  triage?: Triage | null;
  decisions: DecisionDoc | null;
};

/** The frames a chat designed. Older chats only list them on their review runs, by node id. */
export const stageFrames = (design: DesignDoc | null, review: ReviewDoc | null): Array<{ nodeId: string; screen?: string; state?: string; name?: string }> =>
  design?.frames.length ? design.frames : (review?.runs.at(-1)?.frames ?? []).map((nodeId) => ({ nodeId }));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const check = (label: string, met: boolean, detail: string, open?: StageOpen): StageCheck => ({ label, state: met ? 'met' : 'open', detail, open });

function checksFor(id: StageId, e: StageEvidence): StageCheck[] {
  const screens = e.sketch?.screens ?? [];
  const frames = stageFrames(e.design, e.review);
  switch (id) {
    case 'spec':
      return [
        check('Brief written', !!e.brief?.trim(), e.brief?.trim() ? short(e.brief) : 'Describe the work in the chat'),
        e.research?.trim()
          ? check('Research written', true, researchSummary(e.research), 'research')
          : { label: 'Research written', state: 'unchecked', detail: 'Optional: use the Research first recipe' },
        check('Flows in scope named', !!e.scope?.flows.length, e.scope?.flows.length ? scopeSummary(e.scope) : 'Name the flows this work must keep'),
        check('Figma file attached', e.figma, e.figma ? 'Attached' : 'Attach the file Claude designs in', e.figma ? undefined : 'attach'),
        e.approvedInChat
          ? check('You said go', true, `"${e.approvedInChat}"${e.plan?.trim() ? '' : ', no written plan'}`)
          : { label: 'You said go', state: 'unchecked', detail: 'Reply go to Claude\'s plan, or skip the plan' },
      ];
    case 'research':
      return [check('Research written', !!e.research?.trim(), e.research?.trim() ? researchSummary(e.research) : 'No research yet', e.research?.trim() ? 'research' : undefined)];
    case 'explore': {
      // One direction is fine when the answer is clear; the detail says how many have more.
      const multi = screens.filter((s) => s.directions.length >= 2).length;
      const picked = screens.filter((s) => s.chosen);
      const byClaude = picked.filter((s) => s.chosenBy === 'claude').length;
      return [
        check('Directions sketched', screens.length > 0, screens.length ? `${plural(screens.length, 'screen')}, ${multi} with 2 or more directions` : 'No sketch yet', 'sketch'),
        check('A direction picked for every screen', screens.length > 0 && picked.length === screens.length, screens.length ? `${picked.length} of ${screens.length} picked${byClaude ? `, ${byClaude} by Claude` : ''}` : 'No sketch yet', 'sketch'),
      ];
    }
    case 'decide': {
      const picked = screens.filter((s) => s.chosen);
      const byClaude = picked.filter((s) => s.chosenBy === 'claude').length;
      const detail = screens.length ? `${picked.length} of ${screens.length} picked${byClaude ? `, ${byClaude} by Claude` : ''}` : 'No sketch yet';
      return [check('A direction picked for every screen', screens.length > 0 && picked.length === screens.length, detail, 'sketch')];
    }
    case 'build': {
      const ids = new Set(frames.map((f) => f.nodeId));
      const written = [...ids].filter((nid) => e.decisions?.[nid]?.items.every(filled)).length;
      return [
        check('Frames in Figma', frames.length > 0, frames.length ? plural(frames.length, 'frame') : 'Claude has not designed any frames yet', 'figma'),
        check('Two decisions per frame', ids.size > 0 && written === ids.size, ids.size ? `${written} of ${ids.size} frames` : 'No frames yet', 'decisions'),
        statesCheck(e.plan?.trim() ? e.plan : e.brief ?? '', frames),
      ];
    }
    case 'validate': {
      const run = e.review?.runs.at(-1);
      const flows = e.flowcheck?.flows.filter((f) => f.state !== 'unchecked') ?? [];
      const failing = flows.filter((f) => flowIssues(f) > 0).length;
      // A large file read only in part can hide broken flows, so a clean but partial run does not pass.
      const partial = !!e.flowcheck?.truncated;
      // Flows named in Scope with no section in the file.
      const missing = e.flowcheck?.missing ?? [];
      const wired: StageCheck = flows.length
        ? check('Prototype wired', failing === 0 && !partial && !missing.length, failing ? `Flow check: issues in ${failing} of ${plural(flows.length, 'flow')}` : missing.length ? `Flow check: not found in the file: ${missing.join(', ')}` : partial ? 'Flow check: the file is too large to read in full, so some flows were not checked' : `Flow check: ${flows.length === 1 ? 'the flow passed' : `all ${flows.length} flows passed`}`, 'review')
        : { label: 'Prototype wired', state: 'unchecked', detail: 'Flow check has not run on this file', open: 'review' };
      if (!run) return [check('Review run', false, 'No review yet', 'review'), wired];
      // Findings closed by hand (fixed, won't fix, parked) do not count; the detail still names them.
      const split = splitRun(run, e.triage);
      const open = split.open.filter((f) => f.severity !== 'minor').length;
      const closed = closedTally(split.closed.filter((f) => f.severity !== 'minor'));
      // A failed house rule resolved by hand (fixed, won't fix, parked) counts as met, like a resolved finding.
      const rules = triagedRules(run, e.triage) ?? [];
      const { failed, resolved } = rulesSummary(rules);
      const resolvedNote = resolved ? `, ${resolved} resolved by hand` : '';
      return [
        check('Review run', true, `Round ${run.round}, ${plural(run.frames.length, 'frame')}`, 'review'),
        check('No blocking or major issues', open === 0, `${open ? `${plural(open, 'issue')} open` : 'None open'}${closed ? `, ${closed}` : ''}`, 'review'),
        rules.length
          ? check('House rules followed', failed === 0, failed ? `${failed} of ${rules.length} failed${resolvedNote}` : resolved ? `${rules.length - resolved} of ${rules.length} followed${resolvedNote}` : `All ${rules.length} followed`, 'review')
          : { label: 'House rules followed', state: 'unchecked', detail: 'No house rules checked in this review', open: 'review' },
        wired,
      ];
    }
    case 'ship':
      return [check('Handoff report', frames.length > 0, frames.length ? 'Frames, decisions and review in one page' : 'Nothing to hand off yet', frames.length ? 'report' : undefined)];
  }
}

/** Every state the brief lists for a screen has a frame. */
function statesCheck(brief: string, frames: Array<{ nodeId: string }>): StageCheck {
  const label = 'Every state designed';
  const map = stateMap(brief, frames);
  if (!map.total) return { label, state: 'unchecked', detail: 'The brief lists no states' };
  // Older chats know frames by node id only, so there is nothing to match the states against.
  if (frames.length && !map.named) return { label, state: 'unchecked', detail: 'The frames have no names to match states against', open: 'states' };
  const detail = map.missing ? `${map.missing} of ${plural(map.total, 'state')} missing` : map.total === 1 ? 'The state is designed' : `All ${map.total} states designed`;
  return check(label, map.missing === 0, detail, 'states');
}

/** "4 references, 3 options" from the Looked at and Options sections of research.md. */
export function researchSummary(md: string) {
  const bullets = (title: RegExp) => {
    const lines = md.split('\n');
    const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && title.test(l));
    if (start < 0) return 0;
    const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end).filter((l) => /^\s*(?:[-*]|\d+[.)])\s+\S/.test(l) && !/^\s{2,}/.test(l)).length;
  };
  const refs = bullets(/looked at/i);
  const options = bullets(/options/i);
  const parts = [refs && plural(refs, 'reference'), options && plural(options, 'option')].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Findings written';
}

const short = (t: string) => {
  const line = t.trim().split('\n')[0];
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** Old stages.json files held one flat set of approvals for the folder. Every step on it counts as done. */
export function cleanApprovals(input: unknown): StageApprovals {
  const out: StageApprovals = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const id of STAGE_IDS) {
    const v = (input as Record<string, unknown>)[id] as { at?: unknown; note?: unknown } | undefined;
    if (v && typeof v.at === 'number' && Number.isFinite(v.at)) out[id] = typeof v.note === 'string' && v.note.trim() ? { at: v.at, note: v.note.trim().slice(0, 400) } : { at: v.at };
  }
  return out;
}

const NOTE_MAX = 400;
const isKind = (k: unknown): k is ChatKind => CHAT_KINDS.includes(k as ChatKind);

export function cleanChatSteps(input: unknown): ChatSteps {
  const out: ChatSteps = { marks: {} };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const o = input as { kind?: unknown; marks?: unknown };
  if (isKind(o.kind) || o.kind === 'none') out.kind = o.kind;
  const marks = o.marks && typeof o.marks === 'object' && !Array.isArray(o.marks) ? (o.marks as Record<string, unknown>) : {};
  for (const id of STAGE_IDS) {
    const m = marks[id] as { state?: unknown; at?: unknown; note?: unknown; round?: unknown } | undefined;
    if (!m || typeof m.at !== 'number' || !Number.isFinite(m.at) || !['done', 'skipped', 'todo'].includes(m.state as string)) continue;
    const mark: StageMark = { state: m.state as StageState, at: m.at };
    if (typeof m.note === 'string' && m.note.trim()) mark.note = m.note.trim().slice(0, NOTE_MAX);
    if (typeof m.round === 'number' && Number.isInteger(m.round) && m.round > 1) mark.round = Math.min(m.round, 99);
    out.marks[id] = mark;
  }
  return out;
}

/** Old approvals read as done marks, for a chat that has none of its own yet. */
export const fromApprovals = (a: StageApprovals): ChatSteps['marks'] =>
  Object.fromEntries(Object.entries(a).map(([id, v]) => [id, { state: 'done', at: v!.at, ...(v!.note ? { note: v!.note } : {}) }]));

/** Done marks as approvals: the decision log and the handoff report read these. */
export const toApprovals = (marks: ChatSteps['marks']): StageApprovals =>
  Object.fromEntries(Object.entries(marks).filter(([, m]) => m?.state === 'done').map(([id, m]) => [id, m!.note ? { at: m!.at, note: m!.note } : { at: m!.at }]));

export type StepAction = 'done' | 'skip' | 'undo' | 'again';

/** Changes one step and leaves every other step as it was. */
export function markStep(c: ChatSteps, id: StageId, action: StepAction, at: number, note?: string, seenRound = 1): ChatSteps {
  const marks = { ...c.marks };
  const old = marks[id];
  const round = Math.max(old?.round ?? 1, seenRound);
  const keep = round > 1 ? { round } : {};
  const text = note?.trim().slice(0, NOTE_MAX);
  if (action === 'done') marks[id] = { state: 'done', at, ...(text ? { note: text } : {}), ...keep };
  else if (action === 'skip') marks[id] = { state: 'skipped', at, ...keep };
  else if (action === 'again') marks[id] = { state: 'todo', at, round: round + 1 };
  // Undo keeps a todo mark with its time, so the steps after it can say they may be out of date.
  else marks[id] = { state: 'todo', at, ...keep };
  return { ...c, marks };
}

export const setKind = (c: ChatSteps, kind: ChatKind | 'none'): ChatSteps => ({ ...c, kind });

/** The kind the chat shows: hers when she picked one, else the guess from the first message. */
export function chatKind(c: ChatSteps, first: string | null | undefined): { kind: ChatKind | null; guessed: boolean } {
  if (c.kind === 'none') return { kind: null, guessed: false };
  if (c.kind) return { kind: c.kind, guessed: false };
  const g = guessKind(first);
  return { kind: g, guessed: !!g };
}

/** The steps of one chat. Order is a suggestion: the first step still to do is "next", nothing waits on it. */
export function stages(e: StageEvidence, c: ChatSteps, kind: ChatKind | null): Stage[] {
  if (!kind) return [];
  const run = e.review?.runs.at(-1);
  let nextSet = false;
  // The latest reopen or new round of a step, by position: a later done step older than it may be out of date.
  let reopenedAt = 0;
  return KIND_INFO[kind].steps.map((id) => {
    let mark = c.marks[id];
    // A review run after Review was marked done starts the next round on its own, so nothing needs reopening.
    if (id === 'validate' && mark?.state === 'done' && run && run.at > mark.at) mark = { state: 'todo', at: run.at, round: Math.max(mark.round ?? 1, run.round) };
    const state: StageState = mark?.state ?? 'todo';
    const round = Math.max(mark?.round ?? 1, id === 'validate' && run ? run.round : 1);
    const next = state === 'todo' && !nextSet;
    if (next) nextSet = true;
    const stale = state === 'done' && !!mark && mark.at < reopenedAt;
    if (mark && (mark.state === 'todo' || (mark.round ?? 1) > 1)) reopenedAt = Math.max(reopenedAt, mark.at);
    return { id, ...STAGE_INFO[id], state, round, next, stale, checks: checksFor(id, e), ...(mark ? { mark } : {}), ...(state === 'done' && mark ? { approval: mark.note ? { at: mark.at, note: mark.note } : { at: mark.at } } : {}) };
  });
}

/** "Build, round 2", or "All done". */
export function stepLine(list: Stage[]): string {
  const next = list.find((s) => s.next);
  if (!next) return list.length ? 'All done' : '';
  return next.round > 1 ? `${next.name}, round ${next.round}` : next.name;
}

/**
 * A status line for Claude when her marks change. It informs and never tells Claude to refuse, wait or ask:
 * she moves between steps freely. Empty when she has set nothing.
 */
export function stageNote(c: ChatSteps): string {
  const kind = c.kind && c.kind !== 'none' ? c.kind : null;
  const ids = (kind ? KIND_INFO[kind].steps : []).concat(STAGE_IDS.filter((id) => c.marks[id] && !(kind && KIND_INFO[kind].steps.includes(id))));
  const with_ = (st: StageState) => ids.filter((id) => c.marks[id]?.state === st);
  const name = (id: StageId) => STAGE_INFO[id].name;
  const done = with_('done');
  const skipped = with_('skipped');
  const rounds = ids.filter((id) => (c.marks[id]?.round ?? 1) > 1 && c.marks[id]?.state === 'todo');
  const reopened = ids.filter((id) => c.marks[id]?.state === 'todo' && !c.marks[id]?.round);
  const notes = ids.map((id) => c.marks[id]?.note && `${name(id)}: ${c.marks[id]!.note}`).filter(Boolean);
  if (!kind && !done.length && !skipped.length && !rounds.length && !reopened.length) return '';
  return [
    `Steps for this chat, a guide only (follow the designer's request even when it skips or repeats a step)${kind ? `: ${KIND_INFO[kind].label} (${KIND_INFO[kind].steps.map(name).join(', ')})` : ''}.`,
    ...(done.length ? [`Done: ${done.map(name).join(', ')}.`] : []),
    ...(skipped.length ? [`Not needed: ${skipped.map(name).join(', ')}.`] : []),
    ...(rounds.length ? [`Started again: ${rounds.map((id) => `${name(id)} round ${c.marks[id]!.round}`).join(', ')}.`] : []),
    ...(reopened.length ? [`Reopened: ${reopened.map(name).join(', ')}.`] : []),
    ...(notes.length ? [`Notes: ${notes.join('; ')}`] : []),
  ].join(' ');
}

/** A short reply that approves Claude's last proposal: "go", "go ahead", "approved", "A", "error message B, voice 2". */
export function approvalReply(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length > 40) return null;
  if (/^(go( ahead)?|ok,? go( ahead)?|yes,? go( ahead)?|approved?|looks good,? go( ahead)?|build it|do it|option [a-c]|[a-c])([.!]|,? (please|thanks))?$/i.test(t)) return t;
  // "go, keep the voice button"
  return /^(go|approved?)[,.:] \S/i.test(t) ? t : null;
}

/** Short label for a folder or the report: the first step not done, in the order of a new flow. Null until something is done. */
export function stageLabel(a: StageApprovals, kind: ChatKind = 'new'): string | null {
  if (!STAGE_IDS.some((id) => a[id])) return null;
  const next = KIND_INFO[kind].steps.find((id) => !a[id]);
  return next ? STAGE_INFO[next].name : 'All done';
}
