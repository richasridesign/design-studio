import { describe, expect, it } from 'vitest';
import { rulesBlock } from './rules.js';
import { instructions } from './options.js';

describe('house rules', () => {
  it('is empty without rules', () => expect(rulesBlock({ global: ' ', file: '' })).toBe(''));
  it('joins global and file rules under one heading', () => {
    expect(rulesBlock({ global: '- sentence case\n', file: '- 8px grid' })).toBe('House rules from the designer, follow them:\n- sentence case\n- 8px grid');
  });
  it('adds the block to the instructions only when present', () => {
    expect(instructions(null)).not.toContain('House rules');
    expect(instructions(null, rulesBlock({ global: '', file: '- no shadows' }))).toContain('House rules from the designer, follow them:\n- no shadows');
  });
});
