import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { followFigma, followState, forgetView, pauseFollow, resumeFollow, sendFollowState, useChromeFollow } from './followRun.js';
import { openFigmaPlugin } from './figmaPlugin.js';
import type { FollowResult } from './follow.js';

// A plugin window as the server sees it: a socket that answers each follow with `answer`, or stays silent.
function fakePlugin(hello: { fileKey: string | null; fileName: string }, answer: ((m: any) => FollowResult | null) | null) {
  const ws = Object.assign(new EventEmitter(), { readyState: 1, sent: [] as any[], send(data: string) {
    const m = JSON.parse(data);
    ws.sent.push(m);
    const r = m.t === 'follow' && answer ? answer(m) : null;
    if (r) queueMicrotask(() => ws.emit('message', JSON.stringify({ t: 'result', id: m.id, result: r })));
  } });
  openFigmaPlugin(ws as any, { moved: pauseFollow, changed: () => { forgetView(); sendFollowState(); } });
  ws.emit('message', JSON.stringify({ t: 'hello', ...hello, pageId: '0:1' }));
  return ws;
}
const shown = (m: any): FollowResult => ({ status: 'shown', view: { page: '0:1', targets: m.ids[0], cx: 1, cy: 2, zoom: 1 } });

const cdp = vi.fn(async (): Promise<FollowResult | string> => ({ status: 'shown', view: { page: '0:1', targets: 'x', cx: 0, cy: 0, zoom: 1 } }));
useChromeFollow(cdp, () => {});

describe('follow transport', () => {
  it('uses the plugin running in the chat file, and Chrome when none does', async () => {
    cdp.mockClear();
    await followFigma('KeyAAAAAAAAA', ['1:2']);
    expect(cdp).toHaveBeenCalledTimes(1);
    const ws = fakePlugin({ fileKey: 'KeyAAAAAAAAA', fileName: 'Flows' }, shown);
    await followFigma('KeyAAAAAAAAA', ['1:3']);
    expect(cdp).toHaveBeenCalledTimes(1);
    expect(ws.sent.at(-1)).toMatchObject({ t: 'follow', ids: ['1:3'], last: null, start: false });
    // The view the plugin left is what the next follow compares against.
    await followFigma('KeyAAAAAAAAA', ['1:4'], true);
    expect(ws.sent.at(-1)).toMatchObject({ ids: ['1:4'], start: true, last: { targets: '1:3' } });
    // A plugin in another file is not used.
    await followFigma('KeyBBBBBBBBB', ['1:5']);
    expect(cdp).toHaveBeenCalledTimes(2);
    ws.readyState = 3;
    ws.emit('close');
    await followFigma('KeyAAAAAAAAA', ['1:6']);
    expect(cdp).toHaveBeenCalledTimes(3);
  });

  it('finds the plugin by file name when Figma gives it no key, and pauses that file when she moves', async () => {
    cdp.mockClear();
    const ws = fakePlugin({ fileKey: null, fileName: 'Checkout flows' }, shown);
    await followFigma('KeyCCCCCCCCC', ['2:1'], false, ' checkout Flows');
    expect(cdp).not.toHaveBeenCalled();
    expect(followState().plugins).toContainEqual({ key: 'KeyCCCCCCCCC', name: 'Checkout flows', following: true });
    ws.emit('message', JSON.stringify({ t: 'moved' }));
    expect(followState().paused).toContain('KeyCCCCCCCCC');
    const before = ws.sent.length;
    await followFigma('KeyCCCCCCCCC', ['2:2'], false, 'Checkout flows');
    expect(ws.sent.length).toBe(before);
    // Resuming tells the plugin to forget its view, then jumps to where Claude is now.
    resumeFollow('KeyCCCCCCCCC');
    await vi.waitFor(() => expect(ws.sent.at(-1)).toMatchObject({ t: 'follow', ids: ['2:2'], last: null }));
    expect(ws.sent.at(-2)).toEqual({ t: 'forget' });
    expect(followState().paused).not.toContain('KeyCCCCCCCCC');
    ws.emit('close');
  });

  it('counts a plugin that does not answer as failed, not as her move', async () => {
    vi.useFakeTimers();
    try {
      cdp.mockClear();
      const ws = fakePlugin({ fileKey: 'KeyDDDDDDDDD', fileName: 'Silent' }, null);
      const run = followFigma('KeyDDDDDDDDD', ['3:1']);
      await vi.advanceTimersByTimeAsync(8000);
      await run;
      expect(followState().paused).not.toContain('KeyDDDDDDDDD');
      expect(cdp).not.toHaveBeenCalled();
      ws.emit('close');
    } finally {
      vi.useRealTimers();
    }
  });
});
