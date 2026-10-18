import { describe, expect, it } from 'vitest';
import { decisionLog, whoLabel } from './decisionLog.js';
import type { SketchDoc } from './design.js';

const dir = (id: string, name: string) => ({ id, name, rationale: `${name} rationale`, w: 390, h: 844, items: [] });
const sketch: SketchDoc = { screens: [
  { id: 'cart', name: 'Cart', chosen: 'a', chosenBy: 'claude', directions: [dir('a', 'Classic list'), dir('b', 'Delivery first')] },
  { id: 'empty', name: 'Empty cart', chosen: 'b', chosenBy: 'designer', reason: 'Calmer', rejected: ['Suggestions'], at: 200, directions: [dir('a', 'Suggestions'), dir('b', 'Plain')] },
  { id: 'pay', name: 'Payment', directions: [dir('a', 'One step'), dir('b', 'Two steps')] },
] };

describe('decisionLog', () => {
  it('lists picks and noted approvals, newest first, undated Claude picks last', () => {
    const rows = decisionLog(sketch, { spec: { at: 100 }, explore: { at: 300, note: 'Two directions are enough' } });
    expect(rows.map((r) => r.id)).toEqual(['stage:explore', 'pick:empty', 'pick:cart']);
    expect(rows[0]).toMatchObject({ title: 'Step', choice: 'Approved Sketch', why: 'Two directions are enough', over: [] });
    expect(rows[1]).toMatchObject({ title: 'Empty cart', choice: 'Chose Plain', over: ['Suggestions'], why: 'Calmer', by: 'designer' });
  });

  it("uses Claude's rationale as the reason and works out what it was chosen over", () => {
    const row = decisionLog(sketch, {}).find((r) => r.id === 'pick:cart')!;
    expect(row).toMatchObject({ by: 'claude', why: 'Classic list rationale', over: ['Delivery first'], at: undefined });
    expect(whoLabel(row)).toBe('Picked by Claude');
  });

  it('leaves the reason empty when the designer gave none', () => {
    const s: SketchDoc = { screens: [{ ...sketch.screens[1], reason: undefined }] };
    expect(decisionLog(s, {})[0].why).toBe('');
  });

  it('names the designer for the report', () => {
    const rows = decisionLog(sketch, { spec: { at: 1, note: 'ok' } });
    expect(rows.map((r) => whoLabel(r, 'the designer'))).toEqual(['Picked by the designer', 'Approved by the designer', 'Picked by Claude']);
  });

  it('is empty without picks or notes', () => {
    expect(decisionLog(null, { spec: { at: 1 } })).toEqual([]);
  });
});
