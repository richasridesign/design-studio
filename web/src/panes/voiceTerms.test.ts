import { describe, expect, it } from 'vitest';
import { fixTerms } from './voiceTerms';

describe('fixTerms', () => {
  it('fixes misheard tool names', () => {
    expect(fixTerms('put it in fake jam')).toBe('put it in FigJam');
    expect(fixTerms('open the PicJam board')).toBe('open the FigJam board');
    expect(fixTerms('use lucid icons')).toBe('use Lucide icons');
    expect(fixTerms('check w cag and the e vals')).toBe('check WCAG and the evals');
    expect(fixTerms('ask atlas')).toBe('ask Atlas');
  });

  it('leaves normal words alone', () => {
    expect(fixTerms('a lucid explanation of the jam session')).toBe('a lucid explanation of the jam session');
  });
});
