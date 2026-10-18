import { describe, expect, it } from 'vitest';
import { MARKS, MARK_ALIASES, markCss, type MarkKind } from './marks.js';

describe('status marks', () => {
  it('gives every meaning its own shape and colour, except kinds that mean the same thing', () => {
    const same = (a: MarkKind, b: MarkKind) => MARK_ALIASES.some((g) => g.includes(a) && g.includes(b));
    const kinds = Object.keys(MARKS) as MarkKind[];
    for (const a of kinds) for (const b of kinds) {
      if (a >= b) continue;
      const clash = MARKS[a].shape === MARKS[b].shape && MARKS[a].tone === MARKS[b].tone;
      expect(clash, `${a} and ${b}`).toBe(same(a, b));
    }
  });

  it('keeps red for blocking and failed only, and amber for major', () => {
    const red = (Object.keys(MARKS) as MarkKind[]).filter((k) => MARKS[k].tone === 'error');
    expect(red.sort()).toEqual(['blocking', 'error', 'fail']);
    expect(MARKS.major).toEqual({ shape: 'triangle', tone: 'warn' });
    expect(MARKS.minor.shape).toBe('ring');
    expect(MARKS.fail.shape).toBe('x');
  });

  it('writes one rule per kind with the colours given', () => {
    const css = markCss('st', { error: 'red', warn: 'amber', ok: 'green', muted: 'grey', ink: 'black' });
    expect(css).toContain('.st.blocking::before { background: red; border-radius: 2px; }');
    expect(css).toContain('.st.minor::before { border: 2px solid grey; border-radius: 50%; }');
    expect(css.match(/::before/g)).toHaveLength(Object.keys(MARKS).length + 1);
  });
});
