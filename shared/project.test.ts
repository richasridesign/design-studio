import { describe, expect, it } from 'vitest';
import { adoptFromMap, bumpMajor, compareIds, flowDirName, flowSectionName, iterationLabel, iterationName, latestOf, nextMinor, packTag, parseIterationId, parseSectionDate, parseSectionName, projectInstructions, sortIds, unpackTag, weekdayDate, workingIteration, type MapPages, type MapRow, type Project } from './project.js';

describe('iteration ids', () => {
  it('parses with or without the V and a minor', () => {
    expect(parseIterationId('1')).toEqual({ major: 1, minor: 0 });
    expect(parseIterationId('V1.19')).toEqual({ major: 1, minor: 19 });
    expect(parseIterationId(' v0.2 ')).toEqual({ major: 0, minor: 2 });
    expect(parseIterationId('1.2.3')).toBeNull();
    expect(parseIterationId('latest')).toBeNull();
    expect(parseIterationId('')).toBeNull();
  });

  it('sorts numerically per part, never as text', () => {
    expect(sortIds(['1.10', '1.2', '0.2', '1', '2', '1.1'])).toEqual(['0.2', '1', '1.1', '1.2', '1.10', '2']);
    expect(compareIds('1.0', '1')).toBe(0);
    expect(compareIds('x', '1')).toBeLessThan(0);
  });

  it('counts the next minor in the highest major and bumps the major', () => {
    expect(nextMinor(['1', '1.17', '1.18'])).toBe('1.19');
    expect(nextMinor(['1.18', '2'])).toBe('2.1');
    expect(nextMinor([])).toBe('0.1');
    expect(bumpMajor(['1.19'])).toBe('2');
    expect(bumpMajor([])).toBe('1');
  });
});

describe('names and dates', () => {
  it('formats the weekday date and reads it back', () => {
    expect(weekdayDate('2026-10-20')).toBe('Tue 20 Oct 2026');
    expect(weekdayDate('2026-10-19')).toBe('Mon 19 Oct 2026');
    expect(parseSectionDate('Mon 19 Oct 2026')).toBe('2026-10-19');
    expect(parseSectionDate('5 Jan 2027')).toBe('2027-01-05');
    expect(parseSectionDate('Readiness')).toBeNull();
  });

  it('builds section names by convention', () => {
    expect(iterationName('1.19', 'Readiness', '2026-10-20')).toBe('V1.19 · Readiness · Tue 20 Oct 2026');
    expect(iterationName('2', '', '2026-10-20')).toBe('V2 · Tue 20 Oct 2026');
    expect(flowSectionName('1.19', { n: 3, name: 'Connectors' })).toBe('V1.19 · Flow 3 · Connectors');
    expect(flowDirName({ n: 3, slug: 'connectors' })).toBe('03-connectors');
  });

  it('parses an existing section name', () => {
    expect(parseSectionName('V1.18 · Trust and safety · Mon 19 Oct 2026')).toEqual({ id: '1.18', topic: 'Trust and safety', date: '2026-10-19' });
    expect(parseSectionName('V1.17')).toEqual({ id: '1.17', topic: '', date: null });
    expect(parseSectionName('1.2 · Two · part topic · 3 Mar 2026')).toEqual({ id: '1.2', topic: 'Two · part topic', date: '2026-03-03' });
    expect(parseSectionName('LATEST')).toBeNull();
    expect(parseSectionName('Flow 3 · Connectors')).toBeNull();
  });

  it('labels iterations for the sidebar', () => {
    expect(iterationLabel({ id: '1.19', topic: 'Readiness' })).toBe('1.19 · Readiness');
    expect(iterationLabel({ id: '1', name: 'LATEST' })).toBe('1 · baseline');
    expect(iterationLabel({ id: '1.17' })).toBe('1.17');
  });

  it('packs and unpacks tags', () => {
    expect(packTag({ kind: 'flow', iteration: '1.19', flow: 'connectors' })).toBe('flow;1.19;connectors');
    expect(unpackTag('flow;1.19;connectors')).toEqual({ kind: 'flow', iteration: '1.19', flow: 'connectors' });
    expect(unpackTag('iteration;1.19;')).toEqual({ kind: 'iteration', iteration: '1.19' });
    expect(unpackTag('nope;;')).toBeNull();
    expect(unpackTag(null)).toBeNull();
  });
});

const S = (id: string, name: string, y: number, kids: MapRow[] = [], x = 0): MapRow => [ 'S', id, name, x, y, 1000, 800, kids, 0];
const F = (id: string, name: string, x = 0): MapRow => ['F', id, name, x, 0, 1440, 900];

