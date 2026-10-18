import { describe, expect, it } from 'vitest';
import { parseAuthStatus } from './doctor.js';

describe('parseAuthStatus', () => {
  it('reports a login without leaking identity fields', () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', orgId: 'x', subscriptionType: 'team' });
    const r = parseAuthStatus(out);
    expect(r).toEqual({ ok: true, detail: 'Signed in to Claude (claude.ai, team)' });
    expect(JSON.stringify(r)).not.toContain('a@b.c');
  });
  it('reports a missing login', () => {
    expect(parseAuthStatus('{"loggedIn":false}')).toMatchObject({ ok: false });
  });
  it('handles unreadable output', () => {
    expect(parseAuthStatus('nope')).toMatchObject({ ok: false });
  });
});
