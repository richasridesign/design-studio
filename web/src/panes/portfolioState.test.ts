import { describe, expect, it } from 'vitest';
import { adoptedLine, currentRun, doneLine, editedLine, editingLine, emptyLine, gatherLine, planLine, publishChangedLine, publishLine, type Block } from './portfolioState';
import type { EditRecord, Run } from '../../../shared/portfolio';

const block = (p: string, it: string, flow: string): Block => ({
  key: `${p}/${it}/${flow}`, label: `${p} · ${it}`, project: { key: p, name: p }, iteration: { id: it, title: it, frozenAt: 1, adopted: false },
  flow: { n: 1, slug: flow, name: flow }, clearance: 'ask', frozenAt: 1,
});
const run = (over: Partial<Run>): Run => ({ id: '20261020-140205', state: 'picking', startedAt: new Date(2026, 9, 20).getTime(), blocks: [], mode: 'chrome', ...over });
const edits: EditRecord[] = [
  { id: 'e1', suggestion: 's1', kind: 'text', page: '/helpdesk-dashboard', node: 'Body', old: 'a', text: 'b', state: 'done' },
  { id: 'e2', suggestion: 's1', kind: 'text', page: '/', node: 'Card', old: 'a', text: 'b', state: 'done' },
  { id: 'e3', suggestion: 's2', kind: 'copy', reason: 'New case study', state: 'copy' },
];

describe('portfolio page copy', () => {
  it('counts what the gather found and says when there is nothing', () => {
    const file = { clearance: {}, used: {}, skipped: {}, since: '2026-10-12' };
    expect(gatherLine([block('A', '1.19', 'x'), block('A', '1.19', 'y'), block('B', '2.1', 'z')], file)).toBe('Found 2 frozen iterations since Mon 12 Oct: 2 projects, 3 flows.');
    expect(emptyLine({ ...file, lastUpdate: { at: new Date(2026, 9, 12).getTime(), run: 'x' } })).toBe('No finished work since your last update on Mon 12 Oct. Freeze an iteration to see it here.');
    expect(emptyLine({ clearance: {}, used: {}, skipped: {} })).toBe('No finished work yet. Freeze an iteration to see it here.');
    expect(adoptedLine(3)).toBe('3 older iterations have no history.');
    expect(adoptedLine(1)).toBe('1 older iteration has no history.');
  });

  it('states each edit step in plain words', () => {
    expect(planLine(edits)).toBe('Plan: 2 edits in Framer, 1 by copy and paste. Nothing is written before Go.');
    expect(editingLine(edits)).toBe('Editing 2 pages in Framer, about 30 minutes per edit. Nothing is published.');
    expect(editedLine(edits)).toBe('2 edits made in Framer, not published. 1 needs copy and paste.');
    expect(publishLine(run({ changed: ['/helpdesk-dashboard'] }), edits)).toBe('Your edits are in Framer, not live yet. Changed pages: /helpdesk-dashboard.');
    expect(publishChangedLine(run({}), edits)).toBe('Framer published during this run, so the live site now has these edits: /helpdesk-dashboard, /. Check it, then choose.');
    expect(doneLine(run({ state: 'done', used: 3, skipped: 2 }))).toBe('Portfolio updated Tue 20 Oct. 3 iterations used, 2 skipped.');
  });

  it('opens on the run that still waits for her', () => {
    const runs = [run({ id: 'b', state: 'done' }), run({ id: 'a', state: 'copy' })];
    expect(currentRun(runs, null)?.id).toBe('a');
    expect(currentRun(runs, 'b')?.id).toBe('b');
    expect(currentRun([run({ state: 'done' })], null)).toBeNull();
  });
});
