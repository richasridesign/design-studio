// What is left of the old per-chat steps (stages.json is no longer read; workflow.json took its place): the step
// names a design run's phases still use, the frames a chat designed, and how a plan approval is read.

import type { DesignDoc, FlowPhase, ReviewDoc } from './design.js';

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

/** The frames a chat designed. Older chats only list them on their review runs, by node id. */
export const stageFrames = (design: DesignDoc | null, review: ReviewDoc | null): Array<{ nodeId: string; screen?: string; state?: string; name?: string }> =>
  design?.frames.length ? design.frames : (review?.runs.at(-1)?.frames ?? []).map((nodeId) => ({ nodeId }));

/**
 * Claude's plan was approved on its card: a plan tool call (ExitPlanMode) whose result is not an error.
 * A plan card approved by a click or a typed go sends no chat message, so the chat replies alone miss it.
 * Asking for changes and the flow's own saved plan both come back as errors, so they do not count.
 * Only the latest plan card counts, read from this chat's own events in order (plan.md is shared by every chat in the
 * folder, so its save time could come from another chat). After a newer message the approval is for older work when
 * Claude writes plan.md again or the flow moves on to its sketch after saving a plan. Saving the approved plan to
 * plan.md in the same turn keeps it.
 */
export function planApprovedOnCard(events: ReadonlyArray<{ kind: string; id: string; name?: string; toolUseId?: string; isError?: boolean; input?: unknown; phase?: string }>): boolean {
  let card = -1;
  events.forEach((e, i) => { if (e.kind === 'tool_use' && e.name === 'ExitPlanMode') card = i; });
  if (card < 0) return false;
  const answer = events.findIndex((e, i) => i > card && e.kind === 'tool_result' && e.toolUseId === events[card].id);
  if (answer < 0 || events[answer].isError) return false;
  let asked = false;
  for (const e of events.slice(answer + 1)) {
    if (e.kind === 'user') {
      if (e.phase === 'sketch') return false;
      asked = true;
    }
    const file = e.kind === 'tool_use' && ['Write', 'Edit', 'MultiEdit'].includes(e.name ?? '') ? (e.input as { file_path?: unknown } | undefined)?.file_path : null;
    if (asked && typeof file === 'string' && /(^|[\\/])plan\.md$/.test(file)) return false;
  }
  return true;
}

/**
 * A short reply that approves Claude's last proposal: "go", "go ahead", "approved", "lgtm", "sure, go", "A".
 * A bare "yes" or "ok" is left out: in the chat it could answer any question. On a waiting plan card it does approve (typedAnswer.ts).
 */
export function approvalReply(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length > 40) return null;
  if (/^(go( ahead)?|(ok|okay|yes|sure),? go( ahead)?|approved?|lgtm|looks good,? go( ahead)?|build it|do it|(go with )?(option )?[a-c])([.!]|,? (please|thanks))?$/i.test(t)) return t;
  // "go, keep the voice button"
  return /^(go|approved?)[,.:] \S/i.test(t) ? t : null;
}
