import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MapRow, Project } from '../../shared/project.js';
import type { FileMap } from './fileMap.js';
import { iterationReviews, selectionNode, selectionView } from './selection.js';

const S = (id: string, name: string, kids: MapRow[] = []): MapRow => ['S', id, name, 0, 0, 100, 100, kids];
const F = (id: string, name: string): MapRow => ['F', id, name, 0, 0, 10, 10];
const map: FileMap = {
  key: 'K', name: 'File', readAt: 1,
  raw: {
    pages: [['0:1', 'Hi fi', [
      S('1:1', 'LATEST', [S('1:2', 'Flow 1 · Discover', [F('1:3', 'Home'), F('1:4', 'Search')]), S('1:5', 'Flow 2 · Connectors', [F('1:6', 'List')])]),
      S('2:1', 'V1.19 · Readiness', [S('2:2', 'V1.19 · Flow 1 · Discover', [F('2:3', 'Home (Entry, unchanged)'), F('2:4', 'Ready')]), S('2:6', 'V1.19 · Flow 1 · States', [F('2:7', 'Error')])]),
    ], []]],
    sets: [], comps: [], vars: [], styles: [],
  },
};
const project: Project = {
  key: 'K',
  flows: [{ n: 1, slug: 'discover', name: 'Discover', entry: ['1:3'] }, { n: 2, slug: 'connectors', name: 'Connectors', entry: ['1:6'] }],
  iterations: [
    { id: '1', node: '1:1', name: 'LATEST', state: 'frozen', flows: { discover: { node: '1:2' }, connectors: { node: '1:5' } } },
    { id: '1.19', node: '2:1', topic: 'Readiness', state: 'working', flows: { discover: { node: '2:2', states: '2:6' } } },
  ],
};

describe('selectionView', () => {
  it('an iteration lists its flows with their screens, then their states', () => {
    expect(selectionView(project, map, { iteration: '1.19' })).toEqual([
      { key: 'discover', title: 'Flow 1 · Discover', state: 'working', node: '2:2', items: [{ id: '2:3', name: 'Home (Entry, unchanged)' }, { id: '2:4', name: 'Ready' }, { id: '2:7', name: 'Error' }] },
    ]);
  });
  it('a flow lists its subsection in every iteration, newest first, frozen ones marked', () => {
    const g = selectionView(project, map, { flow: 'discover' });
    expect(g.map((x) => [x.title, x.state, x.items.length])).toEqual([['Iteration: 1.19 · Readiness', 'working', 3], ['Iteration: 1 · baseline', 'frozen', 2]]);
  });
  it('a project lists every iteration with its flow subsections', () => {
    const g = selectionView(project, map, {});
    expect(g.map((x) => [x.key, x.items.map((i) => i.name)])).toEqual([['1.19', ['V1.19 · Flow 1 · Discover']], ['1', ['Flow 1 · Discover', 'Flow 2 · Connectors']]]);
  });
  it('keeps the groups with no map, with no screens', () => {
    expect(selectionView(project, null, { iteration: '1.19' })[0].items).toEqual([]);
  });
});

describe('selectionNode', () => {
  it('focuses the flow subsection, else the iteration section', () => {
    expect(selectionNode(project, { iteration: '1.19', flow: 'discover' })).toBe('2:2');
    expect(selectionNode(project, { iteration: '1.19', flow: 'connectors' })).toBe('2:1');
    expect(selectionNode(project, { iteration: '1' })).toBe('1:1');
    expect(selectionNode(project, { flow: 'discover' })).toBe('2:2');
    expect(selectionNode(project, {})).toBe('2:1');
  });
});

describe('iterationReviews', () => {
  it('reads each flow folder of the iteration, newest run first', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sel-'));
    const dir = path.join(root, 'flows', '01-discover', 'iterations', '1');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ runs: [{ id: 'a', at: 1 }, { id: 'b', at: 5 }] }));
    const r = await iterationReviews(root, project, '1');
    expect(r.map((g) => [g.flow.slug, g.runs.map((x) => x.id)])).toEqual([['discover', ['b', 'a']], ['connectors', []]]);
  });
});
