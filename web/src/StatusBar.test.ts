import { describe, expect, it } from 'vitest';
import { RETRY_MS, cacheLeft, figmaState, limitText, shouldRetry } from './StatusBar';

describe('figmaState', () => {
  it('reads the Figma plugin status', () => {
    expect(figmaState([{ name: 'github', status: 'connected' }, { name: 'plugin:figma:figma', status: 'needs-auth' }])).toEqual(['warn', 'Needs login']);
    expect(figmaState([{ name: 'plugin:figma:figma', status: 'connected' }])).toEqual(['ok', 'Connected']);
  });

  it('says when Figma is not set up', () => {
    expect(figmaState([{ name: 'github', status: 'connected' }])).toEqual(['off', 'Not set up']);
  });
});

describe('cacheLeft', () => {
  it('counts down and stops at zero', () => {
    expect(cacheLeft({ at: 1000, ttlMs: 300000 }, 61000)).toBe(240000);
    expect(cacheLeft({ at: 1000, ttlMs: 300000 }, 999999)).toBe(0);
    expect(cacheLeft(null, 0)).toBe(0);
  });
});

describe('limitText', () => {
  it('names the window and the share used', () => {
    expect(limitText({ kind: 'five_hour', used: 0.12, resetsAt: null, status: 'allowed' })).toEqual({ label: '5-hour limit: 12% used', resets: '', tone: '' });
  });

  it('warns near the limit and says when it is reached', () => {
    expect(limitText({ kind: 'seven_day', used: 0.85, resetsAt: null, status: 'allowed' }).tone).toBe('warn');
    expect(limitText({ kind: 'five_hour', used: 1, resetsAt: null, status: 'rejected' })).toMatchObject({ label: '5-hour limit: reached', tone: 'bad' });
  });
});

describe('shouldRetry', () => {
  it('retries a Figma login or failure, at most every 30 seconds', () => {
    expect(shouldRetry('needs-auth', 0, RETRY_MS)).toBe(true);
    expect(shouldRetry('failed', 1000, 1000 + RETRY_MS - 1)).toBe(false);
    expect(shouldRetry('connected', 0, RETRY_MS)).toBe(false);
    expect(shouldRetry(undefined, 0, RETRY_MS)).toBe(false);
  });
});
