import { describe, expect, it } from 'vitest';
import { TouchedIds, touchedIds } from './touched.js';

describe('touchedIds', () => {
  it('finds node ids in code strings and results', () => {
    expect(touchedIds('const n = await figma.getNodeByIdAsync("12:34"); n.x = 1', 'created 56:78, 56:78 and 9:10')).toEqual(['12:34', '56:78', '9:10']);
  });

  it('ignores times, versions and longer colon chains', () => {
    expect(touchedIds('at 10:30:45 v1.2:3 a1:2 1:2:3')).toEqual([]);
  });

  it('reads ids from a JSON nodes list', () => {
    expect(touchedIds(JSON.stringify({ nodes: ['1:2', '3:4'] }))).toEqual(['1:2', '3:4']);
  });
});

describe('TouchedIds', () => {
  it('ranks ids named in a script before ids from results, newest first', () => {
    const t = new TouchedIds();
    t.add(['1:1', '1:2', '1:3'], false);
    t.add(['2:1'], true);
    t.add(['1:2', '2:2'], true);
    expect(t.ranked()).toEqual(['2:2', '1:2', '2:1', '1:3', '1:1']);
  });

  it('moves an id touched again to the front', () => {
    const t = new TouchedIds();
    t.add(['1:1', '1:2'], true);
    t.add(['1:1'], true);
    expect(t.ranked()).toEqual(['1:1', '1:2']);
    t.clear();
    expect(t.ranked()).toEqual([]);
  });
});
