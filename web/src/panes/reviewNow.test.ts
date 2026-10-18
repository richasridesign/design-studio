import { describe, expect, it } from 'vitest';
import { laterSaves, reviewTarget } from './reviewNow';

const v = (id: string, at: string, checkpoint: boolean) => ({ id, at, checkpoint });

describe('reviewTarget', () => {
  it('picks the newest Claude checkpoint, not a newer autosave', () => {
    const list = [v('a', '2026-10-18T15:00:00Z', false), v('b', '2026-10-18T14:00:00Z', true), v('c', '2026-10-18T13:00:00Z', true)];
    expect(reviewTarget(list)?.id).toBe('b');
  });

  it('ignores list order', () => {
    expect(reviewTarget([v('c', '2026-10-18T13:00:00Z', true), v('b', '2026-10-18T14:00:00Z', true)])?.id).toBe('b');
  });

  it('is undefined when Claude saved nothing', () => {
    expect(reviewTarget([v('a', '2026-10-18T15:00:00Z', false)])).toBeUndefined();
  });
});

describe('laterSaves', () => {
  it('counts the designer saves after the checkpoint', () => {
    const t = v('b', '2026-10-18T14:00:00Z', true);
    expect(laterSaves([v('a', '2026-10-18T15:00:00Z', false), t, v('z', '2026-10-18T13:00:00Z', false)], t)).toBe(1);
  });
});
