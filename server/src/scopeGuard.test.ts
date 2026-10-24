import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatContext, MapRow, Project } from '../../shared/project.js';
import type { FileMap } from './fileMap.js';
import { checkScope, chatFolderOwns, frozenChat, type Owns } from './scopeGuard.js';
import { FIGMA_WRITE_MATCHER } from './lean.js';

// Page "Hi fi": LATEST (1, frozen) with Flow 1 and 2, V1.19 (working) with Flow 1, Flow 2 and Flow 1 states, V1.20
// (working) with Flow 1, Parked, a loose frame, and a V0.3 section tagged with an iteration project.json does not
// know. Page "Comp": a section of components. One section (40:1) has no tag, only project.json knows it.
const S = (id: string, name: string, tag: string | null, kids: MapRow[] = []): MapRow => ['S', id, name, 0, 0, 100, 100, kids, 0, tag];
const F = (id: string, name: string): MapRow => ['F', id, name, 0, 0, 10, 10];
const map: FileMap = {
  key: 'K', name: 'File', readAt: 1,
  raw: {
    pages: [
      ['0:1', 'Hi fi', [
        S('1:1', 'LATEST', 'iteration;1;', [S('1:2', 'Flow 1 · Discover', 'flow;1;discover', [F('1:3', 'Home')]), S('1:4', 'Flow 2 · Connectors', 'flow;1;connectors', [F('1:5', 'List')])]),
        S('2:1', 'V1.19 · Readiness', 'iteration;1.19;', [
          F('2:9', 'Decisions note'),
          S('2:2', 'V1.19 · Flow 1 · Discover', 'flow;1.19;discover', [F('2:3', 'Home (Entry, unchanged)')]),
          S('2:4', 'V1.19 · Flow 2 · Connectors', 'flow;1.19;connectors', [F('2:5', 'List')]),
          S('2:6', 'V1.19 · Flow 1 · States', 'states;1.19;discover', [F('2:7', 'Error')]),
          S('40:1', 'V1.19 · Flow 3 · Agents', null, [F('40:2', 'Agents')]),
        ]),
        S('3:1', 'V1.20 · Next', 'iteration;1.20;', [S('3:2', 'V1.20 · Flow 1 · Discover', 'flow;1.20;discover', [F('3:3', 'Home')])]),
        S('4:1', 'Parked', 'parked;;', [F('4:2', 'Add a workflow')]),
        S('7:1', 'V0.3 · Flow 3 · Add a connector · Fri 23 Oct 2026', 'flow;0.3;connectors', [F('7:2', 'Add a connector')]),
        F('5:1', 'Loose frame'),
      ], []],
      ['0:2', 'Comp', [S('6:1', 'Buttons', null, [F('6:2', 'Button')])], []],
    ],
    sets: [], comps: [], vars: [], styles: [],
  },
};
const project: Project = {
  key: 'K',
  flows: [{ n: 1, slug: 'discover', name: 'Discover', entry: ['1:3'] }, { n: 2, slug: 'connectors', name: 'Connectors', entry: ['1:5'] }, { n: 3, slug: 'agents', name: 'Agents', entry: [] }],
  iterations: [
    { id: '1', node: '1:1', name: 'LATEST', state: 'frozen', flows: { discover: { node: '1:2' }, connectors: { node: '1:4' } } },
    { id: '1.19', node: '2:1', topic: 'Readiness', state: 'working', flows: { discover: { node: '2:2', states: '2:6' }, connectors: { node: '2:4' }, agents: { node: '40:1' } } },
    { id: '1.20', node: '3:1', topic: 'Next', state: 'working', flows: { discover: { node: '3:2' } } },
  ],
  parked: { node: '4:1' },
};
const flowChat = (slug: string, it = '1.19', p = project): ChatContext => ({ scope: 'flow', project: p, flow: p.flows.find((f) => f.slug === slug)!, iteration: p.iterations.find((x) => x.id === it)! });
const projectChat: ChatContext = { scope: 'project', project };
const check = (ctx: ChatContext, ids: string[], p = project, owns?: Owns) => checkScope(map, ctx, p, ids, owns);

