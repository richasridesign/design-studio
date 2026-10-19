import { describe, expect, it } from 'vitest';
import {
  blockKey, blockOutcome, cleanPortfolio, cleanSuggestions, copyPack, decisionsOf, draftError, findFlags, flagLine, hideNames,
  isNew, keyError, longSentences, pickSummary, projectLinkError, runBlock, runId, runShape, siteError, strip, stripDashes, upsertRunBlock, usedLine,
  type Run, type Suggestion,
} from './portfolio';
import { ensureIteration, replaceDecisions } from './history';

const KEY = blockKey('KEY', '1.19', 'connectors');

describe('portfolio file', () => {
  it('keeps only known fields', () => {
    const f = cleanPortfolio({ since: '2026-10-01', clearance: { A: 'never', B: 'maybe' }, used: { [KEY]: { frozenAt: 5, run: 'r', state: 'x' } }, junk: 1 });
    expect(f).toEqual({ since: '2026-10-01', clearance: { A: 'never' }, used: { [KEY]: { frozenAt: 5, run: 'r', state: 'edited' } }, skipped: {} });
    expect(cleanPortfolio('nope')).toEqual({ clearance: {}, used: {}, skipped: {} });
  });

  it('offers a block again only when it was frozen again', () => {
    const f = cleanPortfolio({ used: { [KEY]: { frozenAt: 100, run: 'r', state: 'edited' } } });
    expect(isNew(f, KEY, 100)).toBe(false);
    expect(isNew(f, KEY, 200)).toBe(true);
    expect(isNew(f, 'KEY/1.20/connectors', 1)).toBe(true);
  });
});

describe('decisions from history.md', () => {
  it('reads only the Decisions part of one iteration', () => {
    let md = ensureIteration('', { n: 1, name: 'Connectors' }, { id: '1.19', title: '1.19 · Readiness', state: 'frozen' });
    md = ensureIteration(md, { n: 1, name: 'Connectors' }, { id: '1.18', title: '1.18 · Trust', state: 'frozen' });
    md = replaceDecisions(md, '1.19', [
      { id: '60:1', name: 'Connectors', link: 'https://www.figma.com/design/KEY?node-id=60-1', stickies: [{ decision: 'Readiness shows which workflows are close', why: 'she starts with the closest one.' }] },
      { id: '60:2', name: 'Connected', stickies: [] },
    ], new Date('2026-10-20T15:10:00Z'));
    md = replaceDecisions(md, '1.18', [{ id: '9:1', name: 'Old', stickies: [{ decision: 'Old decision' }] }], new Date());
    md = md.replace('<!-- /ds:done 1.19 -->', '- Tue 20 Oct 14:02 · typed text from the chat\n<!-- /ds:done 1.19 -->');
    expect(decisionsOf(md, '1.19')).toEqual([{ id: '60:1', name: 'Connectors', link: 'https://www.figma.com/design/KEY?node-id=60-1', decisions: [{ decision: 'Readiness shows which workflows are close', why: 'she starts with the closest one.' }] }]);
    expect(JSON.stringify(decisionsOf(md, '1.19'))).not.toContain('typed text');
    expect(decisionsOf(md, '1.18')[0].decisions[0].decision).toBe('Old decision');
    expect(decisionsOf(md, '2.0')).toEqual([]);
  });
});

describe('setup checks', () => {
  it('checks the project link, site and key', () => {
    expect(projectLinkError('')).toBe('Paste the link of your Framer project');
    expect(projectLinkError('https://framer.com/projects/Site--abc123')).toBe('');
    expect(projectLinkError('https://example.com/x')).toBe('This is not a Framer project link');
    expect(siteError('https://richadesign.in/')).toBe('');
    expect(siteError('richadesign.in/creative')).toMatch(/without a path/);
    expect(keyError('fr_abc12345')).toBe('');
    expect(keyError('a b; rm -rf')).toMatch(/does not look/);
  });
});

describe('her voice', () => {
  it('strips dashes and checks drafts', () => {
    expect(stripDashes('Readiness \u2014 a new column')).toBe('Readiness, a new column');
    expect(draftError('A line \u2014 with a dash')).toBe('Remove the em dash');
    expect(draftError('x'.repeat(161))).toBe('Keep each line under 160 characters');
    expect(draftError('  ')).toMatch(/Write the copy/);
    expect(draftError('I added a readiness column.')).toBe('');
    expect(longSentences(`${'word '.repeat(30)}end. Short one.`)).toHaveLength(1);
  });
});

describe('confidential work', () => {
  it('finds names and numbers, and hides names when cleared', () => {
    const flags = findFlags('Acme cut setup time by 40% for 1200 employees in 2026.', [{ name: 'Acme', kind: 'client' }]);
    expect(flags).toEqual([{ kind: 'client', text: 'Acme' }, { kind: 'number', text: '40%' }, { kind: 'number', text: '1200' }]);
    expect(flagLine(flags)).toBe('Names a client: Acme. Shows real numbers: 40%, 1200.');
    expect(hideNames('At Acme I built it.', flags)).toBe('At an HR SaaS company I built it.');
  });
});

