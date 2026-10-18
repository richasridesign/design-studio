import { approvalReply } from '../../../shared/stages';
import type { PendingRequest } from '../../../shared/protocol';

/**
 * A plain yes while a plan waits ("y", "yes", "ok", "lgtm", "sure, go"). Only read on the plan card:
 * in the chat a bare yes could answer anything, so it does not count as a go there.
 */
const PLAN_YES = /^(y|yes|yep|yeah|ok|okay|lgtm|sure|sounds good|looks good|yes please|(ok|okay|sure|yes),? (please|go( ahead)?))([.!]|,? (please|thanks))?$/i;

/**
 * A bare go word ("go", "approved", "build it", "yes", "ok"): approve as it is.
 * A letter or "go, keep X" also approves, and her words ride along as a note.
 */
export function plainGo(text: string) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (PLAN_YES.test(t)) return true;
  return Boolean(approvalReply(t)) && !/\b[a-c]\b/i.test(t) && !/^(go|approved?)[,.:] \S/i.test(t);
}

/** An approval that carries words: a letter ("A", "go with B"), or go followed by a note of any length ("go but keep the mic"). "go through every dialog" is a new ask, not an approval. */
export function goWithNote(text: string) {
  const t = text.trim();
  if (plainGo(t)) return false;
  return Boolean(approvalReply(t)) || /^((ok|yes),? )?(go( ahead)?|approved?|looks good)(,|\.|:|!| but| and| with)\s+\S/i.test(t);
}

export type TypedAnswer =
  | { type: 'permission'; id: string; allow: boolean; note?: string }
  | { type: 'answer'; id: string; answers: Record<string, string> };

/**
 * What a message typed while a card waits should do, so typing never aborts the card.
 * A plan: a go word approves it, go with words approves it with her words as a note, anything else asks for changes.
 * A question: her words answer it once (one line like "error message B, voice 2" can answer several questions).
 * Other permission cards return null: the message steers Claude as before.
 */
export function typedAnswer(text: string, pending: PendingRequest | undefined): TypedAnswer | null {
  const t = text.trim();
  if (!t || !pending) return null;
  // Her words go once, never copied into every question. They sit under the first question: Claude Code prints
  // only answers keyed by a real question, so a made-up key would be dropped and Claude would see no answer.
  if (pending.kind === 'question') return { type: 'answer', id: pending.id, answers: pending.questions.length ? { [pending.questions[0].question]: t } : {} };
  if (pending.toolName !== 'ExitPlanMode') return null;
  if (plainGo(t)) return { type: 'permission', id: pending.id, allow: true };
  return { type: 'permission', id: pending.id, allow: goWithNote(t), note: t };
}

/** The message box placeholder while a card waits, naming what typing does. */
export function waitingPlaceholder(pending: PendingRequest | undefined) {
  if (pending?.kind === 'question') return 'Type your answer, or pick one above';
  if (pending?.toolName === 'ExitPlanMode') return 'Type go to approve, or what to change';
  return 'Answer above, or steer Claude';
}
