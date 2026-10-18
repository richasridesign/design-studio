import { describe, expect, it } from 'vitest';
import { hoverPairs, locate, mapMarkdown, mapSummary, type FileMap } from './fileMap.js';

const map: FileMap = {
  key: 'abc',
  name: 'Shop',
  readAt: Date.UTC(2026, 9, 18, 20, 0),
  raw: {
    pages: [
      ['0:1', 'Old', [['F', '2:1', 'Loose', 0, 0, 100, 100]], []],
      ['9:1', 'Hi fi', [
        ['S', '50:1', 'LATEST', 0, 0, 4000, 2000, [
          ['S', '60:1', 'Checkout', 100, 100, 3000, 1000, [
            ['F', '61:1', 'Cart', 200, 200, 1440, 900],
            ['F', '62:1', 'Pay', 1800, 200, 1440, 900],
          ], 3],
        ]],
      ], [['61:1', 'Checkout start']]],
    ],
    sets: [['70:1', 'Button', 'Comp', [['Type', 'VARIANT', ['Primary', 'Secondary']], ['State', 'VARIANT', ['Default', 'Hover']], ['Label', 'TEXT', []]], [
      ['70:2', 'Type=Primary, State=Default'],
      ['70:3', 'Type=Primary, State=Hover'],
      ['70:4', 'Type=Secondary, State=Default'],
      ['70:5', 'Type=Secondary, State=Hover'],
    ]]],
    comps: [['71:1', 'Toast', 'Comp']],
    vars: [['VariableID:1:2', 'brand/primary', 'COLOR', 'Tokens']],
    styles: [['S:1', 'Body/14', 'text']],
  },
};

describe('hoverPairs', () => {
  it('pairs each state with the Hover variant that shares its other properties', () => {
    expect(hoverPairs(map.raw.sets[0][4])).toEqual([['70:2', '70:3'], ['70:4', '70:5']]);
  });

  it('gives nothing for sets without a state property', () => {
    expect(hoverPairs([['1:1', 'Size=Small'], ['1:2', 'Size=Large']])).toEqual([]);
  });
});

describe('mapMarkdown', () => {
  const md = mapMarkdown(map);
  it('puts one grep-friendly line per node, with its section', () => {
    expect(md).toContain('F 61:1 | Cart | 1440x900 @200,200 | in 60:1 Checkout');
    expect(md).toContain('S 60:1 | Checkout | 3000x1000 @100,100 | in 50:1 LATEST | 2 screens, 3 other layers');
    expect(md).toContain('Prototype starts: 61:1 Checkout start');
  });

  it('lists set properties, hover variants, variables and styles', () => {
    expect(md).toContain('K 70:1 | Button | Comp | Type=Primary|Secondary; State=Default|Hover; Label (text)');
    expect(md).toContain('  70:4 | Type=Secondary, State=Default | hover 70:5');
    expect(md).toContain('V VariableID:1:2 | brand/primary | COLOR | Tokens');
    expect(md).toContain('Y S:1 | Body/14 | text');
  });
});

describe('mapSummary', () => {
  it('starts with the map file and puts the most recently worked page first', () => {
    const s = mapSummary(map, '/chat/.figma-cache/abc/map.md');
    expect(s.split('\n')[0]).toContain('/chat/.figma-cache/abc/map.md');
    expect(s.indexOf('"Hi fi"')).toBeLessThan(s.indexOf('"Old"'));
    expect(s).toContain('50:1 "LATEST" (2 screens)');
    expect(s).toContain('60:1 "Checkout" (2 screens)');
  });
});

describe('locate', () => {
  it('says where a pasted screen sits, and how to read an id the map does not have', () => {
    const [cart, layer] = locate(map, ['61:1', '99:9']);
    expect(cart).toMatchObject({ id: '61:1', found: true });
    expect(cart.text).toBe('61:1 is screen "Cart" (1440x900) on page "Hi fi", in 50:1 "LATEST" > 60:1 "Checkout".');
    expect(layer.found).toBe(false);
    expect(layer.text).toContain('DS.tree(await DS.node("99:9"), 2)');
  });
});