const raw = [
  { page: '/helpdesk-dashboard', section: 'Results', kind: 'change', what: 'Add readiness', why: 'Shows \u2014 judgement', draft: 'I added readiness.\n\nIt cut setup by 40%.', images: ['60:1', '99:9'], sources: [{ block: KEY, quotes: ['Readiness shows which workflows are close'] }] },
  { page: '/x', kind: 'add', what: 'No source', draft: 'x', sources: [{ block: 'other/1/x', quotes: [] }] },
  { page: 'new', kind: 'new-case-study', what: 'Atlas', draft: 'Atlas is an AI colleague.', sources: [{ block: KEY }], flags: [{ kind: 'product', text: 'Atlas' }] },
];

describe('suggestions and picks', () => {
  const list = cleanSuggestions({ suggestions: raw }, [{ key: KEY, screens: ['60:1'] }], []);

  it('keeps known sources and screens, strips dashes and adds the number flags', () => {
    expect(list.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(list[0].why).toBe('Shows, judgement');
    expect(list[0].images).toEqual(['60:1']);
    expect(list[0].flags).toEqual([{ kind: 'number', text: '40%' }]);
    expect(list[1].flags).toEqual([{ kind: 'product', text: 'Atlas' }]);
  });

  it('names the card that blocks the edit button', () => {
    expect(pickSummary(list, {}).blocker).toBe('Pick at least one suggestion to use');
    const picks = { s1: { choice: 'use' as const, draft: list[0].draft, images: [], cleared: false }, s2: { choice: 'skip' as const, draft: '', images: [], cleared: false } };
    expect(pickSummary(list, picks)).toEqual({ picked: 1, total: 2, blocker: 'Change · Helpdesk dashboard · Results: tick "I can show this" first', blockerId: 's1' });
    picks.s1.cleared = true;
    expect(pickSummary(list, picks).blocker).toBeNull();
    picks.s1.draft = 'a \u2014 b';
    expect(pickSummary(list, picks).blocker).toMatch(/Remove the em dash/);
  });

  it('builds the copy pack and the outcome per block', () => {
    const picks = { s1: { choice: 'use' as const, draft: 'One.\n\nTwo.', images: ['60:1'], cleared: true }, s2: { choice: 'skip' as const, draft: '', images: [], cleared: false } };
    expect(copyPack(list, picks)).toEqual([{ id: 's1', head: 'Change · Helpdesk dashboard · Results', page: '/helpdesk-dashboard', section: 'Results', blocks: ['One.', 'Two.'], images: ['60:1'] }]);
    expect(blockOutcome(list, picks, [KEY, 'B/1/x'])).toEqual({ [KEY]: 'used', 'B/1/x': 'skipped' });
    expect(blockOutcome(list, { s2: picks.s2 }, [KEY])).toEqual({ [KEY]: 'later' });
    expect(usedLine(list.slice(0, 1))).toBe('Used on the portfolio: /helpdesk-dashboard, Results');
  });
});

describe('runs', () => {
  it('maps the run state to the strip and shapes', () => {
    expect(strip('picking').map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(strip('done').every((s) => s.state === 'done')).toBe(true);
    expect(runShape('gathering')).toBe('running');
    expect(runShape('edit-failed')).toBe('failed');
    expect(runShape('copy')).toBe('waiting');
    expect(runId(new Date(2026, 9, 20, 14, 2, 5))).toBe('20261020-140205');
  });

  it('writes one history block per run, newest first, and replaces it on a rerun', () => {
    const list: Suggestion[] = cleanSuggestions(raw, [{ key: KEY, screens: [] }], []);
    const run: Run = { id: '20261020-140205', state: 'copy', startedAt: 0, blocks: [KEY], mode: 'copy' };
    const picks = { s1: { choice: 'use' as const, draft: 'x', images: [], cleared: true } };
    const b1 = runBlock(run, list, picks, [{ key: KEY, label: 'Atlas · 1.19 · Flow 1 · Connectors' }], [], new Date(2026, 9, 20));
    expect(b1).toContain('## Tue 20 Oct 2026 · Run 20261020-140205');
    expect(b1).toContain('Picked: 1 · Skipped: 0 · Published: Not published');
    expect(b1).toContain('- Change · Helpdesk dashboard · Results: Add readiness (copy pack)');
    let md = upsertRunBlock('', run.id, b1);
    const run2 = { ...run, id: '20261021-090000' };
    md = upsertRunBlock(md, run2.id, runBlock(run2, list, {}, [], [], new Date(2026, 9, 21)));
    expect(md.indexOf('20261021-090000')).toBeLessThan(md.indexOf('20261020-140205'));
    md = upsertRunBlock(md, run.id, b1.replace('Published: Not published', 'Published: yes'));
    expect(md.match(/ds:run 20261020-140205/g)).toHaveLength(1);
    expect(md).toContain('Published: yes');
    expect(md.startsWith('# Portfolio · richadesign.in')).toBe(true);
  });
});
