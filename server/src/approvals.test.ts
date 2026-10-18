import { describe, expect, it } from 'vitest';
import { Approvals, permissionTitle } from './approvals.js';

describe('permissionTitle', () => {
  it('describes tools in plain words', () => {
    expect(permissionTitle('Bash', { command: 'ls', description: 'List files' })).toBe('List files');
    expect(permissionTitle('Edit', { file_path: '/repo/src/a.ts' })).toBe('Edit a.ts');
    expect(permissionTitle('WebFetch', { url: 'https://example.com/x' })).toBe('Fetch a page from example.com');
    expect(permissionTitle('mcp__claude-in-chrome__read_page', {})).toBe('Use read page from claude-in-chrome');
  });
});

describe('answerPermission', () => {
  const setup = () => {
    const state = { pending: [] } as any;
    const a = new Approvals(state, () => {});
    const result = a.ask('ExitPlanMode', { plan: 'x' }, { signal: new AbortController().signal });
    return { a, id: state.pending[0].id as string, result };
  };

  it('passes the designer note to Claude when they ask for changes', async () => {
    const { a, id, result } = setup();
    a.answerPermission(id, false, false, ' Use option B for the error message ');
    expect(await result).toEqual({ behavior: 'deny', message: 'The designer wants changes before you go on: Use option B for the error message' });
  });

  it('keeps the plain denial without a note', async () => {
    const { a, id, result } = setup();
    a.answerPermission(id, false);
    expect(await result).toMatchObject({ behavior: 'deny', message: 'User denied this action in the Design Studio UI.' });
  });

  it('carries her words on the approved plan, so go with a note builds in one round', async () => {
    const { a, id, result } = setup();
    a.answerPermission(id, true, false, ' go, keep the voice button ');
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { plan: 'x\n\n## Approved with this note from the designer\ngo, keep the voice button' }, updatedPermissions: undefined });
  });

  it('approves a bare go with the plan unchanged', async () => {
    const { a, id, result } = setup();
    a.answerPermission(id, true);
    expect(await result).toMatchObject({ behavior: 'allow', updatedInput: { plan: 'x' } });
  });
});
