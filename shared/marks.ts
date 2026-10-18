// Status marks: one shape and one colour per meaning, used by the Review pane, the timeline review card and the
// handoff report. Every mark sits next to a text label, so the shape and colour are never the only cue.

export type MarkShape = 'square' | 'triangle' | 'ring' | 'x' | 'check' | 'dash' | 'slash' | 'box' | 'diamond';
export type MarkTone = 'error' | 'warn' | 'ok' | 'muted' | 'ink';

export const MARKS = {
  /** Findings by severity. Red only for blocking, amber for major. */
  blocking: { shape: 'square', tone: 'error' },
  major: { shape: 'triangle', tone: 'warn' },
  minor: { shape: 'ring', tone: 'muted' },
  /** A failed house rule, a failed area or a reviewer that errored. */
  fail: { shape: 'x', tone: 'error' },
  error: { shape: 'x', tone: 'error' },
  /** Passed, followed, chosen, approved, fixed. */
  pass: { shape: 'check', tone: 'ok' },
  fixed: { shape: 'check', tone: 'ok' },
  /** Not checked, not run yet, later. */
  none: { shape: 'dash', tone: 'muted' },
  unchecked: { shape: 'dash', tone: 'muted' },
  wontfix: { shape: 'slash', tone: 'muted' },
  parked: { shape: 'box', tone: 'muted' },
  current: { shape: 'diamond', tone: 'ink' },
  /** A question waiting for her answer (a long run asked it). */
  question: { shape: 'diamond', tone: 'warn' },
} as const satisfies Record<string, { shape: MarkShape; tone: MarkTone }>;

export type MarkKind = keyof typeof MARKS;

/** Kinds that share a mark on purpose, because they mean the same thing. */
export const MARK_ALIASES: MarkKind[][] = [['fail', 'error'], ['pass', 'fixed'], ['none', 'unchecked']];

const X = 'polygon(20% 0, 50% 30%, 80% 0, 100% 20%, 70% 50%, 100% 80%, 80% 100%, 50% 70%, 20% 100%, 0 80%, 30% 50%, 0 20%)';
const CHECK = 'polygon(0 55%, 16% 40%, 38% 62%, 84% 12%, 100% 28%, 38% 94%)';
const TRIANGLE = 'polygon(50% 0, 100% 100%, 0 100%)';

function shapeCss(shape: MarkShape, c: string): string {
  switch (shape) {
    case 'square': return `background: ${c}; border-radius: 2px;`;
    case 'triangle': return `background: ${c}; clip-path: ${TRIANGLE};`;
    case 'ring': return `border: 2px solid ${c}; border-radius: 50%;`;
    case 'x': return `background: ${c}; clip-path: ${X};`;
    case 'check': return `background: ${c}; clip-path: ${CHECK};`;
    case 'dash': return `background: linear-gradient(${c}, ${c}) center / 100% 2px no-repeat;`;
    case 'slash': return `background: linear-gradient(-45deg, transparent calc(50% - 1px), ${c} calc(50% - 1px), ${c} calc(50% + 1px), transparent calc(50% + 1px));`;
    case 'box': return `border: 2px solid ${c}; border-radius: 2px;`;
    case 'diamond': return `background: ${c}; transform: rotate(45deg) scale(0.75);`;
  }
}

/** CSS for `.<cls>.<kind>::before`, with the colour for each tone. The app and the report each pass their own colours. */
export function markCss(cls: string, tones: Record<MarkTone, string>, size = 12): string {
  const base = `.${cls}::before { content: ''; flex: none; display: inline-block; width: ${size}px; height: ${size}px; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
  const kinds = (Object.keys(MARKS) as MarkKind[]).map((k) => `.${cls}.${k}::before { ${shapeCss(MARKS[k].shape, tones[MARKS[k].tone])} }`);
  return [base, ...kinds].join('\n');
}
