import { describe, expect, it } from 'vitest';
import { FIGMA_KIT, KIT_GUIDE, parses, prepareFigmaCall, usesKit, wrapFigmaCode } from './figmaKit.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Runs the kit against a small fake of the Plugin API and returns DS. */
async function kit(figma: unknown) {
  return new AsyncFunction('figma', `${FIGMA_KIT}\nreturn DS;`)(figma);
}

describe('wrapFigmaCode', () => {
  it('parses as the body of an async function, with the code in its own scope', () => {
    const code = wrapFigmaCode('const DS2 = 1; const box = 2; return await DS.node("1:2");', { save: 'Design Studio: x' })!;
    expect(parses(code)).toBe(true);
    expect(code.startsWith('await figma.saveVersionHistoryAsync("Design Studio: x");\nconst DS = (() => {')).toBe(true);
    expect(code).toContain('return await (async () => {\nconst DS2 = 1;');
  });

  it('adds nothing to code that does not use DS and needs no save', () => {
    expect(wrapFigmaCode('return figma.root.name', { save: null })).toBeNull();
    expect(usesKit('const x = "DS"; return x')).toBe(false);
    expect(usesKit('return DS . tree(n)')).toBe(true);
  });

  it('keeps the code under the use_figma limit, dropping the helpers first', () => {
    const big = `// ${'x'.repeat(45000)}\nreturn DS.box(n)`;
    expect(wrapFigmaCode(big, { save: null })).toBeNull();
    expect(wrapFigmaCode(big, { save: 'v' })).toBe(`await figma.saveVersionHistoryAsync("v");\n${big}`);
  });
});

describe('prepareFigmaCall', () => {
  it('saves once, labelled with the call description', () => {
    const r = prepareFigmaCall({ fileKey: 'k', code: 'node.x = 1', description: 'Move  the\ntoast' }, true);
    expect(r.saved).toBe(true);
    expect(r.input).toEqual({ fileKey: 'k', description: 'Move  the\ntoast', code: 'await figma.saveVersionHistoryAsync("Design Studio: Move the toast");\nnode.x = 1' });
    expect(prepareFigmaCall({ code: 'node.x = 1' }, false)).toEqual({ input: null, saved: false });
  });

  it('counts a save Claude wrote itself and does not add a second', () => {
    expect(prepareFigmaCall({ code: 'await figma.saveVersionHistoryAsync("mine")' }, true)).toEqual({ input: null, saved: true });
  });

  it('leaves code that does not parse alone and saves with the next call', () => {
    expect(prepareFigmaCall({ code: 'node.x = (' }, true)).toEqual({ input: null, saved: false });
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
