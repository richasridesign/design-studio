import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { failedAreas, outline, reviewersFor, runReview, toFix } from './review.js';

vi.mock('./figma.js', () => ({ nodes: vi.fn(async () => ({ nodes: {} })), images: vi.fn(async () => ({})), download: vi.fn() }));
vi.mock('./lean.js', () => ({ lean: vi.fn(async () => ({ data: { pass: true, summary: 'ok', findings: [] }, tokens: 1, costUsd: 0, text: '' })) }));

describe('reviewersFor', () => {
  it('runs no model for check', () => expect(reviewersFor('check', ['color'], null)).toEqual([]));
  it('runs one combined reviewer for quick', () => expect(reviewersFor('quick', [], null)).toEqual(['all']));
  it('runs ticked areas for focused', () => expect(reviewersFor('focused', ['brief', 'color'], null)).toEqual(['color', 'brief']));
  it('runs all six for full, then only failed ones', () => {
    expect(reviewersFor('full', [], null)).toHaveLength(6);
    expect(reviewersFor('full', [], ['spacing'])).toEqual(['spacing']);
  });
  it('skips quick re-review when nothing failed', () => expect(reviewersFor('quick', [], [])).toEqual([]));
});

describe('review results', () => {
  const run = {
    id: 'r', kind: 'review' as const, at: 0, round: 1, preset: 'full' as const, frames: [], tokens: 0, costUsd: 0,
    check: [{ id: 'c', area: 'color' as const, node: '1:1', severity: 'major' as const, rule: 'x', fix: 'y' }],
    results: [{ area: 'spacing' as const, pass: false, summary: '', tokens: 0, costUsd: 0, findings: [
      { id: 'a', area: 'spacing' as const, node: '1:2', severity: 'major' as const, rule: 'x', fix: 'y' },
      { id: 'b', area: 'color' as const, node: '1:3', severity: 'minor' as const, rule: 'x', fix: 'y' },
    ] }],
  };
  it('lists failed areas from major findings only', () => expect(failedAreas(run)).toEqual(['spacing']));
  it('fixes check and major findings, not minor', () => expect(toFix(run).map((f) => f.id)).toEqual(['c', 'a']));
});

describe('outline', () => {
  it('summarizes nodes and stops at instances', () => {
    const doc = { id: '1:1', name: 'Home', type: 'FRAME', absoluteBoundingBox: { width: 390, height: 844 }, children: [
      { id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hello', style: { fontSize: 24, fontWeight: 700 } },
      { id: '1:3', name: 'Btn', type: 'INSTANCE', componentId: 'C', children: [{ id: '1:4', name: 'inner', type: 'TEXT' }] },
    ] };
    const text = outline(doc, { C: { name: 'Button/Primary' } });
    expect(text).toContain('TEXT "Title" 1:2 · 24px 700 "Hello"');
    expect(text).toContain('of Button/Primary');
    expect(text).not.toContain('inner');
  });
});

describe('runReview progress', () => {
  it('reports the check then the quick reviewer', async () => {
    const { nodes } = await import('./figma.js');
    vi.mocked(nodes).mockResolvedValueOnce({ nodes: { '1:1': { document: { id: '1:1', name: 'Home', type: 'FRAME', children: [] }, components: {} } } } as never);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const calls: string[] = [];
    await runReview({ dir, fileKey: 'k', frames: ['1:1'], preset: 'quick', areas: [], round: 1, kind: 'review', onArea: (a, s) => calls.push(`${a}:${s}`) });
    expect(calls).toEqual(['check:running', 'check:pass', 'all:running', 'all:pass']);
  });
});