describe('scope guard, Flow 1 chat in 1.19', () => {
  const ctx = flowChat('discover');
  it.each([
    ['its own subsection', '2:2'],
    ['a screen in it', '2:3'],
    ['its states subsection', '2:6'],
    ['a screen in its states', '2:7'],
    ['the Decisions note in the iteration section', '2:9'],
    ['its own flow in frozen LATEST (cloning from the baseline)', '1:3'],
    ['the Comp page', '6:2'],
    ['a loose frame outside every tagged section', '5:1'],
    ['an id the map does not know', '99:9'],
  ])('allows %s', (_, id) => expect(check(ctx, [id]).allow).toBe(true));

  it.each([
    ['another flow in the same iteration', '2:5', '2:5 is in Flow 2 · V1.19, which belongs to the Flow 2 chat. Ask there, or run this as a project task.'],
    ['an untagged subsection project.json knows', '40:2', '40:2 is in Flow 3 · V1.19, which belongs to the Flow 3 chat.'],
    ['the iteration section itself', '2:1', '2:1 is the section of iteration V1.19.'],
    ['another flow in frozen LATEST', '1:5', '1:5 is in Flow 2 · V1, which is frozen: chats only read it. It belongs to Flow 2.'],
    ['the LATEST container itself', '1:1', '1:1 is in iteration V1, which is frozen'],
    ['its own flow in another working iteration', '3:3', '3:3 is in Flow 1 · V1.20, another working iteration, which belongs to the Flow 1 chat in V1.20.'],
    ['the Parked section', '4:2', '4:2 is in the Parked section.'],
  ])('denies %s', (_, id, text) => {
    const v = check(ctx, [id]);
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.reason).toContain(text);
      expect(v.reason).toContain('Allow edits anywhere');
    }
  });

  it('names the first denied id when a script mixes allowed and denied ones', () => {
    expect(check(ctx, ['2:3', '99:1', '2:5', '4:2'])).toMatchObject({ allow: false, id: '2:5' });
  });

  it('allows the iteration section while its own flow has no subsection yet', () => {
    const p: Project = { ...project, iterations: project.iterations.map((it) => (it.id === '1.19' ? { ...it, flows: { connectors: { node: '2:4' } } } : it)) };
    expect(check(flowChat('discover', '1.19', p), ['2:1'], p).allow).toBe(true);
  });

  it('uses the project state it is given: a frozen own iteration still allows its own flow, never other flows', () => {
    const p: Project = { ...project, iterations: project.iterations.map((it) => (it.id === '1.19' ? { ...it, state: 'frozen' } : it)) };
    expect(check(flowChat('discover', '1.19', p), ['2:3'], p).allow).toBe(true);
    expect(check(flowChat('discover', '1.19', p), ['2:5'], p).allow).toBe(false);
  });
});

