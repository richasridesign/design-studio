import { describe, expect, it } from 'vitest';
import { copyApplyPrompt, parseTone, textNodes } from './crit.js';
import { copyTable, critMarkdown } from '../../shared/design.js';

describe('copyApplyPrompt', () => {
  it('lists each node with before and after', () => {
    const p = copyApplyPrompt([{ nodeId: '1:2', before: 'Submit', after: 'Save "draft"' }, { nodeId: '3:4', before: 'Err', after: 'Try again' }]);
    expect(p).toBe('Apply these copy changes in Figma with use_figma, only to these text nodes, keeping their text styles:\n- 1:2: "Submit" -> "Save \\"draft\\""\n- 3:4: "Err" -> "Try again"');
  });
});

describe('parseTone', () => {
  it('reads the tone and defaults to friendly', () => {
    expect(parseTone('tone:formal 1:2')).toBe('formal');
    expect(parseTone('1:2')).toBe('friendly');
    expect(parseTone('tone:loud')).toBe('friendly');
  });
});

describe('textNodes', () => {
  it('collects visible text layers', () => {
    const doc = { id: '1:1', children: [{ id: '1:2', type: 'TEXT', name: 'a', characters: 'Hi' }, { id: '1:3', type: 'TEXT', name: 'b', characters: 'x', visible: false }, { id: '1:4', type: 'FRAME', children: [{ id: '1:5', type: 'TEXT', name: 'c', characters: ' ' }, { id: '1:6', type: 'TEXT', name: 'd', characters: 'Go' }] }] };
    expect(textNodes(doc).map((t) => t.id)).toEqual(['1:2', '1:6']);
  });
});

describe('critMarkdown', () => {
  it('lists viewpoints in persona order with labelled points', () => {
    const md = critMarkdown({ summary: 'Solid start.', personas: [
      { id: 'product', verdict: 'Ships.', points: [{ kind: 'idea', text: 'Add a promo.' }] },
      { id: 'new-user', verdict: 'Clear.', points: [{ kind: 'concern', text: 'Total is small.', nodeId: '1:2' }] },
    ] });
    expect(md).toBe('Solid start.\n\n## New user\n\nClear.\n\n- **Concern:** Total is small. (1:2)\n\n## Product\n\nShips.\n\n- **Idea:** Add a promo.');
  });
});

describe('copyTable', () => {
  it('escapes pipes and flattens line breaks', () => {
    expect(copyTable({ items: [{ nodeId: '1:2', before: 'A | B', after: 'Line one\nline two', reason: 'Shorter' }] })).toBe(
      '| Before | After | Reason |\n| --- | --- | --- |\n| A \\| B | Line one line two | Shorter |');
  });
});
