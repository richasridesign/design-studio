import { describe, expect, it } from 'vitest';
import { FIGMA_WRITE_MATCHER } from './lean.js';
import { SLOW_FIGMA, SLOW_SHOT_MATCHER, slowFigmaRefusal } from './figmaRun.js';
import { script } from '../../figma-plugin/run';

describe('Figma scripts through the plugin', () => {
  it('keeps the scope guard and write lock on the plugin tool, and never refuses its own tools', () => {
    expect(new RegExp(FIGMA_WRITE_MATCHER).test('mcp__designstudio__use_figma')).toBe(true);
    expect(SLOW_FIGMA.test('mcp__designstudio__use_figma')).toBe(false);
    expect(SLOW_FIGMA.test('mcp__designstudio__get_screenshot')).toBe(false);
    expect(SLOW_FIGMA.test('mcp__plugin_figma_figma__use_figma')).toBe(true);
    expect(new RegExp(SLOW_SHOT_MATCHER).test('mcp__plugin_figma_figma__get_screenshot')).toBe(true);
    expect(new RegExp(SLOW_SHOT_MATCHER).test('mcp__designstudio__get_screenshot')).toBe(false);
  });

  it('lets the Figma MCP run when no plugin is in the file', () => {
    expect(slowFigmaRefusal('mcp__plugin_figma_figma__use_figma', { fileKey: 'NOPLUGIN' })).toBeNull();
  });

  it('cannot close the plugin, keeps her page, and returns DS.shot images', async () => {
    const home = { id: '0:1' };
    const other = { id: '5:1' };
    let closed = false;
    const figma: any = {
      currentPage: home,
      closePlugin: () => (closed = true),
      showUI: () => (closed = true),
      setCurrentPageAsync: async (p: any) => (figma.currentPage = p),
      base64Encode: () => 'UE5H',
    };
    // As in Figma: the API's methods are non-writable and non-configurable.
    Object.defineProperty(figma, 'getNodeByIdAsync', { value: async () => node, writable: false, configurable: false });
    const node = { id: '1:2', width: 3000, height: 100, exportAsync: async (o: any) => (node.scale = o.constraint.value, new Uint8Array(1)), scale: 0 };
    figma.__other = other;
    figma.__node = node;
    const out = await script(figma, { code: `figma.closePlugin(); figma.showUI('<p>'); await figma.setCurrentPageAsync(figma.__other); await __dsShot(await figma.getNodeByIdAsync('1:2')); return 7;` });
    expect(closed).toBe(false);
    expect(figma.currentPage).toBe(home);
    expect(out.value).toBe(7);
    expect(out.shots).toEqual([{ id: '1:2', png: 'UE5H' }]);
    expect(node.scale).toBeCloseTo(1568 / 3000);
  });
});
