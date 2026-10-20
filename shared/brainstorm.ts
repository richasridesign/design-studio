// Brainstorm: a chat mode where Claude reads Figma but cannot write it. Each turn Claude posts a round with
// brainstorm_update: the problem, its assumptions, 2 or 3 options with a grey-box sketch each, the flow, and questions
// with suggested answers. The server saves every round in the chat's folder (a flow chat's folder is its iteration).

/** What a box in a sketch is. The web draws each as a plain grey box with its label, no styling. */
export const BOX_KINDS = ['header', 'nav', 'tabs', 'text', 'input', 'button', 'list', 'card', 'image'] as const;
export type BoxKind = (typeof BOX_KINDS)[number];
export const FRAMES = ['phone', 'desktop', 'panel'] as const;
export type SketchFrame = (typeof FRAMES)[number];

export type SketchBox = { kind: BoxKind; label?: string };
/** A screen top to bottom: each row holds 1 to 3 boxes side by side. */
export type Sketch = { frame?: SketchFrame; rows: SketchBox[][] };
export type BrainstormOption = { title: string; sketch: Sketch; goodFor: string; watchOut: string };
/** One box of the flow map. A branch is a side path from this step: "when" it happens, and where it goes. */
export type FlowStep = { label: string; branches?: Array<{ when: string; to: string }> };
export type BrainstormQuestion = { text: string; answers: string[] };

export type BrainstormContent = {
  problem: string;
  assumptions: string[];
  options: BrainstormOption[];
  flow: FlowStep[];
  questions: BrainstormQuestion[];
};

export type BrainstormRound = BrainstormContent & {
  /** Round number in the chat's folder, from 1. */
  n: number;
  at: number;
  /** The chat (Claude session id) that posted it: several chats can share one iteration folder. */
  chat: string;
  /** The option she clicked Build this on, by index. */
  chosen?: { option: number; at: number };
};

export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** A sketch in words, for screen readers and for the brief Build this sends. */
export function sketchText(s: Sketch): string {
  return s.rows.map((row) => row.map((b) => (b.label ? `${b.kind} "${b.label}"` : b.kind)).join(' beside ')).join(', then ');
}

export function flowText(steps: FlowStep[]): string {
  return steps.map((s) => s.label + (s.branches?.length ? ` (${s.branches.map((b) => `if ${b.when}: ${b.to}`).join('; ')})` : '')).join(' > ');
}

/** The message Build this sends: the chosen option and its summary as the brief. */
export function buildPrompt(round: BrainstormRound, i: number): string {
  const o = round.options[i];
  return [
    `Build option ${optionLetter(i)}: ${o.title}.`,
    `Problem: ${round.problem}`,
    round.assumptions.length ? `Assumptions: ${round.assumptions.join('; ')}` : '',
    `Good for: ${o.goodFor}`,
    `Watch out: ${o.watchOut}`,
    `Sketch: ${sketchText(o.sketch)}`,
    round.flow.length ? `Flow: ${flowText(round.flow)}` : '',
  ].filter(Boolean).join('\n');
}
