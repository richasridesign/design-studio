import { describe, expect, it } from 'vitest';
import { ago } from './ago';

const now = new Date(2026, 9, 18, 22, 0).getTime();
const back = (min: number) => now - min * 60_000;

describe('ago', () => {
  it('says minutes and hours the same way everywhere', () => {
    expect(ago(back(0.5), now)).toBe('just now');
    expect(ago(back(15), now)).toBe('15 min ago');
    expect(ago(back(180), now)).toBe('3 h ago');
  });

  it('names yesterday, then days, then the date', () => {
    expect(ago(new Date(2026, 9, 17, 9, 0).getTime(), now)).toBe('yesterday');
    expect(ago(new Date(2026, 9, 14, 9, 0).getTime(), now)).toBe('4 days ago');
    expect(ago(new Date(2026, 9, 2, 9, 0).getTime(), now)).toBe('2 Oct');
  });
});
