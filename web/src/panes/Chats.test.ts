import { describe, expect, it } from 'vitest';
import { buildTree, filterTree, locateChat } from './projectTree';
import type { LiveChat, SavedSession } from '../../../shared/protocol';
import type { ProjectSummary } from '../../../shared/project';

const chat = (id: string, cwd: string, lastActive: number, title = 'New chat') => ({ id, cwd, lastActive, sessionId: null, title, running: false, pending: 0 }) as unknown as LiveChat;
const old = (sessionId: string, cwd: string, lastModified: number, title = 'Old chat'): SavedSession => ({ sessionId, cwd, lastModified, title, gitBranch: null });
const ROOT = '/h/workspace/design-projects/atlas-abc123';
const folder = (cwd: string, name: string, project: ProjectSummary['project'] = null): ProjectSummary => ({ cwd, key: 'k', name, url: 'u', stage: null, project });
const adopted: ProjectSummary['project'] = {
  key: 'k',
  adoptedAt: 100,
  flows: [{ n: 1, slug: 'onboarding', name: 'Onboarding', entry: [] }, { n: 2, slug: 'connectors', name: 'Connectors', entry: [] }],
  iterations: [{ id: '1', name: 'LATEST', state: 'frozen', adopted: true }, { id: '1.18', topic: 'Trust', state: 'frozen', adopted: true }, { id: '1.19', topic: 'Readiness', state: 'working' }],
};

describe('locateChat', () => {
  it('tells a flow iteration folder from the root', () => {
    expect(locateChat(ROOT, ROOT)).toBe('root');
    expect(locateChat(`${ROOT}/flows/02-connectors/iterations/1.19`, ROOT)).toEqual({ flowDir: '02-connectors', iteration: '1.19' });
    expect(locateChat(`${ROOT}/flows/02-connectors`, ROOT)).toBe('root');
    expect(locateChat('/elsewhere', ROOT)).toBeNull();
  });
});

describe('buildTree', () => {
  it('puts every chat without a file in one group', () => {
    const live = [chat('a', '/h/DesignStudio/chat-20261018-092121', 3), chat('b', '/h/DesignStudio/chat-20261018-093356', 2), chat('c', '/h/DesignStudio/scratch', 1)];
    const t = buildTree(live, [], []);
    expect(t.projects).toHaveLength(0);
    expect(t.noFile.open.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a chat folder with an attached file as its own project, not adopted', () => {
    const dir = '/h/DesignStudio/chat-20261018-092121';
    const t = buildTree([chat('a', dir, 1)], [], [folder(dir, 'Cart')]);
    expect(t.projects[0]).toMatchObject({ cwd: dir, name: 'Cart', adopted: false, count: 1 });
    expect(t.projects[0].before.open.map((c) => c.id)).toEqual(['a']);
  });

  it('places chats of an adopted file under flow and iteration, before flows, or project tasks', () => {
    const live = [chat('x', `${ROOT}/flows/02-connectors/iterations/1.19`, 300, 'Readiness column'), chat('t', ROOT, 200, 'Rename the file')];
    const saved = [old('s1', ROOT, 50, 'Early chat'), old('s2', `${ROOT}/flows/01-onboarding/iterations/1.18`, 80, 'Trust copy'), old('s3', `${ROOT}/flows/09-gone/iterations/1.18`, 90, 'Lost flow')];
    const t = buildTree(live, saved, [folder(ROOT, 'Atlas', adopted)]);
    const p = t.projects[0];
    expect(p.adopted).toBe(true);
    expect(p.working?.id).toBe('1.19');
    expect(p.flows.map((f) => f.flow.slug)).toEqual(['onboarding', 'connectors']);
    // The working iteration shows under every flow; frozen ones only where a chat ran.
    expect(p.flows[0].iterations.map((i) => i.iteration.id)).toEqual(['1.19', '1.18']);
    expect(p.flows[1].iterations.map((i) => i.iteration.id)).toEqual(['1.19']);
    expect(p.flows[1].iterations[0].open.map((c) => c.id)).toEqual(['x']);
    expect(p.flows[0].iterations[1].recent.map((s) => s.sessionId)).toEqual(['s2']);
    expect(p.tasks.open.map((c) => c.id)).toEqual(['t']);
    expect(p.before.recent.map((s) => s.sessionId)).toEqual(['s3', 's1']);
    expect(p.count).toBe(5);
    expect(t.noFile.open).toHaveLength(0);
  });

  it('labels the baseline and topics', () => {
    const t = buildTree([chat('x', `${ROOT}/flows/01-onboarding/iterations/1`, 1)], [], [folder(ROOT, 'Atlas', adopted)]);
    expect(t.projects[0].flows[0].iterations.map((i) => i.label)).toEqual(['1.19 · Readiness', '1 · baseline']);
  });
});

describe('filterTree', () => {
  const t = buildTree(
    [chat('a', `${ROOT}/flows/02-connectors/iterations/1.19`, 3, 'Empty states'), chat('b', '/h/DesignStudio/cart', 2, 'Pricing page'), chat('c', '/h/DesignStudio/cart', 1, 'Empty cart')],
    [old('s', '/h/DesignStudio/cart', 1, 'Old pricing')],
    [folder(ROOT, 'Atlas', adopted), folder('/h/DesignStudio/cart', 'Checkout redesign')],
  );

  it('returns the whole tree for an empty query', () => {
    expect(filterTree(t, '  ')).toBe(t);
  });

  it('keeps a whole project when its file name matches, and a whole flow when the flow matches', () => {
    expect(filterTree(t, 'checkout').projects.map((p) => p.name)).toEqual(['Checkout redesign']);
    const r = filterTree(t, 'connectors');
    expect(r.projects.map((p) => p.name)).toEqual(['Atlas']);
    expect(r.projects[0].flows.map((f) => f.flow.slug)).toEqual(['connectors']);
  });

  it('keeps only matching chats otherwise and drops empty branches', () => {
    const r = filterTree(t, 'pricing');
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].before.open.map((c) => c.id)).toEqual(['b']);
    expect(r.projects[0].before.recent.map((s) => s.sessionId)).toEqual(['s']);
    expect(filterTree(t, 'empty').projects.map((p) => [p.name, p.count])).toEqual([['Atlas', 1], ['Checkout redesign', 1]]);
  });
});
