import { WHY_MAX, type OptionId, type WorkflowState } from '../../../shared/workflow';

// The pick card's fields as pure helpers, so every state is tested without a browser: no pick (Build off), picked
// (Build names it), Why typing (count past 120), Why too long or on two lines (error, Build off), and starting.

export const WHY_COUNT_AT = 120;
export type PickFields = { id: OptionId | null; why: string };

/** What was picked before (the card shown again) is kept. */
export const initialPick = (s: Pick<WorkflowState, 'picked' | 'options'>): PickFields => ({
  id: s.picked && s.options?.some((o) => o.id === s.picked!.id) ? s.picked.id : null,
  why: s.picked?.why ?? '',
});

export const whyError = (why: string) => (/[\r\n]/.test(why) || why.trim().length > WHY_MAX ? `Keep it to one line, ${WHY_MAX} characters at most` : '');

/** "132 of 160", shown only past 120 characters. */
export const whyCount = (why: string) => (why.length > WHY_COUNT_AT ? `${why.length} of ${WHY_MAX}` : '');

export const canBuild = (f: PickFields) => !!f.id && !whyError(f.why);

/** Why Build is off, for its tooltip. Empty when it is on. */
export const buildBlocked = (f: PickFields, running: boolean) =>
  !f.id ? 'Pick an option first' : whyError(f.why) ? 'Shorten the reason first' : running ? 'Wait for Claude to finish this turn' : '';

export const buildLabel = (f: PickFields, starting: boolean) => (starting ? 'Starting…' : f.id ? `Build ${f.id} in high fidelity` : 'Build in high fidelity');

/** The short message she sees in the chat. The full High fidelity prompt rides along once (stepPrompt). */
export function buildMessage(s: Pick<WorkflowState, 'options'>, id: OptionId, flow: { n: number; name: string }) {
  const o = s.options?.find((x) => x.id === id);
  return `Build Option ${id}${o ? `: ${o.name}` : ''} of Flow ${flow.n} · ${flow.name} in high fidelity.`;
}

/** What the card posts: the pick, then the ask for High fidelity. */
export const pickBody = (f: PickFields) => ({ action: 'pick' as const, id: f.id!, ...(f.why.trim() ? { why: f.why.trim() } : {}) });
