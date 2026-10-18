import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { failedAreas, outline, reviewersFor, rulesPrompt, rulesReviewer, runReview, toFix } from './review.js';

vi.mock('./frameRead.js', async (orig) => ({ ...(await orig<typeof import('./frameRead.js')>()), readFrames: vi.fn(async () => ({ docs: [], shots: [], missing: [], truncated: false, costUsd: 0, ms: 0 })) }));
vi.mock('./rules.js', async (orig) => ({ ...(await orig<typeof import('./rules.js')>()), readRules: vi.fn(async () => ({ global: '', file: '' })) }));
vi.mock('./awaiting.js', () => ({ awaitFindings: vi.fn(async () => null) }));
vi.mock('./lean.js', () => ({ lean: vi.fn(async () => ({ data: { pass: true, summary: 'ok', findings: [] }, tokens: 1, costUsd: 0, text: '' })) }));

describe('reviewersFor', () => {
  it('runs no model for check', () => expect(reviewersFor('check', ['system'], null)).toEqual([]));
  it('runs one combined reviewer for quick', () => expect(reviewersFor('quick', [], null)).toEqual(['all']));
  it('runs ticked areas for focused, in her order', () => expect(reviewersFor('focused', ['accessibility', 'system'], null)).toEqual(['system', 'accessibility']));
  it('runs all five for full, then only failed ones', () => {
    expect(reviewersFor('full', [], null)).toEqual(['system', 'interaction', 'visual', 'writing', 'accessibility']);
    expect(reviewersFor('full', [], ['visual'])).toEqual(['visual']);
  });
  it('skips quick re-review when nothing failed', () => expect(reviewersFor('quick', [], [])).toEqual([]));
  it('runs focused with nothing ticked as quick', () => expect(reviewersFor('focused', [], null)).toEqual(['all']));
});

