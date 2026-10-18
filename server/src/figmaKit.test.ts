import { describe, expect, it } from 'vitest';
import { FIGMA_KIT, KIT_GUIDE, parses, prepareFigmaCall, usesKit, wrapFigmaCode } from './figmaKit.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Runs the kit against a small fake of the Plugin API and returns DS. */
async function kit(figma: unknown) {
  return new AsyncFunction('figma', `${FIGMA_KIT}\nreturn DS;`)(figma);
}

describe('wrapFigmaCode', () => {
  it('parses as the body of an async function, with the code in its own scope', () => {
    const code = wrapFigmaCode('const DS2 = 1; const box = 2; return await DS.node("1:2");')!;
    expect(parses(code)).toBe(true);
    expect(code.startsWith('const DS = (() => {')).toBe(true);
    expect(code).toContain('return await (async () => {\nconst DS2 = 1;');
    expect(code).not.toContain('saveVersionHistoryAsync');
  });

  it('adds nothing to code that does not use DS', () => {
    expect(wrapFigmaCode('return figma.root.name')).toBeNull();
    expect(usesKit('const x = "DS"; return x')).toBe(false);
    expect(usesKit('return DS . tree(n)')).toBe(true);
  });

  it('leaves code alone when the helpers would push it over the use_figma limit', () => {
    expect(wrapFigmaCode(`// ${'x'.repeat(45000)}\nreturn DS.box(n)`)).toBeNull();
  });
});

describe('prepareFigmaCall', () => {
  it('keeps the other arguments and leaves code that does not parse alone', () => {
    expect(prepareFigmaCall({ fileKey: 'k', description: 'd', code: 'return DS.tree(await DS.node("1:2"))' })).toMatchObject({ fileKey: 'k', description: 'd' });
    expect(prepareFigmaCall({ code: 'node.x = 1' })).toBeNull();
    expect(prepareFigmaCall({ code: 'DS.node(' })).toBeNull();
  });
});

describe('the helpers', () => {
  const variant = (id: string, props: Record<string, string>) => ({ id, type: 'COMPONENT', name: Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', '), variantProperties: props, parent: null as unknown });
  const set = { type: 'COMPONENT_SET', children: [variant('1:1', { Type: 'Primary', State: 'Default' }), variant('1:2', { Type: 'Primary', State: 'Hover' }), variant('1:3', { Type: 'Secondary', State: 'Default' }), variant('1:4', { Type: 'Secondary', State: 'Hover' })] };
  for (const c of set.children) c.parent = set;

  it('finds the Hover variant with the same other properties', async () => {
    const DS = await kit({});
    expect(DS.hoverOf(set.children[2]).id).toBe('1:4');
    expect(DS.hoverOf(set.children[3])).toBeNull();
  });

  it('points an instance hover at its own Hover variant and keeps its click', async () => {
    const DS = await kit({});
    const click = { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '9:9', navigation: 'NAVIGATE' }] };
    let saved: unknown[] = [];
    const inst = { id: '5:5', type: 'INSTANCE', reactions: [click], getMainComponentAsync: async () => set.children[2], setReactionsAsync: async (r: unknown[]) => { saved = r; } };
    expect(await DS.wireHover(inst)).toBe('1:4');
    expect(saved).toEqual([click, { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: '1:4', navigation: 'CHANGE_TO', transition: null }] }]);
  });

  it('moves by page coordinates and grows a section around its children', async () => {
    const DS = await kit({});
    const section: any = { type: 'SECTION', absoluteBoundingBox: { x: 100, y: 100, width: 500, height: 500 }, absoluteTransform: [[1, 0, 100], [0, 1, 100]], children: [] };
    const frame: any = { parent: section, x: 0, y: 0, width: 400, height: 300 };
    Object.defineProperty(frame, 'absoluteBoundingBox', { get: () => ({ x: frame.x + 100, y: frame.y + 100, width: 400, height: 300 }) });
    section.children.push(frame);
    DS.moveTo(frame, 300, 400);
    expect([frame.x, frame.y]).toEqual([200, 300]);
    section.resizeWithoutConstraints = (w: number, h: number) => Object.assign(section, { w, h });
    DS.fit(section);
    expect([section.w, section.h]).toEqual([600 + 320, 600 + 320]);
  });

  it('says what to do when a node is not awaited or is an id', async () => {
    const DS = await kit({});
    expect(() => DS.tree(Promise.resolve({}))).toThrow('DS.tree got a Promise: write await DS.node(id) first.');
    expect(() => DS.moveTo('1:2', 0, 0)).toThrow('DS.moveTo needs a node, not an id: use await DS.node("1:2").');
  });

  it('keeps a large return value under the result limit', async () => {
    const DS = await kit({});
    const out = DS.done({ list: 'x'.repeat(30000) });
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(20480);
  });

  it('describes every helper it has', async () => {
    const DS = await kit({});
    for (const name of Object.keys(DS)) if (!['box', 'overlaps', 'hoverOf', 'texts', 'vars'].includes(name)) expect(KIT_GUIDE).toContain(`DS.${name}`);
  });
});
