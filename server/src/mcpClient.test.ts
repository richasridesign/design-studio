import { afterAll, describe, expect, it } from 'vitest';
import { callTool, data, listTools, pidOf, stopAll, text } from './mcpClient.js';

const FAKE = `
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.setEncoding('utf8').on('data', (c) => {
  buf += c;
  const lines = buf.split('\\n');
  buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: 'fake' } } });
    else if (m.method === 'notifications/initialized') process.stderr.write('ready\\n');
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'slow' }, { name: 'die' }, { name: 'fail' }] } });
    else if (m.method === 'tools/call') {
      const { name, arguments: args } = m.params;
      if (name === 'echo') {
        const out = JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ got: args, env: process.env.FAKE_FLAG, pid: process.pid }) }] } }) + '\\n';
        process.stdout.write(out.slice(0, 20));
        setTimeout(() => process.stdout.write(out.slice(20)), 20);
      } else if (name === 'fail') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'nope' }] } });
      else if (name === 'die') { process.stderr.write('fatal: giving up\\n'); process.exit(3); }
    } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method ' + m.method } });
  }
});
`;

const def = { command: process.execPath, args: ['-e', FAKE], env: { FAKE_FLAG: 'on' } };

afterAll(stopAll);

describe('mcpClient', () => {
  it('initializes, lists tools and calls a tool across split frames', async () => {
    const tools = await listTools('fake', def);
    expect(tools.map((t) => t.name)).toEqual(['echo', 'slow', 'die', 'fail']);
    const r = await callTool('fake', def, 'echo', { a: 1 });
    expect(data(r)).toMatchObject({ got: { a: 1 }, env: 'on' });
    expect(text(r)).toContain('"a":1');
  });

  it('turns isError results and JSON-RPC errors into exceptions', async () => {
    await expect(callTool('fake', def, 'fail')).rejects.toThrow('fail: nope');
  });

  it('times out a call that never answers', async () => {
    await expect(callTool('fake', def, 'slow', {}, 200)).rejects.toThrow(/timed out after 200ms/);
  });

  it('reports stderr when the server exits and restarts it on the next call', async () => {
    const pid = pidOf('fake');
    await expect(callTool('fake', def, 'die')).rejects.toThrow(/exited \(3\): .*fatal: giving up/s);
    const r = await callTool('fake', def, 'echo', {});
    expect((data(r) as { pid: number }).pid).not.toBe(pid);
    expect(pidOf('fake')).not.toBe(pid);
  });

  it('fails clearly when the command does not exist', async () => {
    await expect(listTools('missing', { command: '/nonexistent/mcp-server' }, 2000)).rejects.toThrow(/failed to start|exited/);
  });
});
