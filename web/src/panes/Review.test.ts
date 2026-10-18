import { describe, expect, it } from 'vitest';
import { ago, areaRows, canGoDeeper, isStale, mergeRuns, retryPrompt, runLabel, shownPreset, summarize, unposted } from './reviewRuns';
import type { CopyRun, CritRun, Finding, ReviewRun } from '../../../shared/design';

const finding = (severity: Finding['severity']): Finding => ({ id: severity, area: 'color', severity, rule: 'r', fix: 'f', node: '1:2' }) as Finding;
const review = (id: string, at: number, over: Partial<ReviewRun> = {}): ReviewRun => ({ id, kind: 'review', at, round: 1, preset: 'quick', frames: [], check: [], results: [], tokens: 0, costUsd: 0, ...over });
const crit = (id: string, at: number): CritRun => ({ id, at, frames: [], summary: '', tokens: 5, costUsd: 0, personas: [{ id: 'new-user', verdict: '', points: [{ kind: 'like', text: 'a' }, { kind: 'idea', text: 'b' }] }] }) as CritRun;
const copy = (id: string, at: number): CopyRun => ({ id, at, frames: [], tone: 'friendly', items: [{ nodeId: '1', before: 'a', after: 'b', reason: '' }], tokens: 0, costUsd: 0 });

describe('mergeRuns', () => {
  it('sorts all kinds newest first and labels audits', () => {
    const rows = mergeRuns([review('a', 1), review('b', 4, { kind: 'audit' }), review('c', 5, { preset: 'check' })], [crit('d', 3)], [copy('e', 2)]);
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['audit:c', 'audit:b', 'crit:d', 'copy:e', 'review:a']);
  });

  it('returns nothing without runs', () => {
    expect(mergeRuns([], [], [])).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts blocking and major findings across check and reviewers', () => {
    const run = review('a', 1, { check: [finding('blocking'), finding('minor')], results: [{ area: 'all', pass: false, summary: '', findings: [finding('major'), finding('major')], tokens: 0 }] as ReviewRun['results'] });
    expect(summarize({ kind: 'review', id: 'a', at: 1, tokens: 0, run })).toBe('1 blocking, 2 major');
  });

  it('says No issues when only minor findings remain', () => {
    const run = review('a', 1, { check: [finding('minor')] });
    expect(summarize({ kind: 'review', id: 'a', at: 1, tokens: 0, run })).toBe('No issues');
  });

  it('counts crit notes and copy changes', () => {
    expect(summarize(mergeRuns([], [crit('a', 1)], [])[0])).toBe('2 notes');
    expect(summarize(mergeRuns([], [], [copy('a', 1)])[0])).toBe('1 change');
  });
});

describe('shownPreset', () => {
  it('shows check and focused as quick', () => {
    expect(['check', 'quick', 'focused', 'full'].map((p) => shownPreset(p as 'check'))).toEqual(['quick', 'quick', 'quick', 'full']);
  });
});

describe('ago', () => {
  it('formats relative time', () => {
    expect(ago(0, 30_000)).toBe('just now');
    expect(ago(0, 5 * 60_000)).toBe('5m ago');
    expect(ago(0, 3 * 3600_000)).toBe('3h ago');
    expect(ago(0, 2 * 86400_000)).toBe('2d ago');
  });
});

describe('review card helpers', () => {
  it('labels runs and offers a deeper review only for quick and check presets', () => {
    expect(runLabel(review('a', 1))).toBe('Review 1 · Quick');
    expect(runLabel(review('a', 1, { kind: 'audit' }))).toBe('File audit');
    expect(canGoDeeper(review('a', 1))).toBe(true);
    expect(canGoDeeper(review('a', 1, { preset: 'full' }))).toBe(false);
  });

  it('lists the check first and marks failed reviewers', () => {
    const run = review('a', 1, { check: [finding('major')], results: [{ area: 'all', pass: false, summary: '', findings: [], tokens: 0, costUsd: 0, error: 'boom' }] });
    expect(areaRows(run)).toEqual([{ key: 'check', name: 'Design system check', pass: false, failed: false }, { key: 'all', name: 'All areas', pass: false, failed: true }]);
  });

  it('skips posted and minor findings', () => {
    const run = review('a', 1, { check: [finding('blocking'), finding('major'), finding('minor')] });
    expect(unposted(run, { runs: [run], posted: ['major'] }).map((f) => f.id)).toEqual(['blocking']);
  });
});

describe('isStale', () => {
  const at = Date.parse('2026-01-01T00:00:00Z');
  it('is true when the file changed after the latest run', () => {
    expect(isStale({ at }, '2026-01-02T00:00:00Z', at)).toBe(true);
  });
  it('is false when the file changed before the run', () => {
    expect(isStale({ at }, '2025-12-31T00:00:00Z', at)).toBe(false);
  });
  it('is false for a run that is not the latest', () => {
    expect(isStale({ at }, '2026-01-02T00:00:00Z', at + 1)).toBe(false);
  });
  it('is false for missing or invalid lastModified', () => {
    for (const v of [null, undefined, '', 'nope']) expect(isStale({ at }, v, at)).toBe(false);
  });
});

describe('retryPrompt', () => {
  it('reruns the same preset on the same frames when a reviewer failed', () => {
    const run = review('a', 1, { preset: 'full', frames: ['1:2', '3:4'], results: [{ area: 'all', pass: false, summary: '', findings: [], tokens: 0, costUsd: 0, error: 'boom' }] });
    expect(retryPrompt(run)).toBe('/review full 1:2 3:4');
  });
  it('is null when nothing failed', () => {
    expect(retryPrompt(review('a', 1))).toBeNull();
  });
});