const pages: MapPages = [
  ['0:1', 'Comp', [S('5:1', 'Buttons', 0, [F('5:2', 'Button')])]],
  ['9:1', 'Flows', [
    S('88:1', 'V1.18 · Trust and safety · Mon 19 Oct 2026', -2000, [F('88:2', 'Home'), F('88:3', 'Activate')]),
    S('87:1', 'V1.17 · Readiness · Thu 15 Oct 2026', -1000, [F('87:2', 'Home')]),
    S('50:1', 'LATEST', 0, [
      S('60:1', 'Activate Harisson', 0, [F('61:1', 'Home', 0), F('61:2', 'Activate', 1500)]),
      S('63:1', 'Connectors', 1000, [F('64:2', 'Connect', 1500), F('64:1', 'Connectors', 0)]),
    ]),
    S('70:1', 'Parked', 3000, [F('70:2', 'Old banner')]),
    S('71:1', 'Scratch', 4000),
  ], [['61:1', 'Flow 1 start'], ['99:9', 'Elsewhere']]],
];

describe('adoptFromMap', () => {
  const p = adoptFromMap(pages);

  it('picks the page with the sections and reads flows from LATEST in position order', () => {
    expect(p.page).toEqual({ id: '9:1', name: 'Flows' });
    expect(p.flows.map((f) => [f.n, f.slug, f.name, f.baseline])).toEqual([[1, 'activate-harisson', 'Activate Harisson', '60:1'], [2, 'connectors', 'Connectors', '63:1']]);
  });

  it('takes entry screens from the prototype starting points, else the left-most screen', () => {
    expect(p.flows[0].entry).toEqual(['61:1']);
    expect(p.flows[1].entry).toEqual(['64:1']);
  });

  it('adopts V sections as frozen iterations, LATEST as the baseline 1, and Parked', () => {
    expect(p.iterations.map((it) => [it.id, it.state, it.topic, it.date, it.screens])).toEqual([
      ['1', 'frozen', undefined, undefined, 4],
      ['1.17', 'frozen', 'Readiness', '2026-10-15', 1],
      ['1.18', 'frozen', 'Trust and safety', '2026-10-19', 2],
    ]);
    expect(p.iterations[0].flows).toEqual({ 'activate-harisson': { node: '60:1' }, connectors: { node: '63:1' } });
    expect(p.parked).toEqual({ node: '70:1', name: 'Parked' });
    expect(p.skipped).toEqual([{ node: '71:1', name: 'Scratch' }]);
  });

  it('returns nothing for a file with no iteration sections', () => {
    expect(adoptFromMap([['0:1', 'Design', [F('1:1', 'Cart')]]])).toMatchObject({ page: null, flows: [], iterations: [] });
  });
});

describe('derived views and prompt', () => {
  const project: Project = {
    key: 'k',
    flows: [{ n: 1, slug: 'activate', name: 'Activate', entry: ['61:1'], baseline: '60:1' }, { n: 3, slug: 'connectors', name: 'Connectors', entry: ['64:1'] }],
    iterations: [
      { id: '1', node: '50:1', name: 'LATEST', state: 'frozen', adopted: true, flows: { activate: { node: '60:1' }, connectors: { node: '63:1' } } },
      { id: '1.18', node: '88:1', state: 'frozen', adopted: true },
      { id: '1.19', node: '120:1', topic: 'Readiness', state: 'working', flows: { activate: { node: '120:2', states: '120:9' } } },
    ],
  };

  it('finds the latest iteration of a flow and the working one', () => {
    expect(latestOf(project, 'activate')?.id).toBe('1.19');
    expect(latestOf(project, 'connectors')?.id).toBe('1');
    expect(latestOf(project, 'nope')).toBeNull();
    expect(workingIteration(project)?.id).toBe('1.19');
  });

  it('scopes a flow chat to its subsection and names what it must not touch', () => {
    const text = projectInstructions({ scope: 'flow', project, flow: project.flows[0], iteration: project.iterations[2] });
    expect(text).toContain('Flow 1 · Activate in iteration 1.19 · Readiness (working)');
    expect(text).toContain('Your flow subsection: 120:2 "V1.19 · Flow 1 · Activate"');
    expect(text).toContain('states subsection: 120:9');
    expect(text).toContain('frozen iteration (1, 1.18)');
    expect(text).toContain('Entry screens of this flow: 61:1');
    expect(text).not.toContain('Design Studio page');
  });

  it('tells a flow with no subsection yet to make one, and a project task which iterations are open', () => {
    const text = projectInstructions({ scope: 'flow', project, flow: project.flows[1], iteration: project.iterations[2] });
    expect(text).toContain('no subsection in 1.19 yet: create one named "V1.19 · Flow 3 · Connectors"');
    const task = projectInstructions({ scope: 'project', project });
    expect(task).toContain('Working iterations you may edit: 1.19 · Readiness (section 120:1)');
    expect(projectInstructions({ scope: 'project', project: { ...project, iterations: project.iterations.slice(0, 2) } })).toContain('no working iteration yet');
  });
});
