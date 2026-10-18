import { describe, expect, it } from 'vitest';
import { permissionTitle } from './approvals.js';

describe('permissionTitle', () => {
  it('describes tools in plain words', () => {
    expect(permissionTitle('Bash', { command: 'ls', description: 'List files' })).toBe('List files');
    expect(permissionTitle('Edit', { file_path: '/repo/src/a.ts' })).toBe('Edit a.ts');
    expect(permissionTitle('WebFetch', { url: 'https://example.com/x' })).toBe('Fetch a page from example.com');
    expect(permissionTitle('mcp__claude-in-chrome__read_page', {})).toBe('Use read page from claude-in-chrome');
  });
});
