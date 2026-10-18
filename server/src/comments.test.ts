import { describe, expect, it } from 'vitest';
import { flattenComments } from './figma.js';

const user = (handle: string) => ({ handle, img_url: `https://img/${handle}` });

describe('flattenComments', () => {
  const raw = [
    { id: '1', message: 'old open', user: user('ann'), created_at: '2026-10-01T10:00:00Z', resolved_at: null, client_meta: { node_id: '1:2' } },
    { id: '2', message: 'new open', user: user('bo'), created_at: '2026-10-05T10:00:00Z', resolved_at: null },
    { id: '3', message: 'done', user: user('cy'), created_at: '2026-10-09T10:00:00Z', resolved_at: '2026-10-10T10:00:00Z' },
    { id: '4', message: 'second', user: user('bo'), created_at: '2026-10-03T10:00:00Z', parent_id: '1' },
    { id: '5', message: 'first', user: user('cy'), created_at: '2026-10-02T10:00:00Z', parent_id: '1' },
  ];

  it('puts unresolved first, newest first', () => expect(flattenComments(raw).map((t) => t.id)).toEqual(['2', '1', '3']));
  it('nests replies oldest first and drops them from the top level', () => {
    const t = flattenComments(raw).find((x) => x.id === '1')!;
    expect(t.replies.map((r) => r.message)).toEqual(['first', 'second']);
  });
  it('reads the node id and defaults when missing', () => {
    const [a, b] = flattenComments(raw);
    expect(a.nodeId).toBeNull();
    expect(b.nodeId).toBe('1:2');
    expect(b.user).toEqual({ handle: 'ann', img_url: 'https://img/ann' });
  });
});
