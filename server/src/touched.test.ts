import { describe, expect, it } from 'vitest';
import { TouchedIds, figmaEdits, touchedIds } from './touched.js';

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

describe('figmaEdits', () => {
  it('finds scripts that create, change or remove nodes', () => {
    for (const code of [
      'const f = figma.createFrame(); f.name = "Toast"',
      '(await figma.getNodeByIdAsync("6:24")).cornerRadius = 8',
      'node.x += 16',
      'section.appendChild(frame)',
      'old.remove()',
      'const copy = screen.clone()',
      'inst.setProperties({ "Show close": true })',
      'await text.setRangeFillStyleIdAsync(0, 4, id)',
      'button.swapComponent(hover)',
      'n.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }]',
    ]) expect(figmaEdits(code), code).toBe(true);
  });
  it('leaves read-only scripts out, page and viewport calls included', () => {
    for (const code of [
      'return figma.currentPage.children.map((n) => n.id)',
      'return figma.currentPage.findAll((n) => n.type === "FRAME" && n.name === "Toast").map((n) => ({ id: n.id, w: n.width }))',
      'const page = figma.root.children.find((p) => p.name === "Hi fi"); await figma.setCurrentPageAsync(page); return page.children.length',
      'figma.currentPage = page; await figma.loadAllPagesAsync(); return page.findAll((n) => n.width >= 1440).length',
      'figma.viewport.scrollAndZoomIntoView([n]); figma.viewport.zoom = 0.5; figma.currentPage.selection = [n]',
      'if (n.visible === false || n.opacity != 1) return n.id',
    ]) expect(figmaEdits(code), code).toBe(false);
  });
});

describe('TouchedIds', () => {
  it('ranks edit calls first, then ids a read names, then ids a read returned, newest first', () => {
    const t = new TouchedIds();
    t.add(['1:1', '1:2', '1:3'], 'returned');
    t.add(['2:1'], 'named');
    t.add(['1:2', '2:2'], 'named');
    t.add(['3:1', '3:2'], 'edited');
    expect(t.ranked()).toEqual(['3:2', '3:1', '2:2', '1:2', '2:1', '1:3', '1:1']);
  });

  it('moves an id touched again to the front, and lists each id once', () => {
    const t = new TouchedIds();
    t.add(['1:1', '1:2'], 'named');
    t.add(['1:1'], 'named');
    expect(t.ranked()).toEqual(['1:1', '1:2']);
    t.add(['1:2'], 'edited');
    expect(t.ranked()).toEqual(['1:2', '1:1']);
    t.clear();
    expect(t.ranked()).toEqual([]);
  });
});
