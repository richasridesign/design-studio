import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addSpend, emptySpend, loadChatSpend, rollDay, saveChatSpend } from './spend.js';

describe('addSpend', () => {
  it('accumulates totals by phase and model', () => {
    let s = addSpend(emptySpend(), 'plan', 'opus', 100, 0.5);
    s = addSpend(s, 'plan', 'opus', 50, 0.25);
    s = addSpend(s, 'review', 'sonnet', 10, 0.1);
    expect(s.tokens).toBe(160);
    expect(s.costUsd).toBeCloseTo(0.85);
    expect(s.byPhase.plan).toEqual({ tokens: 150, costUsd: 0.75 });
    expect(s.byModel.sonnet).toEqual({ tokens: 10, costUsd: 0.1 });
  });
  it('does not mutate its input', () => {
    const s = emptySpend();
    addSpend(s, 'chat', 'm', 1, 1);
    expect(s).toEqual(emptySpend());
  });
});

describe('rollDay', () => {
  it('keeps the same day', () => {
    const d = { day: '2026-10-17', costUsd: 2, tokens: 9 };
    expect(rollDay(d, '2026-10-17')).toBe(d);
  });
  it('resets on a new day', () => expect(rollDay({ day: '2026-10-16', costUsd: 2, tokens: 9 }, '2026-10-17')).toEqual({ day: '2026-10-17', costUsd: 0, tokens: 0 }));
});

describe('chat spend file', () => {
  it('saves and loads spend per session id', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'spend-'));
    try {
      const a = addSpend(emptySpend(), 'chat', 'opus', 10, 0.5);
      await saveChatSpend(dir, 'a', a);
      await saveChatSpend(dir, 'b', emptySpend());
      expect(await loadChatSpend(dir, 'a')).toEqual(a);
      expect(await loadChatSpend(dir, 'b')).toEqual(emptySpend());
      expect(await loadChatSpend(dir, 'c')).toEqual(emptySpend());
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
