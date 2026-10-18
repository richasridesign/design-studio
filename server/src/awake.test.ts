import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { keepAwake } from './awake.js';

function fakeSpawn(pid: number | null = 4321) {
  const child = Object.assign(new EventEmitter(), { pid: pid ?? undefined, exitCode: null as number | null, killed: false, unref: vi.fn(), kill: vi.fn(() => { child.killed = true; return true; }) });
  const fn = vi.fn(() => child);
  return { fn: fn as unknown as typeof import('node:child_process').spawn, calls: fn.mock.calls as unknown as Array<[string, string[]]>, child };
}

describe('keepAwake', () => {
  it('does nothing off macOS', () => {
    const s = fakeSpawn();
    expect(keepAwake(Date.now() + 60_000, { platform: 'linux', spawnFn: s.fn })).toBeNull();
    expect(s.calls).toHaveLength(0);
  });

  it('runs caffeinate tied to the server until the end time, and the stop function kills it once', () => {
    const s = fakeSpawn();
    const stop = keepAwake(10_000 + 2 * 3600_000, { now: 10_000, platform: 'darwin', spawnFn: s.fn });
    expect(s.calls[0][0]).toBe('/usr/bin/caffeinate');
    expect(s.calls[0][1]).toEqual(['-i', '-w', String(process.pid), '-t', '7200']);
    stop!();
    stop!();
    expect(s.child.kill).toHaveBeenCalledTimes(1);
  });

  it('returns null when caffeinate does not start', () => {
    expect(keepAwake(Date.now() + 60_000, { platform: 'darwin', spawnFn: fakeSpawn(null).fn })).toBeNull();
  });
});
