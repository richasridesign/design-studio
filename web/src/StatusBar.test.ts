import { describe, expect, it } from 'vitest';
import { cacheLeft, figmaState } from './StatusBar';

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