describe('scope guard, only sections with a chat are another chat\'s', () => {
  const ctx = flowChat('discover');
  // Chats were opened on Flow 1 and Flow 2 in V1.19 only.
  const owns: Owns = (it, flow) => it === '1.19' && (flow === 'discover' || flow === 'connectors');
  it('allows a section tagged with an iteration project.json does not know, for flow and project chats', () => {
    expect(check(ctx, ['7:2'], project, owns).allow).toBe(true);
    expect(check(ctx, ['7:1']).allow).toBe(true);
    expect(check(projectChat, ['7:2']).allow).toBe(true);
  });
  it('allows a working iteration no chat was opened on, and denies it once a chat is', () => {
    expect(check(ctx, ['3:3', '3:2', '3:1'], project, owns).allow).toBe(true);
    expect(check(ctx, ['3:3'], project, (it, flow) => owns(it, flow) || (it === '1.20' && flow === 'discover'))).toMatchObject({ allow: false, id: '3:3' });
  });
  it('allows another flow of the same iteration only while it has no chat', () => {
    expect(check(ctx, ['2:5'], project, owns)).toMatchObject({ allow: false, id: '2:5' });
    expect(check(ctx, ['40:2'], project, owns).allow).toBe(true);
  });
  it('still denies frozen iterations of other flows, Parked and its own iteration section, chat or not', () => {
    const none: Owns = () => false;
    expect(check(ctx, ['1:5'], project, none).allow).toBe(false);
    expect(check(ctx, ['4:2'], project, none).allow).toBe(false);
    expect(check(ctx, ['2:1'], project, none).allow).toBe(false);
  });
  it('reads the chat folders under the project root by default', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'scope-'));
    mkdirSync(path.join(root, 'flows', '01-discover', 'iterations', '1.19'), { recursive: true });
    const found = chatFolderOwns(root, project);
    expect(found('1.19', 'discover')).toBe(true);
    expect(found('1.20', 'discover')).toBe(false);
    expect(found('1.19', 'connectors')).toBe(false);
    expect(checkScope(map, { ...ctx, root }, project, ['3:3', '2:5']).allow).toBe(true);
    mkdirSync(path.join(root, 'flows', '01-discover', 'iterations', '1.20'), { recursive: true });
    expect(checkScope(map, { ...ctx, root }, project, ['3:3'])).toMatchObject({ allow: false, id: '3:3' });
  });
});

describe('scope guard, project chat', () => {
  it('allows every working iteration and the Comp page', () => {
    expect(check(projectChat, ['2:3', '2:5', '3:3', '2:1', '6:2']).allow).toBe(true);
  });
  it('denies frozen iterations and Parked', () => {
    expect(check(projectChat, ['1:3'])).toMatchObject({ allow: false, id: '1:3' });
    expect(check(projectChat, ['4:2']).allow).toBe(false);
  });
});

describe('scope guard, nothing to decide by', () => {
  it('allows everything with no map, no project or no context', () => {
    expect(checkScope(null, flowChat('discover'), project, ['2:5']).allow).toBe(true);
    expect(checkScope(map, null, project, ['2:5']).allow).toBe(true);
    expect(checkScope(map, flowChat('discover'), null, ['2:5']).allow).toBe(true);
  });
});

describe('a chat on a frozen iteration is read only', () => {
  const setState = (state: 'working' | 'frozen'): Project => ({ ...project, iterations: project.iterations.map((it) => (it.id === '1.19' ? { ...it, state } : it)) });
  it('walks freeze and reopen on an open chat: writes stop at once and come back, read from the fresh project', () => {
    // The chat was opened while 1.19 was working; its context is cached at start.
    const ctx = flowChat('discover', '1.19');
    expect(frozenChat(ctx, project)).toBeNull();
    // Frozen from the sidebar while the chat is open: every write is denied, own subsection included.
    expect(frozenChat(ctx, setState('frozen'))).toMatch(/1\.19, which is frozen/);
    // Reopened: allowed again, even though the chat started on a frozen iteration.
    expect(frozenChat(flowChat('discover', '1.19', setState('frozen')), setState('working'))).toBeNull();
  });
  it('denies a chat opened on frozen LATEST, also with no map and no project.json read', () => {
    expect(frozenChat(flowChat('discover', '1'), project)).not.toBeNull();
    expect(frozenChat(flowChat('discover', '1'), null)).not.toBeNull();
  });
  it('leaves project chats to the scope guard, which keeps them off frozen iterations', () => {
    expect(frozenChat(projectChat, setState('frozen'))).toBeNull();
    expect(frozenChat(null, project)).toBeNull();
  });
  it('runs on every Figma write tool, not only use_figma, and never on reads', () => {
    const m = new RegExp(FIGMA_WRITE_MATCHER);
    for (const t of ['use_figma', 'generate_figma_design', 'upload_assets', 'html_to_figma', 'create_new_file']) expect(m.test(`mcp__plugin_figma_figma__${t}`)).toBe(true);
    for (const t of ['get_screenshot', 'get_metadata', 'get_design_context']) expect(m.test(`mcp__plugin_figma_figma__${t}`)).toBe(false);
  });
});
