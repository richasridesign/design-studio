import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, AUTO_CHECK_MAX } from './session.js';
import { runReview } from './review.js';
import { settings } from './settings.js';
import { fileOutline, framesContaining } from './figmaCache.js';
import { buildMap } from './fileMap.js';

const run = { id: 'r1', kind: 'audit', at: 1234, round: 0, preset: 'check', frames: ['1:2'], check: [], results: [], tokens: 0, costUsd: 0 };

vi.mock('./review.js', async (orig) => ({ ...(await orig<typeof import('./review.js')>()), runReview: vi.fn(async () => run) }));
vi.mock('./settings.js', async (orig) => ({ ...(await orig<typeof import('./settings.js')>()), settings: vi.fn(async () => ({ autoCheck: true })) }));
vi.mock('./figmaCache.js', async (orig) => ({ ...(await orig<typeof import('./figmaCache.js')>()), fileOutline: vi.fn(async () => ({ pages: [{ frames: [{ id: '1:2' }, { id: '3:4' }] }] })), framesContaining: vi.fn(async (_d: string, _k: string, ids: string[], screens: string[]) => ids.filter((f) => screens.includes(f))), refreshOutlineSoon: vi.fn() }));

// The map read after an edit: screens 1:2 and 3:4 on the page, a section 5:1 holding screen 5:2.
const map = { key: 'AbC123', name: 'Checkout', readAt: 1, raw: { pages: [['0:1', 'Design', [['F', '1:2', 'Cart', 0, 0, 390, 844], ['F', '3:4', 'Empty', 0, 0, 390, 844], ['S', '5:1', 'LATEST', 0, 0, 3000, 1000, [['F', '5:2', 'Activate', 0, 0, 1440, 900]], 0]], []]], sets: [], comps: [], vars: [], styles: [] } };
vi.mock('./fileMap.js', async (orig) => ({ ...(await orig<typeof import('./fileMap.js')>()), buildMap: vi.fn(async () => map), refreshMapSoon: vi.fn(), ensureMapSoon: vi.fn(async () => {}) }));

const flush = () => new Promise((r) => setTimeout(r, 10));

function chatTurn(tool: string | null, key = 'AbC123', code = 'figma.getNodeByIdAsync("3:4")') {
  const s = new AgentSession('/tmp/project', { key, name: 'Checkout', url: `https://www.figma.com/design/${key}` });
  const handle = (m: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(m);
  (s as unknown as { turns: number }).turns = 1;
  if (tool) {
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: tool, input: { code } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } });
  }
  handle({ type: 'result', subtype: 'success', uuid: 'u1', result: 'done', total_cost_usd: 0, is_error: false });
  return s;
}

describe('auto check after chat edits', () => {
  beforeEach(() => {
    vi.mocked(runReview).mockClear();
    vi.mocked(buildMap).mockClear();
    vi.mocked(framesContaining).mockClear();
    vi.mocked(fileOutline).mockClear();
    vi.mocked(settings).mockResolvedValue({ autoCheck: true } as never);
  });

  it('runs the free check on touched frames and emits a review event', async () => {
    const s = chatTurn('mcp__figma__use_figma');
    await flush();
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ preset: 'check', kind: 'audit', round: 0, frames: ['3:4'], awaiting: false }));
    expect(s.state.events.find((e) => e.kind === 'review')).toMatchObject({ runAt: 1234 });
  });

  it('checks the frame that contains a touched nested id', async () => {
    vi.mocked(framesContaining).mockResolvedValueOnce(['1:2']);
    chatTurn('mcp__figma__use_figma');
    await flush();
    expect(framesContaining).toHaveBeenCalledWith(expect.any(String), 'AbC123', ['3:4'], ['1:2', '3:4', '5:2']);
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ frames: ['1:2'] }));
  });

  it('reads the file once: the check waits for the map read and never reads the outline again', async () => {
    chatTurn('mcp__figma__use_figma');
    await flush();
    expect(buildMap).toHaveBeenCalledTimes(1);
    expect(fileOutline).not.toHaveBeenCalled();
    expect(runReview).toHaveBeenCalledTimes(1);
  });

  it('checks only the touched screen inside a section, not the section', async () => {
    vi.mocked(framesContaining).mockResolvedValueOnce(['5:2']);
    chatTurn('mcp__figma__use_figma', 'AbC123', 'figma.getNodeByIdAsync("5:1"); figma.getNodeByIdAsync("9:9")');
    await flush();
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ frames: ['5:2'] }));
  });

  it('checks at most AUTO_CHECK_MAX screens when a read listed a whole section', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `6:${i + 1}`);
    vi.mocked(framesContaining).mockResolvedValueOnce(many);
    chatTurn('mcp__figma__use_figma', 'AbC123', many.join(' '));
    await flush();
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ frames: many.slice(0, AUTO_CHECK_MAX) }));
  });

  it('checks nothing when the edit touched only a section', async () => {
    vi.mocked(framesContaining).mockResolvedValueOnce([]);
    chatTurn('mcp__figma__use_figma', 'AbC123', 'figma.getNodeByIdAsync("5:1")');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
  });

  it('checks nothing, never the whole file, when no edited frame is known', async () => {
    chatTurn('mcp__figma__use_figma', 'AbC123', 'figma.createFrame()');
    await flush();
    expect(framesContaining).not.toHaveBeenCalled();
    expect(runReview).not.toHaveBeenCalled();
  });

  it('checks nothing when the plugin read fails and no touched id is a known screen', async () => {
    vi.mocked(framesContaining).mockRejectedValueOnce(new Error('plugin off'));
    chatTurn('mcp__figma__use_figma', 'AbC123', 'figma.getNodeByIdAsync("9:9")');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
  });

  it('does not run when autoCheck is off', async () => {
    vi.mocked(settings).mockResolvedValue({ autoCheck: false } as never);
    chatTurn('mcp__figma__use_figma');
    await flush();
    expect(runReview).not.toHaveBeenCalled();
    // One map read refreshes the outline too.
    expect(buildMap).toHaveBeenCalledWith('/tmp/project', 'AbC123');
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
