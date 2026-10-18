import { describe, expect, it } from 'vitest';
import { filterGroups, groupChats } from './Chats';
import type { LiveChat } from '../../../shared/protocol';

const chat = (id: string, cwd: string, lastActive: number) => ({ id, cwd, lastActive, sessionId: null, title: 'New chat', running: false, pending: 0 }) as unknown as LiveChat;

describe('groupChats', () => {
  it('puts every chat without a file in one group', () => {
    const live = [chat('a', '/h/DesignStudio/chat-20261018-092121', 3), chat('b', '/h/DesignStudio/chat-20261018-093356', 2), chat('c', '/h/DesignStudio/scratch', 1)];
    const groups = groupChats(live, [], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ cwd: '', name: 'No file yet' });
    expect(groups[0].open.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a chat folder with an attached file as its own group', () => {
    const dir = '/h/DesignStudio/chat-20261018-092121';
    const groups = groupChats([chat('a', dir, 1)], [], [{ cwd: dir, key: 'k', name: 'Cart', url: 'u' }]);
    expect(groups[0]).toMatchObject({ cwd: dir, name: 'Cart' });
  });
});

describe('filterGroups', () => {
  const titled = (id: string, title: string) => ({ ...chat(id, '/h/f', 1), title }) as LiveChat;
  const groups = [
    { cwd: '/h/f', name: 'Checkout redesign', open: [titled('a', 'Empty states')], recent: [] },
    { cwd: '/h/g', name: 'Onboarding', open: [titled('b', 'Pricing page'), titled('c', 'Empty cart')], recent: [{ sessionId: 's', cwd: '/h/g', title: 'Old pricing', lastModified: 1 }] },
  ] as Parameters<typeof filterGroups>[0];

  it('returns every group for an empty query', () => {
    expect(filterGroups(groups, '  ')).toBe(groups);
  });

  it('keeps a whole group when its file name matches', () => {
    expect(filterGroups(groups, 'checkout')).toEqual([groups[0]]);
  });

  it('keeps only matching chats otherwise and drops empty groups', () => {
    const r = filterGroups(groups, 'pricing');
    expect(r).toHaveLength(1);
    expect(r[0].open.map((c) => c.id)).toEqual(['b']);
    expect(r[0].recent.map((s) => s.sessionId)).toEqual(['s']);
  });
});
