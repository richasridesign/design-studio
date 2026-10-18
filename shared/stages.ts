// Stages: the six gates a piece of design work passes, from Richa's brief for an ideal tool.
// Each gate lists what passes it, the evidence the app already has, and who approves (the designer).

import type { DesignDoc, ReviewDoc, SketchDoc } from './design.js';
import type { DecisionDoc } from './decisions.js';
import { filled } from './decisions.js';
import { scopeSummary, type Scope } from './scope.js';
import { flowIssues, type FlowCheckRun } from './flowcheck.js';
import { stateMap } from './stateMap.js';

export const STAGE_IDS = ['spec', 'explore', 'decide', 'build', 'validate', 'ship'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_INFO: Record<StageId, { name: string; goal: string }> = {
  spec: { name: 'Spec', goal: 'Agree what to design and for whom' },
  explore: { name: 'Explore', goal: 'Sketch more than one direction per screen' },
  decide: { name: 'Decide', goal: 'Pick one direction per screen' },
  build: { name: 'Build', goal: 'Design the picked direction in Figma' },
  validate: { name: 'Validate', goal: 'Review the frames against the checks and house rules' },
  ship: { name: 'Ship', goal: 'Hand off the frames' },
};

export type Approval = { at: number; note?: string };
export type StageApprovals = Partial<Record<StageId, Approval>>;

/** Where a check's evidence lives in the app. */
export type StageOpen = 'sketch' | 'figma' | 'review' | 'decisions' | 'report' | 'attach' | 'research' | 'states';
export type StageCheck = { label: string; state: 'met' | 'open' | 'unchecked'; detail: string; open?: StageOpen };
export type StageState = 'approved' | 'ready' | 'open' | 'later';
export type Stage = { id: StageId; name: string; goal: string; state: StageState; checks: StageCheck[]; approval?: Approval };

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
      ];
    case 'explore': {
      const multi = screens.filter((s) => s.directions.length >= 2).length;
      return [check('Directions sketched', screens.length > 0 && multi === screens.length, screens.length ? `${plural(screens.length, 'screen')}, ${multi} with 2 or more directions` : 'No sketch yet', 'sketch')];
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
      const open = [...run.check, ...run.results.flatMap((r) => r.findings)].filter((f) => f.severity !== 'minor').length;
      const rules = run.rules ?? [];
      const failed = rules.filter((r) => r.state === 'fail').length;
      return [
        check('Review run', true, `Round ${run.round}, ${plural(run.frames.length, 'frame')}`, 'review'),
        check('No blocking or major issues', open === 0, open ? `${plural(open, 'issue')} open` : 'None open', 'review'),
        rules.length
          ? check('House rules followed', failed === 0, failed ? `${failed} of ${rules.length} failed` : `All ${rules.length} followed`, 'review')
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

/** Current stage: the first one not approved. Only it can be approved; later ones wait. */
export function stages(e: StageEvidence, approvals: StageApprovals): Stage[] {
  let reached = false;
  return STAGE_IDS.map((id) => {
    const checks = checksFor(id, e);
    const approval = approvals[id];
    let state: StageState;
    if (approval && !reached) state = 'approved';
    else if (!reached) {
      reached = true;
      state = checks.every((c) => c.state !== 'open') ? 'ready' : 'open';
    } else state = 'later';
    return { id, ...STAGE_INFO[id], state, checks, approval: state === 'approved' ? approval : undefined };
  });
}

export const currentStage = (list: Stage[]) => list.find((s) => s.state !== 'approved') ?? null;

/** Approving a stage keeps the ones before it. Reopening one clears it and every later approval. */
export function approve(a: StageApprovals, id: StageId, at: number, note?: string): StageApprovals {
  const i = STAGE_IDS.indexOf(id);
  const out: StageApprovals = {};
  for (const s of STAGE_IDS.slice(0, i)) if (a[s]) out[s] = a[s];
  out[id] = note?.trim() ? { at, note: note.trim().slice(0, 400) } : { at };
  return out;
}

export function reopen(a: StageApprovals, id: StageId): StageApprovals {
  const i = STAGE_IDS.indexOf(id);
  const out: StageApprovals = {};
  for (const s of STAGE_IDS.slice(0, i)) if (a[s]) out[s] = a[s];
  return out;
}

export function cleanApprovals(input: unknown): StageApprovals {
  const out: StageApprovals = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const id of STAGE_IDS) {
    const v = (input as Record<string, unknown>)[id] as { at?: unknown; note?: unknown } | undefined;
    if (v && typeof v.at === 'number' && Number.isFinite(v.at)) out[id] = typeof v.note === 'string' && v.note.trim() ? { at: v.at, note: v.note.trim().slice(0, 400) } : { at: v.at };
  }
  return out;
}

/** A line for Claude when the designer's approvals change. Empty when stages are not in use. */
export function stageNote(a: StageApprovals): string {
  const done = STAGE_IDS.filter((id) => a[id]);
  if (!done.length) return '';
  const next = STAGE_IDS.find((id) => !a[id]);
  const approved = done.map((id) => STAGE_INFO[id].name).join(', ');
  if (!next) return `Stages: the designer approved every stage (${approved}). The work is handed off. Ask before changing the Figma file.`;
  const notes = done.map((id) => a[id]?.note && `${STAGE_INFO[id].name}: ${a[id]!.note}`).filter(Boolean);
  return [
    `Stages: the designer approved ${approved}. Current stage: ${STAGE_INFO[next].name} (${STAGE_INFO[next].goal.toLowerCase()}).`,
    'Work inside this stage. If a request jumps ahead (for example editing Figma before Decide is approved), say so in one line and ask before doing it.',
    ...(notes.length ? [`Approval notes: ${notes.join('; ')}`] : []),
  ].join('\n');
}

/** Short label for a chat folder: the current stage once any stage is approved. */
export function stageLabel(a: StageApprovals): string | null {
  if (!STAGE_IDS.some((id) => a[id])) return null;
  const next = STAGE_IDS.find((id) => !a[id]);
  return next ? STAGE_INFO[next].name : 'Shipped';
}
