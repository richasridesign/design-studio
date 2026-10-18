import { describe, expect, it } from 'vitest';
import { blankProfile, dropItem, mergeFound, parseCssTokens, parseFigmaKit, parseJsonTokens, restoreItem, skillArea, skillFoldersFor, starterProfile, toHex, withSource, withoutSource } from './dsProfiles';

describe('starters', () => {
  it('Nordic reads her rule files and keeps her type scale', () => {
    const ds = starterProfile('nordic', 1);
    expect(ds.sources).toEqual([{ kind: 'skills', dir: '~/design-skills', off: [] }]);
    expect(ds.text.map((t) => t.size)).toEqual([12, 14, 16, 18, 20, 24]);
    expect(ds.colors.every((c) => c.from === 'starter')).toBe(true);
  });
  it('Lo-fi turns token checks off and reviews flow and copy', () => {
    const ds = starterProfile('lofi', 1);
    expect(ds.tokens).toBe(false);
    expect(ds.areas).toEqual(['interaction', 'writing']);
    expect(ds.colors.map((c) => c.value)).toEqual(['#000000', '#FFFFFF', '#8C8C8C']);
  });
});

describe('code tokens', () => {
  it('reads CSS custom properties and follows one var()', () => {
    const f = parseCssTokens(':root { --brand: #2257d6; --link: var(--brand); --space-4: 16px; --radius-sm: 0.5rem; --text-sm: 14px; --shadow: 0 1px 2px red; }');
    expect(f.colors).toEqual([{ name: 'brand', value: '#2257D6', variable: '--brand' }, { name: 'link', value: '#2257D6', variable: '--link' }]);
    expect(f.spacing).toEqual([16]);
    expect(f.radius).toEqual([8]);
    expect(f.text).toEqual([{ name: 'text-sm', size: 14 }]);
  });
  it('reads W3C JSON tokens and skips references', () => {
    const f = parseJsonTokens(JSON.stringify({ color: { $type: 'color', ink: { $value: '#111' }, link: { $value: '{color.ink}' } }, spacing: { sm: { value: 8, type: 'spacing' } } }));
    expect(f.colors).toEqual([{ name: 'color/ink', value: '#111111', variable: 'color/ink' }]);
    expect(f.spacing).toEqual([8]);
  });
  it('turns rgb into hex', () => expect(toHex('rgb(255, 0, 16)')).toBe('#FF0010'));
});

describe('figma read', () => {
  it('turns the plugin result into profile items', () => {
    const f = parseFigmaKit({
      file: 'Atlas',
      variables: [{ name: 'text/muted', collection: 'Tokens', type: 'COLOR', value: '#807f81' }, { name: 'space/4', type: 'FLOAT', value: 16 }, { name: 'radius/md', type: 'FLOAT', value: 8 }],
      paints: [{ name: 'Brand', hex: '#2257d6' }, { name: 'Gradient', hex: null }],
      texts: [{ name: 'Body', family: 'Inter', style: 'Semi Bold', size: 14, lineHeight: 20 }],
      components: [{ name: 'Button', key: 'k1', variants: ['Type: Primary / Secondary'] }],
    });
    expect(f.colors).toEqual([{ name: 'text/muted', value: '#807F81', variable: 'Tokens/text/muted' }, { name: 'Brand', value: '#2257D6' }]);
    expect(f.text).toEqual([{ name: 'Body', family: 'Inter', size: 14, weight: 600, lineHeight: 20 }]);
    expect(f.spacing).toEqual([16]);
    expect(f.radius).toEqual([8]);
    expect(f.components[0]).toEqual({ name: 'Button', key: 'k1', variants: ['Type: Primary / Secondary'] });
    expect(f.libraries).toEqual(['Atlas']);
  });
});

describe('merging and dropping', () => {
  const found = { colors: [{ name: 'a', value: '#000000' }, { name: 'b', value: '#FFFFFF' }], text: [], components: [], spacing: [4], radius: [] };
  it('keeps a dropped item out after a refresh, and lets it back after restore', () => {
    let ds = mergeFound(blankProfile(1), found, 'figma', 2);
    ds = dropItem(ds, 'color', 'a');
    expect(ds.colors.map((c) => c.name)).toEqual(['b']);
    expect(mergeFound(ds, found, 'figma', 3).colors.map((c) => c.name)).toEqual(['b']);
    expect(mergeFound(restoreItem(ds, 'color:a'), found, 'figma', 3).colors.map((c) => c.name)).toEqual(['a', 'b']);
  });
  it('replaces items from the same source and keeps others', () => {
    const ds = mergeFound(starterProfile('lofi', 1), { ...found, colors: [{ name: 'ink', value: '#111111' }, { name: 'z', value: '#222222' }] }, 'code', 2);
    expect(ds.colors.map((c) => `${c.name}:${c.from}`)).toEqual(['ink:starter', 'paper:starter', 'grey:starter', 'z:code']);
  });
  it('removing a source removes what it brought in', () => {
    let ds = withSource(mergeFound(blankProfile(1), found, 'code', 2), { kind: 'code', path: '/x.css', at: 2 });
    ds = withoutSource(ds, 0);
    expect(ds.colors).toEqual([]);
    expect(ds.sources).toEqual([]);
  });
});

describe('rule files', () => {
  it('maps her folders to areas', () => {
    expect(skillArea('ux-writing-review')).toBe('writing');
    expect(skillArea('design-process')).toBeNull();
  });
  it('gives each reviewer only its folders, minus the ones turned off', () => {
    const ds = { ...starterProfile('nordic', 1), sources: [{ kind: 'skills' as const, dir: '~/design-skills', off: ['visual-craft-review'] }] };
    const folders = ['accessibility-review', 'design-process', 'visual-craft-review', 'ux-writing-review'];
    expect(skillFoldersFor(ds, ['accessibility'], folders)).toEqual(['accessibility-review']);
    expect(skillFoldersFor(ds, ['visual', 'writing'], folders)).toEqual(['ux-writing-review']);
    expect(skillFoldersFor(starterProfile('lofi', 1), ['writing'], folders)).toEqual([]);
  });
});
