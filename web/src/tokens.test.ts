import { describe, expect, it } from 'vitest';
import { toCss, toJson, toTailwind } from './tokens';
import type { DesignSystem } from '../../shared/design';

const ds: DesignSystem = {
  builtAt: 0,
  libraries: [],
  colors: [{ name: 'Primary', value: '#ff5500' }, { name: 'Text/Muted Gray', value: '#888888' }],
  text: [{ name: 'Heading 1', family: 'Inter', size: 32, weight: 700 }, { name: 'Body', family: 'Source Serif', size: 16 }],
  spacing: [16, 4, 4, 6],
  radius: [4, 8, 9999],
  components: [],
  rules: [],
};

describe('toCss', () => {
  const css = toCss(ds);
  it('writes kebab-case custom properties', () => {
    expect(css).toContain('--color-primary: #ff5500;');
    expect(css).toContain('--color-text-muted-gray: #888888;');
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--space-1: 4px;');
    expect(css).toContain('--space-1-5: 6px;');
    expect(css).toContain('--radius-sm: 4px;');
    expect(css).toContain('--radius-full: 9999px;');
    expect(css).toContain("--font-body: 'Source Serif', sans-serif;");
    expect(css).toContain('--font-heading: Inter, sans-serif;');
    expect(css).toContain('--text-heading-1: 32px;');
  });
  it('handles an empty profile', () => {
    expect(toCss({})).toBe(':root {\n}\n');
  });
});

describe('toTailwind', () => {
  const js = toTailwind(ds);
  it('exports theme.extend', () => {
    expect(js.startsWith('export default {')).toBe(true);
    expect(js).toContain('colors: {');
    expect(js).toContain('primary: "#ff5500"');
    expect(js).toContain('borderRadius: {');
    expect(js).toContain('fontFamily: {');
  });
  it('omits empty groups', () => {
    expect(toTailwind({ colors: [{ name: 'A', value: '#000' }] })).not.toContain('spacing');
  });
});

describe('toJson', () => {
  const json = JSON.parse(toJson(ds));
  it('uses $value and $type', () => {
    expect(json.color.primary).toEqual({ $value: '#ff5500', $type: 'color' });
    expect(json.space['4']).toEqual({ $value: '16px', $type: 'dimension' });
    expect(json.radius.md).toEqual({ $value: '8px', $type: 'dimension' });
    expect(json.font.body.$type).toBe('fontFamily');
    expect(json.fontSize['heading-1'].$value).toBe('32px');
  });
  it('handles an empty profile', () => {
    expect(JSON.parse(toJson({}))).toEqual({});
  });
});
