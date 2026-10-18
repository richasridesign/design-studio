import { approvalReply } from '../../../shared/stages';
import type { PendingRequest } from '../../../shared/protocol';

/**
 * A bare go word ("go", "approved", "build it"): approve as it is.
 * A letter or "go, keep X" also approves, and her words ride along as a note.
 */
export function plainGo(text: string) {
  const t = text.trim();
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
 * A question: her words answer it (one line like "error message B, voice 2" can answer several).
 * Other permission cards return null: the message steers Claude as before.
 */
export function typedAnswer(text: string, pending: PendingRequest | undefined): TypedAnswer | null {
  const t = text.trim();
  if (!t || !pending) return null;
  if (pending.kind === 'question') return { type: 'answer', id: pending.id, answers: Object.fromEntries(pending.questions.map((q) => [q.question, t])) };
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
