import { describe, expect, it } from 'vitest';
import { currentOption, family, modelLabel } from './models';

const opts = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5.5' },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5' },
];

describe('models', () => {
  it('reads the family from an id', () => {
    expect(family('claude-opus-5-5[1m]')).toBe('opus');
    expect(family('claude-haiku-5-5')).toBe('haiku');
    expect(family(null)).toBeNull();
  });
  it('matches by value, then by family', () => {
    expect(currentOption('sonnet', opts)?.value).toBe('sonnet');
    expect(currentOption('claude-haiku-5-5', opts)?.value).toBe('haiku');
    expect(currentOption('claude-opus-5-5', opts)?.value).toBe('default');
    expect(currentOption('claude-fable-5-1', opts)).toBeNull();
  });
  it('labels the pill with the family name', () => {
    expect(modelLabel('claude-opus-5-5[1m]', opts)).toBe('Opus');
    expect(modelLabel('sonnet', opts)).toBe('Sonnet');
    expect(modelLabel('default', opts)).toBe('Opus');
    expect(modelLabel('custom', [{ value: 'custom', displayName: 'Custom' }])).toBe('Custom');
    expect(modelLabel(null, [])).toBe('Model');
  });
});
