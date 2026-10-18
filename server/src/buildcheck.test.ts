import { describe, expect, it } from 'vitest';
import { buildChecklist, reviewChecklist, type Finding } from '../../shared/design.js';
import { clampWidth, parseBuildArg } from './buildcheck.js';

describe('parseBuildArg', () => {
  it('reads the url, the frame and an optional width', () => {
    expect(parseBuildArg('http://localhost:3000/a Home (https://www.figma.com/design/abcdefghij1?node-id=1-2) width:5000')).toEqual({ url: 'http://localhost:3000/a', width: 1920, frames: ['1:2'] });
    expect(parseBuildArg('https://example.com')).toEqual({ url: 'https://example.com/', width: null, frames: [] });
  });
  it('rejects other schemes and missing urls', () => {
    expect(parseBuildArg('file:///etc/passwd')).toHaveProperty('error');
    expect(parseBuildArg('javascript:alert(1)')).toHaveProperty('error');
    expect(parseBuildArg('')).toHaveProperty('error');
  });
});

describe('clampWidth', () => {
  it('keeps the width between 320 and 1920', () => {
    expect([clampWidth(100), clampWidth(800.4), clampWidth(4000)]).toEqual([320, 800, 1920]);
  });
});

describe('buildChecklist', () => {
  it('writes one checkbox per difference', () => {
    const md = buildChecklist({ url: 'http://x', frameName: 'Home', matchScore: 80, diffs: [{ area: 'Hero', kind: 'spacing', severity: 'major', figma: '24px gap', site: '12px gap', fix: 'Set the gap to 24px', nodeId: '1:2' }] });
    expect(md).toBe('Build check of http://x against Home: 80% match, 1 difference\n\n- [ ] **major** (spacing) Hero: Set the gap to 24px Figma: 24px gap. Site: 12px gap. Node 1:2.');
  });
});

describe('reviewChecklist', () => {
  const f = (severity: Finding['severity'], node: string, nodeName?: string, rule = 'Rule'): Finding => ({ id: node + severity, area: 'check', node, nodeName, severity, rule, fix: 'Fix it' });
  const results = [{ area: 'all' as const, pass: false, summary: '', findings: [f('blocking', '3:4', 'Card')] }];

  it('sorts by severity across check and results', () => {
    const md = reviewChecklist({ frames: ['1:1', '1:2'], check: [f('minor', '1:2', 'A'), f('major', '1:3', 'B')], results }, null);
    expect(md.split('\n')).toEqual([
      'Review of 2 frames: 3 issues',
      '',
      '- [ ] **blocking** Card: Rule. Fix: Fix it',
      '- [ ] **major** B: Rule. Fix: Fix it',
      '- [ ] **minor** A: Rule. Fix: Fix it',
    ]);
  });
  it('links nodes only when a file key is given', () => {
    const run = { frames: ['1:1'], check: [f('major', '1:2', 'A'), f('minor', '', 'B')], results: [] };
    expect(reviewChecklist(run, 'abc')).toContain('- [ ] **major** A: Rule. Fix: Fix it (https://www.figma.com/design/abc?node-id=1-2)');
    expect(reviewChecklist(run, 'abc').endsWith('- [ ] **minor** B: Rule. Fix: Fix it')).toBe(true);
    expect(reviewChecklist(run, null)).not.toContain('http');
  });
  it('falls back to the node id and avoids a doubled period', () => {
    expect(reviewChecklist({ frames: ['1:1'], check: [f('major', '1:2', undefined, 'Too tight.')], results: [] }, null)).toBe('Review of 1 frame: 1 issue\n\n- [ ] **major** 1:2: Too tight. Fix: Fix it');
  });
  it('returns only the header without findings', () => {
    expect(reviewChecklist({ frames: ['1:1'], check: [], results: [] }, 'abc')).toBe('Review of 1 frame: 0 issues');
  });
});
