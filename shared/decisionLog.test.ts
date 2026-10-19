import { describe, expect, it } from 'vitest';
import { cleanChatDecision, decisionLog, mergeChatDecisions, MAX_CHAT_DECISIONS, whoLabel } from './decisionLog.js';
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

describe('chat decisions', () => {
  const ready = { what: 'Connector status: Ready replaces Ready to turn on', over: 'Ready to turn on', by: 'designer' as const };

  it('cleans one decision and drops one without a what', () => {
    expect(cleanChatDecision({ what: '  Use  the tag ', why: '', by: 'claude', at: 'x' }, 5)).toEqual({ what: 'Use the tag', by: 'claude', at: 5 });
    expect(cleanChatDecision({ what: 'X', by: 'you' }, 5)).toMatchObject({ by: 'designer' });
    expect(cleanChatDecision({ what: ' ', by: 'claude' }, 5)).toBeNull();
    expect(cleanChatDecision('nope', 5)).toBeNull();
  });

  it('keeps the same what once, at its first time, and fills in what the first left out', () => {
    const had = mergeChatDecisions([], [ready], 10);
    const next = mergeChatDecisions(had, [{ what: 'connector status:  READY replaces ready to turn on', why: 'Shorter', by: 'claude' }, { what: 'Turn on button becomes Activate', by: 'designer' }], 20);
    expect(next).toEqual([
      { ...ready, why: 'Shorter', at: 10 },
      { what: 'Turn on button becomes Activate', by: 'designer', at: 20 },
    ]);
  });

  it('reads a broken file as empty and keeps only the newest', () => {
    expect(mergeChatDecisions({ not: 'a list' }, [], 1)).toEqual([]);
    const many = Array.from({ length: MAX_CHAT_DECISIONS + 5 }, (_, i) => ({ what: `D${i}`, by: 'claude', at: i + 1 }));
    const kept = mergeChatDecisions(many, [], 0);
    expect(kept).toHaveLength(MAX_CHAT_DECISIONS);
    expect(kept[0].what).toBe('D5');
  });

  it('lists chat decisions with picks, newest first, under their screen', () => {
    const rows = decisionLog(sketch, { explore: { at: 300, note: 'ok' } }, [{ ...ready, screen: 'Connectors', at: 400 }, { what: 'Turn on becomes Activate', by: 'claude', at: 250 }]);
    expect(rows.map((r) => r.kind)).toEqual(['chat', 'stage', 'chat', 'pick', 'pick']);
    expect(rows[0]).toMatchObject({ title: 'Connectors', choice: ready.what, over: ['Ready to turn on'], why: '', by: 'designer' });
    expect(rows[2]).toMatchObject({ title: 'Chat', choice: 'Turn on becomes Activate' });
    expect(whoLabel(rows[0])).toBe('You');
    expect(whoLabel(rows[0], 'the designer')).toBe('The designer');
    expect(whoLabel(rows[2])).toBe('Claude');
  });
});
