import { describe, expect, it, vi } from 'vitest';
import { acquireWrite, isLocked, waiting, withWrite } from './figmaLock.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('figma write lock', () => {
  it('runs writes on one file one at a time, in order', async () => {
    const log: string[] = [];
    const a = withWrite('k1', async () => { log.push('a start'); await tick(); await tick(); log.push('a end'); });
    const b = withWrite('k1', async () => { log.push('b start'); log.push('b end'); });
    const c = withWrite('k1', async () => { log.push('c'); });
    await Promise.all([a, b, c]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c']);
    expect(isLocked('k1')).toBe(false);
  });

  it('does not make two files wait for each other', async () => {
    const log: string[] = [];
    const a = withWrite('f1', async () => { log.push('f1 start'); await tick(); await tick(); log.push('f1 end'); });
    const b = withWrite('f2', async () => { log.push('f2'); });
    await Promise.all([a, b]);
    expect(log).toEqual(['f1 start', 'f2', 'f1 end']);
  });

  it('releases on error and when release is called twice', async () => {
    await expect(withWrite('k2', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const release = await acquireWrite('k2');
    expect(isLocked('k2')).toBe(true);
    release();
    release();
    expect(isLocked('k2')).toBe(false);
  });

  it('rejects a waiter after the timeout and keeps the queue count right', async () => {
    vi.useFakeTimers();
    const release = await acquireWrite('k3');
    const late = acquireWrite('k3', 1000);
    expect(waiting('k3')).toBe(1);
    const rejected = late.catch((e: Error) => e.message);
    vi.advanceTimersByTime(1001);
    expect(await rejected).toMatch(/editing this Figma file/);
    expect(waiting('k3')).toBe(0);
    release();
    vi.useRealTimers();
  });

  it('lets a lost holder go after the hold limit', async () => {
    vi.useFakeTimers();
    await acquireWrite('k4');
    // Waits longer than the hold limit, so the lost holder goes before the queue timeout.
    const next = acquireWrite('k4', 200_000);
    vi.advanceTimersByTime(180_001);
    const release = await next;
    release();
    expect(isLocked('k4')).toBe(false);
    vi.useRealTimers();
  });
});
