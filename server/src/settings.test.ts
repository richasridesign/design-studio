import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/design.js';
import { clean, publicSettings } from './settings.js';

describe('settings from an older file', () => {
  it('loads, and drops the Figma token and team ID it held', () => {
    const old = { ...DEFAULT_SETTINGS, figmaToken: 'figd_secret', teamId: '123', autoCheck: false, dailyBudgetUsd: 5 } as any;
    const s = clean(old);
    expect(s).not.toHaveProperty('figmaToken');
    expect(s).not.toHaveProperty('teamId');
    expect(s.autoCheck).toBe(false);
    expect(s.dailyBudgetUsd).toBe(5);
    expect(JSON.stringify(publicSettings(s))).not.toContain('figd_');
  });

  it('ignores a token sent by an older page', () => {
    expect(clean({ ...DEFAULT_SETTINGS, ...({ figmaToken: 'figd_new' } as any) })).toEqual(DEFAULT_SETTINGS);
  });

});
