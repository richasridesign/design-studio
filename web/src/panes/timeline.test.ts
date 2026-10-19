import { describe, expect, it } from 'vitest';
import { buildTranscript, recentTurns, replySummary, timelineTurns } from './steps';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (toolUseId: string): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId, text: 'ok', isError: false, at: n });
const say = (text: string, streaming = false): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming, at: n });
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const system = (text: string): ChatEvent => ({ id: `y${at()}`, kind: 'system', text, at: n });
const status = (input: Record<string, unknown>) => tool('mcp__designstudio__set_status', input);
const timeline = (events: ChatEvent[]) => timelineTurns(buildTranscript(events));

describe('timelineTurns', () => {
  it('keeps the prompt, done lines, notes and the latest reply, and hides tool steps', () => {
    const shot = tool('mcp__figma__get_screenshot', { nodeId: '1-2' });
    const task = tool('Task', { description: 'Look' });
    const turns = timeline([user('Add close icons'), say('Looking'), shot, result(shot.id), task, result(task.id), status({ text: 'x', done: 'Close on 6 dialogs', nodes: ['1:2'], important: 'Flow 3 has loose frames' }), tool('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }), say('Done')]);
    expect(turns).toHaveLength(1);
    expect(turns[0].blocks.map((b) => b.kind)).toEqual(['user', 'done', 'note', 'assistant']);
    expect(turns[0].blocks[3]).toMatchObject({ text: 'Done' });
    expect(turns[0].blocks[1]).toMatchObject({ nodes: [['1:2', 1]] });
  });

  it('shows the reply as it streams and keeps a review card', () => {
    const turns = timeline([user('go'), { id: 'rv', kind: 'review', at: at(), runAt: 4 }, say('Half', true)]);
    expect(turns[0].blocks.map((b) => b.kind)).toEqual(['user', 'review', 'assistant']);
    expect(turns[0].blocks[2]).toMatchObject({ streaming: true });
  });

  it('starts a new turn at each prompt or phase, each with its own reply', () => {
    const turns = timeline([user('a'), say('one'), { id: 'ph', kind: 'user', text: 'Sketch', at: at(), phase: 'sketch' }, say('two'), user('b'), say('three')]);
    expect(turns.map((t) => t.blocks.map((b) => b.kind))).toEqual([['user', 'assistant'], ['phase', 'assistant'], ['user', 'assistant']]);
  });

  it('keeps failures and Figma notices but drops routine session notices', () => {
    const turns = timeline([system('Permission mode: plan'), user('go'), system('Session started with opus'), system('Review failed: timeout'), system('Checkpoint saved in Figma version history')]);
    expect(turns).toHaveLength(1);
    expect(turns[0].blocks.map((b) => (b.kind === 'system' ? b.text : b.kind))).toEqual(['user', 'Review failed: timeout', 'Checkpoint saved in Figma version history']);
  });
});

describe('recentTurns', () => {
  it('starts at the third last prompt and counts the prompts before it', () => {
    const turns = timeline([system('Attached Checkout'), user('a'), user('b'), user('c'), user('d'), say('ok')]);
    expect(recentTurns(turns)).toEqual({ from: 2, hidden: 1 });
    expect(turns[2].blocks[0]).toMatchObject({ text: 'b' });
  });

  it('shows everything with three prompts or fewer', () => {
    expect(recentTurns(timeline([user('a'), user('b'), user('c')]))).toEqual({ from: 0, hidden: 0 });
    expect(recentTurns([])).toEqual({ from: 0, hidden: 0 });
  });
});

describe('long run report', () => {
  const report = '## Fixed\n- a\n## Needs your decision\n- b\n## Not checked\n- None';
  it('turns a finished report reply into a report item', () => {
    const items = buildTranscript([{ id: 'a', kind: 'assistant', text: report, streaming: false, at: 1 }]);
    expect(items).toEqual([{ kind: 'report', id: 'a', report: { intro: '', fixed: ['a'], decide: ['b'], unchecked: [] } }]);
  });
  it('keeps a streaming report as a reply', () => {
    expect(buildTranscript([{ id: 'a', kind: 'assistant', text: report, streaming: true, at: 1 }])[0].kind).toBe('assistant');
  });
  it('hides the per-turn long run notes in the timeline', () => {
    const turns = timelineTurns(buildTranscript([
      { id: 'u', kind: 'user', text: 'task', at: 1 },
      { id: 's', kind: 'system', text: 'Long run · turn 2', at: 2 },
      { id: 't', kind: 'system', text: 'Long run stopped: time reached · 3 turns', at: 3 },
    ]));
    expect(turns[0].blocks.map((b) => b.id)).toEqual(['u', 't']);
  });
});

describe('replySummary', () => {
  it('keeps the first sentence and says there is more', () => {
    expect(replySummary('Flow 2 is done: 3 dialogs have a close icon. Want me to carry on with Flows 3 to 8?')).toEqual({ text: 'Flow 2 is done: 3 dialogs have a close icon.', more: true });
  });
  it('shows a one sentence reply whole, with nothing more', () => {
    expect(replySummary('Done.')).toEqual({ text: 'Done.', more: false });
    expect(replySummary('Done')).toEqual({ text: 'Done', more: false });
  });
  it('reads a heading or a list item as plain text', () => {
    expect(replySummary('## Plan: close icon on every dialog\n- **Screens:** 14 dialogs')).toEqual({ text: 'Plan: close icon on every dialog', more: true });
    expect(replySummary('- **A:** set both cards to *Fill*\n- B: fixed height').text).toBe('A: set both cards to Fill');
  });
  it('turns links into words and names Figma frames', () => {
    const frame = (url: string) => (url.includes('node-id=210-31') ? 'Connect app dialog' : null);
    expect(replySummary('See [the guide](https://example.com/a) and https://www.figma.com/design/K/F?node-id=210-31.', frame).text).toBe('See the guide and Connect app dialog.');
    expect(replySummary('Read https://www.example.com/long/path today.').text).toBe('Read example.com today.');
  });
  it('skips code blocks and keeps inline code as text', () => {
    expect(replySummary('```ts\nconst a = 1;\n```\nRun `npm test` first. Then push.')).toEqual({ text: 'Run npm test first.', more: true });
    expect(replySummary('```\nonly code\n```')).toEqual({ text: '', more: true });
  });
  it('does not stop at e.g. or a decimal', () => {
    expect(replySummary('Use a token, e.g. text/secondary, at 1.5 weight. Then check.').text).toBe('Use a token, e.g. text/secondary, at 1.5 weight.');
  });
  it('cuts a long sentence at a word, about 140 characters', () => {
    const s = replySummary(`${'word '.repeat(60)}end.`).text;
    expect(s.length).toBeLessThanOrEqual(140);
    expect(s.endsWith('word…')).toBe(true);
  });
  it('reads a reply that is still streaming, with open emphasis', () => {
    expect(replySummary('Checking the **Dialog set and')).toEqual({ text: 'Checking the Dialog set and', more: false });
  });
  it('keeps snake_case names and is empty for an empty reply', () => {
    expect(replySummary('Called set_status twice.').text).toBe('Called set_status twice.');
    expect(replySummary('  \n ')).toEqual({ text: '', more: false });
  });
});
