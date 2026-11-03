import type { Frame } from './types.js';

// Steps on a flow board, numbered like her Figma flow sections: 1, 2, 3 on the main path and N.1, N.2 for the side
// states of step N.

/** The next main step on a flow board: one more than the highest whole step. */
export function nextStep(frames: Frame[]): string {
  return String(frames.reduce((m, f) => Math.max(m, /^\d+$/.test(f.n ?? '') ? Number(f.n) : 0), 0) + 1);
}

/**
 * Steps back in order with no gaps after a frame goes: whole steps become 1, 2, 3 in their old order, and a side
 * state N.k follows its step (its own k also closes up). A side state whose step is gone becomes a whole step.
 */
export function renumber(frames: Frame[]): Frame[] {
  const key = (n: string) => n.split('.').map(Number);
  const numbered = frames.filter((f) => /^\d+(\.\d+)?$/.test(f.n ?? ''));
  const mains = numbered.filter((f) => !f.n!.includes('.') || !numbered.some((g) => g.n === f.n!.split('.')[0]));
  const order = [...new Set(mains.map((f) => key(f.n!)[0]))].sort((a, b) => a - b);
  const main = new Map(order.map((n, i) => [n, i + 1]));
  const sub = new Map<string, string>();
  for (const n of order) {
    const sides = numbered.filter((f) => f.n!.includes('.') && key(f.n!)[0] === n && numbered.some((g) => g.n === String(n))).sort((a, b) => key(a.n!)[1] - key(b.n!)[1]);
    sides.forEach((f, i) => sub.set(f.id, `${main.get(n)}.${i + 1}`));
  }
  return frames.map((f) => {
    if (!f.n || !numbered.includes(f)) return f;
    const n = sub.get(f.id) ?? String(main.get(key(f.n)[0]));
    return n === f.n ? f : { ...f, n };
  });
}

/** Parks a frame as a tried option (kept, out of the flow) with its side states, or brings it back as the next step. */
export function park(frames: Frame[], id: string, on: boolean): Frame[] {
  const f = frames.find((x) => x.id === id);
  if (!f) return frames;
  if (!on) return frames.map((x) => (x.id === id ? { ...x, parked: undefined, n: x.n ?? nextStep(frames) } : x));
  const step = f.n && !f.n.includes('.') ? f.n : null;
  const goes = (x: Frame) => x.id === id || (!!step && x.n?.split('.')[0] === step && x.n.includes('.'));
  return renumber(frames.map((x) => (goes(x) ? { ...x, parked: true, n: undefined } : x)));
}

/** The next side state of a step: "3" or "3.1" gives "3.2" when 3.1 exists, else "3.1". */
export function nextSide(frames: Frame[], of: string): string {
  const main = of.split('.')[0];
  const used = frames.flatMap((f) => (f.n?.startsWith(`${main}.`) ? [Number(f.n.split('.')[1])] : []));
  return `${main}.${used.length ? Math.max(...used) + 1 : 1}`;
}

export const stepKey = (n?: string) => (n && /^\d+(\.\d+)?$/.test(n) ? n.split('.').map(Number) : [Infinity, 0]);
