import type { ChatEvent } from '../../../shared/protocol';

/** One click under Claude's last reply. Answers (go, go with A) send at once; follow-ups fill the message box and wait for her. */
export type QuickReply = { label: string; text: string; send: boolean; title: string };

const LINE_OPTION = /^\s*(?:[-*]\s+|\d+\.\s+|#{1,4}\s+)?(?:\*\*)?(?:option\s+)?([A-C])(?:\*\*)?\s*[:.)]/gim;
const INLINE_OPTION = /\boption\s+([A-C])\b/gi;

/** The option letters a reply offers ("A: ...", "**B.** ...", "Option C"), in order. Fewer than two is not a choice. */
export function optionLetters(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(LINE_OPTION)) found.add(m[1].toUpperCase());
  for (const m of text.matchAll(INLINE_OPTION)) found.add(m[1].toUpperCase());
  const letters = [...found].sort();
  // Options start at A and run on without a gap; a stray "C." alone is a sentence, not a choice.
  return letters.length >= 2 && letters.every((l, i) => l === 'ABC'[i]) ? letters : [];
}

/** True when the end of a reply waits for her go ("Reply go to build", "Want me to apply it?", "Shall I"). */
export function asksForGo(text: string): boolean {
  const tail = text.slice(-400);
  return /\b(reply|say|type|send)\s+["'“*]*go\b/i.test(tail) || /\b(want me to|shall i|should i|ok to|okay to)\b[^.!]*\?/i.test(tail) || /\bwaiting for your (go|approval)\b/i.test(tail);
}

const FOLLOW_UPS: QuickReply[] = [
  { label: 'Apply across all flows', text: 'Apply this across all flows', send: false, title: 'Put "Apply this across all flows" in the message box' },
  { label: 'Why?', text: 'Why', send: false, title: 'Start a "Why" question in the message box' },
  { label: 'Add decision stickies', text: 'Add the two decision stickies to every new or changed screen', send: false, title: 'Put a decision stickies request in the message box' },
];

/** Quick replies for a finished reply: the answers it asks for first, then the follow-ups she sends most. At most four. */
export function quickReplies(reply: string): QuickReply[] {
  const letters = optionLetters(reply);
  const answers: QuickReply[] = letters.length
    ? letters.map((l) => ({ label: `Go with ${l}`, text: `go with ${l}`, send: true, title: `Send "go with ${l}"` }))
    : asksForGo(reply) ? [{ label: 'Go', text: 'go', send: true, title: 'Send "go"' }] : [];
  return [...answers, ...FOLLOW_UPS].slice(0, 4);
}

/** The reply quick replies hang under: Claude's last finished reply, when nothing of hers came after it and the turn was not a review. */
export function replyToAnswer(events: ChatEvent[]): string | null {
  let reply: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') return reply;
    // A review card carries its own next step (Fix the issues), so the reply under it gets no quick replies.
    if (e.kind === 'review') return null;
    if (reply === null && e.kind === 'assistant' && e.text.trim()) {
      if (e.streaming) return null;
      reply = e.text;
    }
  }
  return reply;
}
