import { describe, expect, it } from 'vitest';
import { limitFrom } from './transcript.js';

describe('limitFrom', () => {
  it('keeps a 0 to 1 share and turns seconds into ms', () => {
    expect(limitFrom({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.12, resetsAt: 1_800_000_000 })).toEqual({ kind: 'five_hour', used: 0.12, resetsAt: 1_800_000_000_000, status: 'allowed' });
  });

  it('reads a percentage and missing fields', () => {
    expect(limitFrom({ status: 'allowed_warning', utilization: 85 })).toEqual({ kind: 'five_hour', used: 0.85, resetsAt: null, status: 'allowed_warning' });
  });
});
