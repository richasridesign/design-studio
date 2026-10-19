import { describe, expect, it, vi } from 'vitest';
import { isLocked } from './figmaLock.js';
import { AgentSession } from './session.js';
import { contextFrom, historyFrom } from './transcript.js';

// Never add test spend to the real daily total.
vi.mock('./spend.js', async (orig) => ({ ...(await orig<typeof import('./spend.js')>()), addDaily: vi.fn(async () => {}) }));

function fakeSession() {
  const s = new AgentSession('/tmp/project', null);
  const interrupt = vi.fn(async () => {});
  Object.assign(s, { q: { interrupt } });
  const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
  const result = (uuid: string, subtype = 'success') => handle({ type: 'result', subtype, uuid, result: 'done', total_cost_usd: 0, is_error: subtype !== 'success' });
  return { s, interrupt, result };
}

describe('AgentSession modes', () => {
  const spy = (s: AgentSession) => {
    const priv = s as unknown as { startFlow: (t: string, k: string) => Promise<void>; command: (c: string, a: string, r: string) => Promise<void> };
    const startFlow = vi.spyOn(priv, 'startFlow').mockResolvedValue();
    const command = vi.spyOn(priv, 'command').mockResolvedValue();
    return { startFlow, command };
  };

  it('defaults to chat and a plain prompt does not start a flow', async () => {
    const { s } = fakeSession();
    const { startFlow, command } = spy(s);
    expect(s.state.session.flow.mode).toBe('chat');
    await s.prompt('make a card');
    expect(startFlow).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: 'make a card' });
  });

  it('reads a saved Design or Review mode as Chat, so typed text never starts a run', async () => {
    const { s } = fakeSession();
    const { startFlow, command } = spy(s);
    s.updateFlow({ mode: 'design' });
    expect(s.state.session.flow.mode).toBe('chat');
    s.state.session.flow.mode = 'review';
    await s.prompt('check spacing 1:2');
    expect(startFlow).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it('ignores unknown modes', () => {
    const { s } = fakeSession();
    s.updateFlow({ mode: 'bogus' as never });
    expect(s.state.session.flow.mode).toBe('chat');
  });
});

describe('AgentSession setFigma', () => {
  const file = { key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' };

  it('updates the session, posts a system line and adds file context to the next turn', async () => {
    const { s } = fakeSession();
    const seen: string[] = [];
    s.onMessage((m) => m.type === 'session' && seen.push(m.session.figma?.key ?? ''));
    s.setFigma(file);
    expect(s.figmaFile).toEqual(file);
    expect(s.state.session.figma).toEqual(file);
    expect(seen).toContain('AbC123');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Attached Checkout' });
    const queue = s as unknown as { inputQueue: Array<{ message: { content: unknown } }> };
    Object.assign(s, { start: () => {} });
    await s.prompt('make a card');
    expect(JSON.stringify(queue.inputQueue[0].message.content)).toContain('AbC123');
  });

  it('refuses while a turn is running', async () => {
    const { s } = fakeSession();
    Object.assign(s, { start: () => {} });
    await s.prompt('go');
    s.setFigma(file);
    expect(s.figmaFile).toBeNull();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system' });
    expect((s.state.events.at(-1) as { text: string }).text).toMatch(/Wait/);
  });
});

describe('AgentSession design run without a file', () => {
  const file = { key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' };
  const toDesign = (s: AgentSession) => (s as unknown as { toDesign: () => Promise<void> }).toDesign();

  it('waits in the file phase and resumes when a file is attached', async () => {
    const { s } = fakeSession();
    const next = vi.spyOn(s as unknown as { toDesign: () => Promise<void> }, 'toDesign');
    await toDesign(s);
    expect(s.state.session.flow.phase).toBe('file');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Attach a Figma file to continue the design run' });
    next.mockResolvedValue();
    s.setFigma(file);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('does not build a profile she removed on purpose', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ds-off-'));
    await writeFile(path.join(dir, 'design-system.off'), 'Removed\n');
    const s = new AgentSession(dir, file);
    const runStep = vi.spyOn(s as unknown as { runStep: (o: { phase: string }) => Promise<void> }, 'runStep').mockResolvedValue();
    await toDesign(s);
    expect(s.state.events.some((e) => e.kind === 'user' && e.text.startsWith('Design system'))).toBe(false);
    expect(runStep).toHaveBeenCalledWith(expect.objectContaining({ phase: 'design' }));
  });

  it('ends as stopped on interrupt', async () => {
    const { s } = fakeSession();
    Object.assign(s, { setModel: async () => {}, setPermissionMode: async () => {} });
    await toDesign(s);
    await s.interrupt();
    expect(s.state.session.flow.phase).toBe('stopped');
  });
});

describe('AgentSession turns', () => {
  it('stops running when the only turn ends', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('hi');
    expect(s.state.session.running).toBe(true);
    result('r1');
    expect(s.state.session.running).toBe(false);
  });

  it('steer interrupts a running turn and stays running for the steered prompt', async () => {
    const { s, interrupt, result } = fakeSession();
    s.sendPrompt('long task');
    await s.steer('change of plan');
    expect(interrupt).toHaveBeenCalledOnce();
    result('interrupted', 'error_during_execution');
    expect(s.state.session.running).toBe(true);
    result('r2');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['long task', 'change of plan']);
  });

  it('steer shows the message before the interrupt finishes', async () => {
    const { s, interrupt } = fakeSession();
    let finish = () => {};
    interrupt.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    s.sendPrompt('long task');
    const done = s.steer('change of plan', 'm1');
    expect(s.state.events.at(-1)).toMatchObject({ id: 'm1', kind: 'user', stopping: true });
    finish();
    await done;
    expect(s.state.events.find((e) => e.id === 'm1')).toMatchObject({ stopping: false });
  });

  it('interrupt marks stopping until the turn ends', async () => {
    const { s, interrupt, result } = fakeSession();
    s.sendPrompt('task');
    Object.assign(s, { inputQueue: [] });
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(s.state.session.stopping).toBe(true);
    result('r1', 'error_during_execution');
    expect(s.state.session).toMatchObject({ running: false, stopping: false });
  });

  it('does not auto-compact after a stop', async () => {
    const { s, result } = fakeSession();
    s.sendPrompt('big task');
    Object.assign(s, { inputQueue: [] });
    s.state.session.context = 210_000;
    await s.interrupt();
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: 'big task' });
  });

  it('interrupt drops queued prompts and is a no-op when idle', async () => {
    const { s, interrupt } = fakeSession();
    await s.interrupt();
    expect(interrupt).not.toHaveBeenCalled();
    s.sendPrompt('queued');
    await s.interrupt();
    expect(s.state.session.running).toBe(false);
  });

  it('steer only sends when idle', async () => {
    const { s, interrupt } = fakeSession();
    await s.steer('next thing');
    expect(interrupt).not.toHaveBeenCalled();
    expect(s.state.session.running).toBe(true);
  });

  it('never counts below zero turns', () => {
    const { s, result } = fakeSession();
    result('stray');
    s.sendPrompt('hi');
    expect(s.state.session.running).toBe(true);
  });
});