describe('review results', () => {
  const run = {
    id: 'r', kind: 'review' as const, at: 0, round: 1, preset: 'full' as const, frames: [], tokens: 0, costUsd: 0,
    check: [{ id: 'c', area: 'system' as const, node: '1:1', severity: 'major' as const, rule: 'x', fix: 'y' }],
    results: [{ area: 'visual' as const, pass: false, summary: '', tokens: 0, costUsd: 0, findings: [
      { id: 'a', area: 'visual' as const, node: '1:2', severity: 'major' as const, rule: 'x', fix: 'y' },
      { id: 'b', area: 'system' as const, node: '1:3', severity: 'minor' as const, rule: 'x', fix: 'y' },
    ] }],
  };
  it('lists failed areas from major findings only', () => expect(failedAreas(run)).toEqual(['visual']));
  it('fixes check and major findings, not minor', () => expect(toFix(run).map((f) => f.id)).toEqual(['c', 'a']));
  it('leaves findings that need her decision out of the fix round', () => {
    const shared = { ...run, results: [{ ...run.results[0], findings: [{ ...run.results[0].findings[0], decide: 'text/muted token' }] }] };
    expect(toFix(shared).map((f) => f.id)).toEqual(['c']);
    expect(failedAreas(shared)).toEqual([]);
  });
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

const frame = { docs: [{ id: '1:1', document: { id: '1:1', name: 'Home', type: 'FRAME', children: [] }, components: {} }], shots: [], missing: [], truncated: false, costUsd: 0, ms: 0 };

describe('runReview progress', () => {
  it('reports the check then the quick reviewer', async () => {
    const { readFrames } = await import('./frameRead.js');
    vi.mocked(readFrames).mockResolvedValueOnce(frame);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const calls: string[] = [];
    await runReview({ dir, fileKey: 'k', frames: ['1:1'], preset: 'quick', areas: [], round: 1, kind: 'review', onArea: (a, s) => calls.push(`${a}:${s}`) });
    expect(calls).toEqual(['check:running', 'check:pass', 'all:running', 'all:pass']);
  });
});

describe('house rules in a review', () => {

  it('picks one reviewer to check the rules', () => {
    expect(rulesReviewer(['all'])).toBe('all');
    expect(rulesReviewer(['visual', 'system'])).toBe('system');
    expect(rulesReviewer(['visual', 'writing'])).toBe('visual');
    expect(rulesReviewer([])).toBeNull();
  });

  it('numbers the rules and names the frames', () => {
    const text = rulesPrompt(['No shadows', '4px grid'], ['1:1', '1:2']);
    expect(text).toContain('1. No shadows\n2. 4px grid');
    expect(text).toContain('from: 1:1, 1:2');
  });

  it('asks only the checker for verdicts and stores them on the run', async () => {
    const { readFrames } = await import('./frameRead.js');
    const { lean } = await import('./lean.js');
    const { readRules } = await import('./rules.js');
    vi.mocked(readFrames).mockResolvedValueOnce(frame);
    vi.mocked(readRules).mockResolvedValueOnce({ global: '- No shadows', file: '- 4px grid\n- Sentence case' });
    vi.mocked(lean).mockClear();
    vi.mocked(lean).mockImplementation(async (_p: string, o: { schema?: any }) => ({
      data: { pass: true, summary: 'ok', findings: [], ...(o.schema?.properties?.rules ? { rules: [{ n: 1, state: 'fail', frames: ['1-1'] }, { n: 2, state: 'pass', frames: [] }] } : {}) },
      tokens: 1, costUsd: 0, text: '',
    }) as never);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const run = await runReview({ dir, fileKey: 'k', frames: ['1:1'], preset: 'focused', areas: ['system', 'interaction'], round: 1, kind: 'review' });
    const schemas = vi.mocked(lean).mock.calls.map((c) => Boolean((c[1] as any).schema.properties.rules));
    expect(schemas.filter(Boolean)).toHaveLength(1);
    expect(run.rules).toEqual([
      { rule: 'No shadows', state: 'fail', frames: ['1:1'] },
      { rule: '4px grid', state: 'pass', frames: [] },
      { rule: 'Sentence case', state: 'unchecked', frames: [] },
    ]);
    expect(run.rulesError).toBeUndefined();
  });

  it('turns a global finding into one that waits for her decision', async () => {
    const { readFrames } = await import('./frameRead.js');
    const { lean } = await import('./lean.js');
    const { awaitFindings } = await import('./awaiting.js');
    vi.mocked(readFrames).mockResolvedValueOnce(frame);
    vi.mocked(lean).mockImplementation(async () => ({
      data: { pass: false, summary: 's', findings: [
        { area: 'accessibility', node: '1:1', severity: 'major', rule: 'Muted text fails contrast', fix: 'Darken text/muted', global: true, impact: 'text/muted token, 70 layers' },
        { area: 'visual', node: '1:1', severity: 'major', rule: 'Card is short', fix: 'Fill height', global: false, impact: '' },
      ] },
      tokens: 1, costUsd: 0, text: '',
    }) as never);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const run = await runReview({ dir, fileKey: 'k', frames: ['1:1'], preset: 'quick', areas: [], round: 1, kind: 'review' });
    const found = run.results[0].findings;
    expect(found.map((f) => f.decide)).toEqual(['text/muted token, 70 layers', undefined]);
    expect(found[0]).not.toHaveProperty('global');
    expect(toFix(run).map((f) => f.rule)).toEqual(['Card is short']);
    expect(vi.mocked(awaitFindings)).toHaveBeenCalledWith(dir, 'k', found);
  });

  it('leaves rules off a check-only run', async () => {
    const { readFrames } = await import('./frameRead.js');
    const { readRules } = await import('./rules.js');
    vi.mocked(readFrames).mockResolvedValueOnce(frame);
    vi.mocked(readRules).mockResolvedValue({ global: '- No shadows', file: '' });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const run = await runReview({ dir, fileKey: 'k', frames: ['1:1'], preset: 'check', areas: [], round: 0, kind: 'audit' });
    expect(run.rules).toBeUndefined();
    vi.mocked(readRules).mockResolvedValue({ global: '', file: '' });
  });
});
