import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from './session.js';
import { CONTINUE_TEXT, type LongRun } from '../../shared/longRun.js';

vi.mock('./settings.js', async (orig) => ({ ...(await orig<typeof import('./settings.js')>()), settings: vi.fn(async () => ({ autoCheck: false, askBeforeEdit: false })) }));

const REPORT = '## Fixed\n- a\n## Needs your decision\n- b\n## Not checked\n- None';

function session(run: Partial<LongRun> = {}) {
  const s = new AgentSession('/tmp/project', { key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' });
  const raw = s as unknown as { handle: (m: unknown) => void; enqueue: (t: string) => void; turns: number };
  const sent: string[] = [];
  raw.enqueue = vi.fn((t: string) => { sent.push(t); raw.turns++; });
  s.state.session.longRun = { until: Date.now() + 3600_000, cap: 90, startedAt: Date.now(), turns: 1, state: 'running', ...run };
  raw.turns = 1;
  const end = (result = 'working', isError = false) => raw.handle({ type: 'result', subtype: isError ? 'error_during_execution' : 'success', uuid: crypto.randomUUID(), result, total_cost_usd: 0, is_error: isError });
  return { s, sent, end };
}

describe('long run loop', () => {
  it('sends one continue per finished turn and counts turns', () => {
    const { s, sent, end } = session();
    end();
    expect(sent).toEqual([CONTINUE_TEXT]);
    expect(s.state.session.longRun).toMatchObject({ state: 'running', turns: 2 });
    expect(s.state.session.running).toBe(true);
    end();
    expect(sent).toHaveLength(2);
  });

  it('is done when the reply holds the report', () => {
    const { s, sent, end } = session();
    end(REPORT);
    expect(sent).toEqual([]);
    expect(s.state.session.longRun).toMatchObject({ state: 'done', reason: 'reported' });
    expect(s.state.session.running).toBe(false);
  });

  it('is done when an earlier text block held the report and the turn ends with a short line', () => {
    const { s, sent, end } = session();
    (s as unknown as { handle: (m: unknown) => void }).handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: REPORT }] } });
    end('Report above.');
    expect(sent).toEqual([]);
    expect(s.state.session.longRun).toMatchObject({ state: 'done' });
  });

  it('denies questions during a long run so the run does not wait for you', async () => {
    const { s } = session();
    const tool = (s as unknown as { longRunTool: (n: string) => Promise<{ behavior: string }> | null }).longRunTool.bind(s);
    expect(await tool('AskUserQuestion')).toMatchObject({ behavior: 'deny' });
    expect(tool('Bash')).toBeNull();
    s.state.session.longRun = null;
    expect(tool('AskUserQuestion')).toBeNull();
  });

  it('asks for the report once when time is up, then stops', () => {
    const { s, sent, end } = session({ until: Date.now() - 1 });
    end();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/long run report/);
    expect(s.state.session.longRun).toMatchObject({ state: 'reporting', reason: 'time' });
    end('no report here');
    expect(sent).toHaveLength(1);
    expect(s.state.session.longRun).toMatchObject({ state: 'stopped', reason: 'time' });
  });

  it('stops after two error turns in a row', () => {
    const { s, sent, end } = session();
    end('', true);
    expect(sent).toHaveLength(1);
    end('', true);
    expect(sent).toHaveLength(1);
    expect(s.state.session.longRun).toMatchObject({ state: 'stopped', reason: 'errors' });
  });

  it('stops when the plan limit rejects', () => {
    const { s, sent, end } = session();
    (s as unknown as { handle: (m: unknown) => void }).handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', utilization: 1 } });
    end();
    expect(sent).toEqual([]);
    expect(s.state.session.longRun).toMatchObject({ state: 'stopped', reason: 'rejected' });
  });

  it('stops when you press Stop', async () => {
    const { s, sent, end } = session();
    await s.stopLongRun();
    end();
    expect(sent).toEqual([]);
    expect(s.state.session.longRun).toMatchObject({ state: 'stopped', reason: 'user' });
    s.clearLongRun();
    expect(s.state.session.longRun).toBeNull();
  });
});