describe('Figma helpers', () => {
  const pre = (s: AgentSession, input: Record<string, unknown>, id = 't1') =>
    (s as unknown as { beforeFigma: (i: unknown) => Promise<any> }).beforeFigma({ hook_event_name: 'PreToolUse', tool_name: 'mcp__figma__use_figma', tool_input: input, tool_use_id: id });

  it('leaves plain calls alone and never adds a version save, which use_figma does not support', async () => {
    const { s } = fakeSession();
    s.sendPrompt('make it blue');
    expect(await pre(s, { code: 'node.fills = []' })).toEqual({});
    expect(s.state.events.some((e) => e.kind === 'system' && e.text.startsWith('Checkpoint'))).toBe(false);
  });

  it('adds the helpers to calls that use DS, and leaves code that does not parse alone', async () => {
    const { s } = fakeSession();
    s.sendPrompt('x');
    expect(await pre(s, { code: 'DS.node(' })).toEqual({});
    const out = await pre(s, { fileKey: 'k', code: 'const n = await DS.node("1:2"); return DS.check([n.id]);' });
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(out.hookSpecificOutput.updatedInput.fileKey).toBe('k');
    expect(out.hookSpecificOutput.updatedInput.code).toMatch(/^const DS = \(\(\) => \{/);
    expect(out.hookSpecificOutput.updatedInput.code).not.toContain('saveVersionHistoryAsync');
  });

  it('ignores other tools', async () => {
    const { s } = fakeSession();
    s.sendPrompt('x');
    const out = await (s as unknown as { beforeFigma: (i: unknown) => Promise<any> }).beforeFigma({ hook_event_name: 'PreToolUse', tool_name: 'mcp__figma__get_screenshot', tool_input: {} });
    expect(out).toEqual({});
  });

  it('holds the file write lock for an editing call and lets it go after the call, on failure, and on close', async () => {
    const s = new AgentSession('/tmp/project', { key: 'LOCKKEY', name: 'F', url: 'https://www.figma.com/design/LOCKKEY' });
    const edit = { fileKey: 'k', code: 'const n = await figma.getNodeByIdAsync("1:2"); n.name = "Renamed";' };
    await pre(s, edit, 'a');
    expect(isLocked(s.figmaFile!.key)).toBe(true);
    // A read never waits, an edit from this chat on the same file queues behind the first.
    expect(await pre(s, { code: 'return figma.root.children.length' }, 'r')).toEqual({});
    let second = false;
    const p2 = pre(s, edit, 'b').then(() => { second = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(second).toBe(false);
    s.afterTool({ hook_event_name: 'PostToolUse', tool_name: 'mcp__figma__use_figma', tool_input: edit, tool_response: 'ok', tool_use_id: 'a' } as never);
    await p2;
    expect(second).toBe(true);
    expect(isLocked(s.figmaFile!.key)).toBe(true);
    s.close();
    expect(isLocked(s.figmaFile!.key)).toBe(false);
  });
});

describe('changed files', () => {
  const run = (isError: boolean) => {
    const s = new AgentSession('/repo');
    const handle = (m: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(m);
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'e1', name: 'Write', input: { file_path: '/repo/README.md' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: isError ? 'denied' : 'ok', is_error: isError }] } });
    return s.state.recentFiles;
  };

  it('marks a file only after the edit succeeds', () => {
    expect(run(false)).toEqual(['README.md']);
    expect(run(true)).toEqual([]);
  });
});

describe('plan changes', () => {
  const hook = { hook_event_name: 'PostToolUse', session_id: 's', transcript_path: '', cwd: '', tool_name: 'Bash', tool_input: {}, tool_response: '', tool_use_id: 't' } as never;

  it('delivers a plan change at the next tool call without interrupting', () => {
    const { s, interrupt } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['curl /check', 'stop the server']);
    expect(interrupt).not.toHaveBeenCalled();
    const out = s.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(out.hookSpecificOutput?.additionalContext).toContain('1. curl /check\n2. stop the server');
    expect(s.afterTool(hook)).toEqual({});
  });

  it('skips sub-agent tool calls', () => {
    const { s } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    expect(s.afterTool({ ...(hook as object), agent_id: 'sub' } as never)).toEqual({});
  });

  it('sends an undelivered plan change as a prompt when the turn ends', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    result('r1');
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: expect.stringContaining('1. a') });
  });

  it('reminds Claude to report progress after 8 tool calls without set_status', () => {
    const { s } = fakeSession();
    const text = () => (s.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
    expect(text()).toContain('set_status');
    s.afterTool({ ...(hook as object), tool_name: 'mcp__designstudio__set_status' } as never);
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
  });

  it('sends right away when idle', () => {
    const { s } = fakeSession();
    s.changePlan([]);
    expect(s.state.session.running).toBe(true);
  });
});

