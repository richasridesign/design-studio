import { describe, expect, it } from 'vitest';
import {
  LINE_MAX, appendDone, decisionTimes, ensureIteration, markEdited, oneLine, parseHistory, parseSticky, replaceDecisions, stamp,
} from './history.js';

const flow = { n: 3, name: 'Connectors' };
const at = new Date(2026, 9, 20, 14, 2);

describe('history.md', () => {
  it('starts a file with its head and one block for the iteration', () => {
    const md = ensureIteration('', flow, { id: '1.19', title: '1.19 · Readiness · Tue 20 Oct 2026', state: 'working', link: 'https://x/1' });
    expect(md.startsWith('# Flow 3 · Connectors\n<!-- Design Studio writes this file.')).toBe(true);
    expect(md).toContain('## 1.19 · Readiness · Tue 20 Oct 2026\n<!-- ds:iteration 1.19 -->\nState: Working · [Open in Figma](https://x/1)');
    expect(md).toContain('<!-- ds:decisions 1.19 -->\nNot read from Figma yet.\n<!-- /ds:decisions 1.19 -->');
    expect(md).toContain('### What was done\n<!-- ds:done 1.19 -->\n<!-- /ds:done 1.19 -->');
  });

  it('puts newer iterations first and keeps the state line current', () => {
    let md = ensureIteration('', flow, { id: '1.18', title: '1.18 · Trust', state: 'working' });
    md = ensureIteration(md, flow, { id: '1.19', title: '1.19 · Readiness', state: 'working' });
    md = ensureIteration(md, flow, { id: '1.2', title: '1.2 · First', state: 'frozen' });
    const ids = parseHistory(md).blocks.map((b) => b.id);
    expect(ids).toEqual(['1.19', '1.18', '1.2']);
    md = ensureIteration(md, flow, { id: '1.18', title: 'ignored', state: 'frozen' });
    expect(md).toContain('<!-- ds:iteration 1.18 -->\nState: Frozen');
    expect(md.match(/ds:iteration 1\.18/g)).toHaveLength(1);
  });

  it('replaces only the decisions between the markers and keeps hand edits', () => {
    let md = ensureIteration('', flow, { id: '1.19', title: '1.19 · Readiness', state: 'working' });
    md = md.replace('### What was done', 'My own note about this round.\n\n### What was done');
    md = replaceDecisions(md, '1.19', [
      { id: '1:2', name: 'Connectors', link: 'https://x/2', stickies: [{ decision: 'Readiness shows which workflows are close', why: 'So she knows where to start.' }] },
      { id: '1:3', name: 'Connected', stickies: [] },
    ], new Date('2026-10-20T15:10:00Z'));
    expect(md).toContain('#### Connectors · [Open in Figma](https://x/2)\n- **Readiness shows which workflows are close** Why: So she knows where to start.');
    expect(md).toContain('No stickies: Connected');
    expect(md).toContain('My own note about this round.');
    expect(md).not.toContain('Not read from Figma yet.');
    md = replaceDecisions(md, '1.19', [{ id: '1:2', name: 'Connectors', stickies: [{ decision: 'Second pass' }] }], new Date('2026-10-20T16:00:00Z'));
    expect(md).not.toContain('Readiness shows');
    expect(md).toContain('- **Second pass**');
    expect(md).toContain('My own note about this round.');
    expect(decisionTimes(md, '1.19').synced).toBe(Date.parse('2026-10-20T16:00:00Z'));
  });

  it('marks the decisions stale after an edit and keeps the sync time', () => {
    let md = ensureIteration('', flow, { id: '1.19', title: '1.19', state: 'working' });
    md = replaceDecisions(md, '1.19', [], new Date('2026-10-20T15:10:00Z'));
    md = markEdited(md, '1.19', new Date('2026-10-20T15:40:00Z'));
    expect(md).toContain('<!-- ds:decisions 1.19 synced 2026-10-20T15:10:00.000Z edited 2026-10-20T15:40:00.000Z -->');
    const b = parseHistory(md).blocks[0];
    expect(b.synced).toBe(Date.parse('2026-10-20T15:10:00Z'));
    expect(b.edited).toBe(Date.parse('2026-10-20T15:40:00Z'));
    expect(b.body).not.toContain('<!--');
  });

  it('appends what was done with a stamp, one line, capped', () => {
    let md = ensureIteration('', flow, { id: '1.19', title: '1.19', state: 'working' });
    md = appendDone(md, '1.19', 'Review (Full): 12 findings', at);
    md = appendDone(md, '1.19', `Changed:\n${'x'.repeat(400)}`, at);
    const lines = md.split('\n').filter((l) => l.startsWith('- Tue'));
    expect(lines[0]).toBe('- Tue 20 Oct 14:02 · Review (Full): 12 findings');
    expect(lines[1].length).toBeLessThanOrEqual(LINE_MAX);
    expect(lines[1]).not.toContain('\n');
  });

  it('adds a fresh part when a hand edit removed its markers, never dropping her lines', () => {
    let md = ensureIteration('', flow, { id: '1.19', title: '1.19', state: 'working' });
    md = md.replace('<!-- /ds:done 1.19 -->', 'Hand line');
    md = appendDone(md, '1.19', 'Update: 3 screens', at);
    expect(md).toContain('Hand line');
    expect(md).toContain('- Tue 20 Oct 14:02 · Update: 3 screens\n<!-- /ds:done 1.19 -->');
  });

  it('only changes its own iteration block', () => {
    let md = ensureIteration('', flow, { id: '1.18', title: '1.18', state: 'frozen' });
    md = ensureIteration(md, flow, { id: '1.19', title: '1.19', state: 'working' });
    md = appendDone(md, '1.18', 'Old work', at);
    md = appendDone(md, '1.19', 'New work', at);
    const [b19, b18] = parseHistory(md).blocks;
    expect(b19.body).toContain('New work');
    expect(b19.body).not.toContain('Old work');
    expect(b18.body).toContain('Old work');
  });

  it('keeps marker text out of lines it writes', () => {
    expect(oneLine('a <!-- b --> c')).toBe('a b c');
    expect(stamp(at)).toBe('Tue 20 Oct 14:02');
  });
});

describe('parseSticky', () => {
  it('reads the decision and reason from text properties', () => {
    expect(parseSticky([{ key: 'Decision#1:0', text: 'Show readiness first' }, { key: 'Why#1:1', text: 'Why: she starts there' }]))
      .toEqual({ decision: 'Show readiness first', why: 'she starts there' });
  });
  it('reads a single text layer with a Why line and skips the label', () => {
    expect(parseSticky([{ text: 'Decision 1' }, { text: 'Show readiness first\nWhy: she starts there' }]))
      .toEqual({ decision: 'Show readiness first', why: 'she starts there' });
  });
  it('returns null for an empty sticky', () => {
    expect(parseSticky([{ text: 'Decision 2' }, { text: '  ' }])).toBeNull();
  });
});
