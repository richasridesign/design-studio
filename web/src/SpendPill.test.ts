import { describe, expect, it } from 'vitest';
import { parseSpend } from './SpendPill';

describe('parseSpend', () => {
  it('reads a good reply', () => {
    expect(parseSpend({ today: { costUsd: 1.5, tokens: 1200 }, budgetUsd: 5 })).toEqual({ today: { costUsd: 1.5, tokens: 1200 }, budgetUsd: 5 });
  });

  it('gives null for a reply without today cost, so the status bar keeps working', () => {
    expect(parseSpend({})).toBeNull();
    expect(parseSpend(null)).toBeNull();
    expect(parseSpend({ today: { costUsd: 'x' } })).toBeNull();
  });

  it('fills missing tokens and budget with zero', () => {
    expect(parseSpend({ today: { costUsd: 0.2 } })).toEqual({ today: { costUsd: 0.2, tokens: 0 }, budgetUsd: 0 });
  });
});