describe('context tokens', () => {
  it('adds fresh, cached and newly cached input tokens', () => {
    expect(contextFrom({ input_tokens: 10, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 5_000 })).toBe(205_010);
    expect(contextFrom({ input_tokens: 0 })).toBeNull();
    expect(contextFrom(undefined)).toBeNull();
  });
});

describe('history', () => {
  const msg = (type: string, content: unknown, extra: object = {}) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content, ...extra } }) as never;

  it('rebuilds turns, tool calls and the context size', () => {
    const { events, context } = historyFrom([
      msg('user', 'fix the bug'),
      msg('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }], { usage: { input_tokens: 5, cache_read_input_tokens: 1000 } }),
      msg('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      msg('assistant', [{ type: 'text', text: 'Fixed' }]),
      msg('user', '[Request interrupted by user]'),
    ]);
    expect(events.map((e) => e.kind)).toEqual(['user', 'tool_use', 'tool_result', 'assistant', 'system', 'result']);
    expect(events[1]).toMatchObject({ summary: '$ npm test' });
    expect(events.at(-1)).toMatchObject({ text: 'Fixed' });
    expect(context).toBe(1005);
  });
});

describe('compacting', () => {
  it('shows compacting from /compact until the boundary arrives', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
    s.sendPrompt('/compact');
    expect(s.state.session.compacting).toBe(true);
    expect(s.state.status).toBe('Compacting the conversation');
    handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 295_000, post_tokens: 12_000 } });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.session.context).toBe(12_000);
  });

  it('compacts automatically when a turn ends past 200k, once', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('big task');
    s.state.session.context = 210_000;
    result('r1');
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: '/compact' });
    expect(s.state.session.compacting).toBe(true);
    result('r2');
    expect(s.state.session.running).toBe(false);
  });

  it('stops compacting and says why when it fails', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
    s.sendPrompt('/compact');
    handle({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Prompt is too long' });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Compact failed: Prompt is too long' });
  });
});

describe('spend from plugin reads', () => {
  it('counts reads on their own and a review only for its reviewers, so the read is not counted twice', () => {
    const s = new AgentSession('/tmp/project', null);
    const priv = s as unknown as { recordBackground: (p: string, r: unknown) => void; saveSpend: () => void };
    priv.saveSpend = () => {};
    s.recordRead(0.004, 100);
    priv.recordBackground('review', { tokens: 50, costUsd: 0.104, results: [{ costUsd: 0.06 }, { costUsd: 0.04 }] });
    const spend = s.state.session.spend;
    expect(spend.byPhase.read.costUsd).toBeCloseTo(0.004);
    expect(spend.byPhase.review.costUsd).toBeCloseTo(0.1);
    expect(spend.costUsd).toBeCloseTo(0.104);
  });
});
