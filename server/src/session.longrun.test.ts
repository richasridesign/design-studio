import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from './session.js';
import { CONTINUE_TEXT, type LongRun } from '../../shared/longRun.js';
import { keepAwake } from './awake.js';
import { awaitQuestions } from './awaiting.js';

vi.mock('./settings.js', async (orig) => ({ ...(await orig<typeof import('./settings.js')>()), settings: vi.fn(async () => ({ autoCheck: false, askBeforeEdit: false })) }));
// Tests never keep the real Mac awake or write the real Awaiting list.
const wake = vi.fn();
vi.mock('./awake.js', () => ({ keepAwake: vi.fn(() => wake) }));
vi.mock('./awaiting.js', () => ({ awaitQuestions: vi.fn(async () => null) }));

const REPORT = '## Fixed\n- a\n## Needs your decision\n- b\n## Not checked\n- None';
const say = (s: AgentSession, text: string) => (s as unknown as { handle: (m: unknown) => void }).handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const limitEvent = (s: AgentSession, rateLimitType: string, utilization: number, status = 'allowed') =>
  (s as unknown as { handle: (m: unknown) => void }).handle({ type: 'rate_limit_event', rate_limit_info: { status, rateLimitType, utilization } });

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

  it('asks for the report when weekly usage reaches its cap, even after a later 5-hour event', () => {
    const { s, sent, end } = session({ weeklyCap: 70 });
    limitEvent(s, 'seven_day', 0.72);
    limitEvent(s, 'five_hour', 0.2);
    expect(s.state.session.limits).toMatchObject({ seven_day: { used: 0.72 }, five_hour: { used: 0.2 } });
    end();
    expect(sent[0]).toMatch(/Weekly plan usage/);
    expect(s.state.session.longRun).toMatchObject({ state: 'reporting', reason: 'weekly' });
  });

  it('keeps going under both caps', () => {
    const { s, sent, end } = session({ weeklyCap: 70 });
    limitEvent(s, 'seven_day', 0.5);
    limitEvent(s, 'five_hour', 0.5);
    end();
    expect(sent).toEqual([CONTINUE_TEXT]);
  });

  it('shows the round Claude says it is on, within the rounds asked for', () => {
    const { s } = session({ rounds: 3 });
    say(s, 'Round 2 of 3: checking the hover states again.');
    expect(s.state.session.longRun?.round).toBe(2);
    say(s, 'Round 9 of 9');
    expect(s.state.session.longRun?.round).toBe(2);
  });

  it('puts the report questions in Awaiting your decision, each with its node link', async () => {
    vi.mocked(awaitQuestions).mockClear();
    const { s, end } = session();
    say(s, '## Fixed\n- None\n## Needs your decision\n- Move the toast? Left it. https://www.figma.com/design/Zz9/Other?node-id=12-34\n- Rename the tab? Kept it.\n## Not checked\n- None');
    end('Report above.');
    await vi.waitFor(() => expect(awaitQuestions).toHaveBeenCalled());
    expect(vi.mocked(awaitQuestions).mock.calls[0][2]).toEqual([
      { text: expect.stringContaining('Move the toast'), fileKey: 'Zz9', node: '12:34' },
      { text: 'Rename the tab? Kept it.', fileKey: 'AbC123', node: '' },
    ]);
    await vi.waitFor(() => expect(s.state.session.longRun?.awaiting).toBe(2));
  });

  it('keeps the Mac awake while the run works, with the weekly cap and rounds from the start options', async () => {
    const s = new AgentSession('/tmp/project', { key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' });
    const raw = s as unknown as { enqueue: (t: string) => void; handle: (m: unknown) => void; turns: number };
    const sent: string[] = [];
    raw.enqueue = vi.fn((t: string) => { sent.push(t); raw.turns++; });
    limitEvent(s, 'seven_day', 0.1);
    s.setLongRunOptions({ weeklyCap: 50, rounds: 2 });
    const until = Date.now() + 3600_000;
    await s.startLongRun('Review the onboarding flows', until, 80);
    expect(keepAwake).toHaveBeenCalled();
    expect(s.state.session.longRun).toMatchObject({ cap: 80, weeklyCap: 50, rounds: 2, awakeUntil: until });
    expect(sent[0]).toMatch(/up to 2/);
    expect(sent[0]).toMatch(/50% of the weekly limit/);
    expect(sent[0]).toMatch(/cached file map/);
    wake.mockClear();
    await s.stopLongRun();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does not start when weekly usage is already over the cap', async () => {
    const s = new AgentSession('/tmp/project', null);
    limitEvent(s, 'seven_day_opus', 0.8);
    s.setLongRunOptions({ weeklyCap: 70, rounds: 3 });
    await s.startLongRun('Review', Date.now() + 3600_000, 90);
    expect(s.state.session.longRun ?? null).toBeNull();
  });
});
