import { describe, expect, it } from 'vitest';
import { reviewChecklist } from './design';

describe('reviewChecklist', () => {
  const base = { check: [], results: [], frames: ['1:2'] };

  it('lists failed house rules after the findings, with frame links', () => {
    const text = reviewChecklist({ ...base, rules: [
      { rule: 'One primary button per screen.', state: 'fail', frames: ['1:2'] },
      { rule: 'Sentence case', state: 'pass', frames: [] },
      { rule: 'Tooltips', state: 'unchecked', frames: [] },
    ] }, 'KEY');
    expect(text.split('\n')[0]).toBe('Review of 1 frame: 0 issues, 1 house rule failed');
    expect(text).toContain('- [ ] **house rule** One primary button per screen: fails on https://www.figma.com/design/KEY?node-id=1-2');
    expect(text).not.toContain('Sentence case');
    expect(text).not.toContain('Tooltips');
  });

  it('keeps the plain head when no rule failed', () => {
    expect(reviewChecklist(base, null)).toBe('Review of 1 frame: 0 issues');
  });
});
