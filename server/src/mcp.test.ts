import { describe, expect, it } from 'vitest';
import { authError, configDefs, configEntries, mcpFrom, probeOne } from './mcp.js';

describe('mcpFrom', () => {
  it('lists tools from the init tool list and hides the designstudio server', () => {
    const tools = ['Bash', 'mcp__linear__get_issue', 'mcp__linear__list_issues', 'mcp__designstudio__set_status'];
    const out = mcpFrom([{ name: 'linear', status: 'connected' }, { name: 'designstudio', status: 'connected' }, { name: 'grafana', status: 'failed', error: 'boom' }], tools);
    expect(out.map((s) => s.name)).toEqual(['linear', 'grafana']);
    expect(out[0].tools).toEqual([{ name: 'get_issue' }, { name: 'list_issues' }]);
    expect(out[1]).toMatchObject({ status: 'failed', error: 'boom', tools: undefined });
  });

  it('keeps the details from mcpServerStatus and drops secrets', () => {
    const [s] = mcpFrom([
      {
        name: 'tienda',
        status: 'connected',
        scope: 'user',
        serverInfo: { name: 'toolbox', version: '0.9.0' },
        config: { type: 'stdio', command: 'toolbox', args: ['--stdio'], env: { POSTGRES_PASSWORD: 'hunter2' } },
        tools: [{ name: 'execute_sql', description: 'Run SQL', annotations: { readOnly: true } }],
      },
    ]);
    expect(s).toEqual({
      name: 'tienda',
      status: 'connected',
      scope: 'user',
      type: 'stdio',
      command: 'toolbox --stdio',
      env: ['POSTGRES_PASSWORD'],
      version: '0.9.0',
      error: undefined,
      tools: [{ name: 'execute_sql', description: 'Run SQL', readOnly: true, destructive: undefined }],
    });
    expect(JSON.stringify(s)).not.toContain('hunter2');
  });

  it('labels claude.ai connectors and prefers source over scope', () => {
    const [s] = mcpFrom([{ name: 'docs', status: 'connected', scope: 'claudeai', source: 'claudeai', config: { type: 'claudeai-proxy', url: 'https://x' } }]);
    expect(s).toMatchObject({ scope: 'claudeai', type: 'claudeai', command: 'https://x' });
  });
});

describe('configEntries', () => {
  it('infers the transport and describes the command without env values', () => {
    expect(configEntries({ a: { command: 'x', args: ['-y'], env: { K: 'v' } }, b: { url: 'https://x' }, c: { type: 'sse' } }, 'project')).toEqual([
      { name: 'a', scope: 'project', type: 'stdio', command: 'x -y', env: ['K'] },
      { name: 'b', scope: 'project', type: 'http', command: 'https://x', env: undefined },
      { name: 'c', scope: 'project', type: 'sse', command: undefined, env: undefined },
    ]);
  });
});

describe('configDefs', () => {
  it('lets local override project override user', () => {
    const user = { mcpServers: { a: { command: 'user-a' }, b: { url: 'https://b' } }, projects: { '/repo': { mcpServers: { a: { command: 'local-a' } } } } };
    const repo = { mcpServers: { a: { command: 'project-a' }, c: { command: 'c' } } };
    expect(configDefs(user, repo, '/repo')).toEqual([
      { name: 'a', scope: 'local', def: { command: 'local-a' } },
      { name: 'b', scope: 'user', def: { url: 'https://b' } },
      { name: 'c', scope: 'project', def: { command: 'c' } },
    ]);
  });
});

describe('probeOne', () => {
  it('reports a connected server with its version and tools', async () => {
    const run = async () => ({ info: { version: '2.0' }, tools: [{ name: 'q', description: 'Query', annotations: { readOnlyHint: true } }] });
    expect(await probeOne('db', 'user', { command: 'toolbox', args: ['--stdio'] }, run)).toEqual({
      name: 'db', scope: 'user', type: 'stdio', command: 'toolbox --stdio', env: undefined,
      status: 'connected', version: '2.0', tools: [{ name: 'q', description: 'Query', readOnly: true, destructive: undefined }],
    });
  });

  it('turns an auth failure into needs-auth and anything else into failed', async () => {
    const auth = await probeOne('gw', 'user', { url: 'https://gw' }, async () => { throw new Error('gw needs auth in Claude (HTTP 401)'); });
    expect(auth).toMatchObject({ status: 'needs-auth', type: 'http', error: expect.stringContaining('401') });
    const dead = await probeOne('x', 'user', { command: 'nope' }, async () => { throw new Error('x exited (127)'); });
    expect(dead).toMatchObject({ status: 'failed', error: 'x exited (127)' });
    expect(authError('Unauthorized')).toBe(true);
  });
});
