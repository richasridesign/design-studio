import { describe, expect, it } from 'vitest';
import { addRule, ruleDraft } from './ruleDraft';

describe('ruleDraft', () => {
  it('drops Figma links and joins lines', () => {
    expect(ruleDraft('Every dialog needs a close icon\nhttps://www.figma.com/design/abc/x?node-id=1-2 here')).toBe('Every dialog needs a close icon here');
  });
  it('caps the length', () => expect(ruleDraft('a'.repeat(300))).toHaveLength(200));
});

describe('addRule', () => {
  it('appends on its own line', () => expect(addRule('One\n', 'Two')).toBe('One\nTwo\n'));
  it('starts an empty list', () => expect(addRule('', 'One')).toBe('One\n'));
  it('skips duplicates', () => expect(addRule('Toasts top centre\n', 'toasts top centre')).toBe('Toasts top centre\n'));
});
