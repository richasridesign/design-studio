import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from './session.js';
import { withReviews } from './transcript.js';

const run = { id: 'r1', kind: 'audit', at: 1234, round: 0, preset: 'check', frames: ['1:2'], check: [], results: [], tokens: 0, costUsd: 0 };

vi.mock('./review.js', async (orig) => ({ ...(await orig<typeof import('./review.js')>()), runReview: vi.fn(async (i: { onArea?: (a: string, s: string) => void }) => { i.onArea?.('check', 'pass'); i.onArea?.('all', 'running'); return run; }) }));
vi.mock('./figmaCache.js', async (orig) => ({ ...(await orig<typeof import('./figmaCache.js')>()), fileOutline: vi.fn(async () => ({ pages: [{ frames: [{ id: '1:2' }] }] })), refreshOutlineSoon: vi.fn() }));

describe('review events', () => {
  it('a finished audit emits a review event for the saved run', async () => {
    const s = new AgentSession('/tmp/project', null);
    s.setFigma({ key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' });
    await (s as unknown as { command: (c: string, a: string, r: string) => Promise<void> }).command('audit', '', '/audit');
    expect(s.state.events.find((e) => e.kind === 'review')).toMatchObject({ kind: 'review', runAt: 1234 });
  });

  it('tracks reviewer progress in the flow state', () => {
    const s = new AgentSession('/tmp/project', null);
    const onArea = (s as unknown as { onArea: (a: string, st: string) => void }).onArea;
    onArea('check', 'running');
    onArea('all', 'running');
    onArea('check', 'pass');
    expect(s.state.session.flow.reviewers).toEqual([{ area: 'check', state: 'pass' }, { area: 'all', state: 'running' }]);
  });

  it('a review with no areas ticked in the chat covers the profile areas, and her own ticks win', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { runReview } = await import('./review.js');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ds-areas-'));
    await writeFile(path.join(dir, 'design-system.json'), JSON.stringify({ name: 'Lo-fi sketch', areas: ['interaction', 'writing'] }));
    const s = new AgentSession(dir, { key: 'AbC123', name: 'Checkout', url: 'https://www.figma.com/design/AbC123' });
    const review = (s as unknown as { command: (c: string, a: string, r: string) => Promise<void> }).command.bind(s);
    vi.mocked(runReview).mockClear();
    await review('review', 'quick https://www.figma.com/design/AbC123/F?node-id=1-2', '/review');
    expect(vi.mocked(runReview).mock.calls[0][0].areas).toEqual(['interaction', 'writing']);
    expect(s.state.session.flow.areas).toEqual(['interaction', 'writing']);
    s.updateFlow({ areas: ['accessibility'] });
    await review('review', 'quick https://www.figma.com/design/AbC123/F?node-id=1-2', '/review');
    expect(vi.mocked(runReview).mock.calls[1][0].areas).toEqual(['accessibility']);
  });

  it('a starter sets the ticks and removing the profile gives the default back', () => {
    const s = new AgentSession('/tmp/project', null);
    s.useProfileAreas({ areas: ['interaction', 'writing'] });
    expect(s.state.session.flow.areas).toEqual(['interaction', 'writing']);
    s.useProfileAreas(null);
    expect(s.state.session.flow.areas).toEqual(['system', 'interaction', 'visual', 'writing', 'accessibility']);
  });

  it('replays saved runs in time order on history load', () => {
    const events = withReviews([{ id: 'a', kind: 'user', text: 'x', at: 1000 }, { id: 'b', kind: 'user', text: 'y', at: 3000 }], [{ at: 2000 }, { at: 4000 }]);
    expect(events.map((e) => e.at)).toEqual([1000, 2000, 3000, 4000]);
    expect(events[1]).toMatchObject({ kind: 'review', runAt: 2000 });
  });
});
