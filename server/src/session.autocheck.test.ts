import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from './session.js';
import { runReview } from './review.js';
import { settings } from './settings.js';
import { framesContaining } from './figma.js';

const run = { id: 'r1', kind: 'audit', at: 1234, round: 0, preset: 'check', frames: ['1:2'], check: [], results: [], tokens: 0, costUsd: 0 };

vi.mock('./review.js', async (orig) => ({ ...(await orig<typeof import('./review.js')>()), runReview: vi.fn(async () => run) }));
vi.mock('./settings.js', async (orig) => ({ ...(await orig<typeof import('./settings.js')>()), settings: vi.fn(async () => ({ autoCheck: true })) }));
vi.mock('./figma.js', async (orig) => ({ ...(await orig<typeof import('./figma.js')>()), fileOutline: vi.fn(async () => ({ pages: [{ frames: [{ id: '1:2' }, { id: '3:4' }] }] })), framesContaining: vi.fn(async (_k: string, all: string[], ids: string[]) => all.filter((f) => ids.includes(f))) }));

const flush = () => new Promise((r) => setTimeout(r, 10));

function chatTurn(tool: string | null, key = 'AbC123') {
  const s = new AgentSession('/tmp/project', { key, name: 'Checkout', url: `https://www.figma.com/design/${key}` });
  const handle = (m: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(m);
  (s as unknown as { turns: number }).turns = 1;
  if (tool) {
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: tool, input: { code: 'figma.getNodeByIdAsync("3:4")' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } });
  }
  handle({ type: 'result', subtype: 'success', uuid: 'u1', result: 'done', total_cost_usd: 0, is_error: false });
  return s;
}

describe('auto check after chat edits', () => {
  beforeEach(() => {
    vi.mocked(runReview).mockClear();
    vi.mocked(settings).mockResolvedValue({ autoCheck: true } as never);
  });

  it('runs the free check on touched frames and emits a review event', async () => {
    const s = chatTurn('mcp__figma__use_figma');
    await flush();
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ preset: 'check', kind: 'audit', round: 0, frames: ['3:4'] }));
    expect(s.state.events.find((e) => e.kind === 'review')).toMatchObject({ runAt: 1234 });
  });

  it('checks the frame that contains a touched nested id', async () => {
    vi.mocked(framesContaining).mockResolvedValueOnce(['1:2']);
    chatTurn('mcp__figma__use_figma');
    await flush();
    expect(framesContaining).toHaveBeenCalledWith('AbC123', ['1:2', '3:4'], ['3:4']);
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ frames: ['1:2'] }));
  });

  it('does not run when autoCheck is off', async () => {
    vi.mocked(settings).mockResolvedValue({ autoCheck: false } as never);
    chatTurn('mcp__figma__use_figma');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
  });

  it('does not run when no use_figma ran', async () => {
    chatTurn('Bash');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
  });

  it('does not run on the sample file', async () => {
    chatTurn('mcp__figma__use_figma', 'sample');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
  });
});
