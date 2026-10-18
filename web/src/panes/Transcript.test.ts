import { describe, expect, it } from 'vitest';
import { buildTranscript, duration, groupTurns, stepLabel } from './steps';
import { welcomeChips } from './Transcript';
import { editCount, replyLine, sumEdits } from '../../../shared/edits';
import type { ChatEvent, LiveChat } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n });
const result = (toolUseId: string, text = 'ok', isError = false): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId, text, isError, at: n });
const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const edit = (file: string, oldText: string, newText: string) => tool('Edit', { file_path: file, old_string: oldText, new_string: newText });
const cwd = '/w/app';

describe('stepLabel', () => {
  it('names the verb and the object, with paths relative to the project', () => {
    expect(stepLabel('Read', { file_path: '/w/app/src/a.ts' }, cwd)).toEqual({ verb: 'Read', object: 'src/a.ts' });
    expect(stepLabel('Grep', { pattern: 'foo', path: '/w/app/src' }, cwd)).toEqual({ verb: 'Searched', object: '"foo" in src' });
    expect(stepLabel('Grep', { pattern: 'foo', path: '/w/app' }, cwd).object).toBe('"foo" in the project');
    expect(stepLabel('Glob', { pattern: '**/*.ts', path: '/w/app/src' }, cwd).object).toBe('src/**/*.ts');
    expect(stepLabel('LS', { path: '/w/app/src' }, cwd)).toEqual({ verb: 'Listed', object: 'src/' });
    expect(stepLabel('Bash', { command: 'npm test\necho done' }, cwd)).toEqual({ verb: 'Ran', object: 'npm test', mono: true });
    expect(stepLabel('WebFetch', { url: 'https://example.com/' }, cwd)).toEqual({ verb: 'Fetched', object: 'example.com' });
    expect(stepLabel('Write', { file_path: '/elsewhere/x.md' }, cwd)).toEqual({ verb: 'Wrote', object: '/elsewhere/x.md' });
  });

  it('names MCP tools by tool and server and falls back to the tool name', () => {
    expect(stepLabel('mcp__playwright__browser_click', {}, cwd)).toEqual({ verb: 'Called', object: 'browser_click (playwright)' });
    expect(stepLabel('Mystery', {}, cwd)).toEqual({ verb: 'Used', object: 'Mystery' });
  });

  it('names Figma calls and described commands in plain words', () => {
    expect(stepLabel('mcp__plugin_figma_figma__get_screenshot', { nodeId: '12-34' }, cwd)).toEqual({ verb: 'Took', object: 'a screenshot of frame 12:34' });
    expect(stepLabel('mcp__figma__use_figma', { description: 'Add hover states' }, cwd)).toEqual({ verb: 'Worked in', object: 'Figma: Add hover states' });
    expect(stepLabel('mcp__figma__search_design_system', { query: 'button' }, cwd).object).toBe('the design system for "button"');
    expect(stepLabel('mcp__figma__brand_new_tool', {}, cwd)).toEqual({ verb: 'Called', object: 'brand_new_tool (figma)' });
    expect(stepLabel('Bash', { command: 'npm i', description: 'Install packages' }, cwd)).toEqual({ verb: 'Ran', object: 'Install packages' });
  });
});

describe('duration', () => {
  it('rounds to seconds, minutes or hours and hides sub-second steps', () => {
    expect(duration(400)).toBe('');
    expect(duration(6400)).toBe('6s');
    expect(duration(125_000)).toBe('2m');
    expect(duration(7_200_000)).toBe('2h');
  });
});

describe('editCount', () => {
  it('counts the lines of old and new text, or of the written content', () => {
    expect(editCount('Edit', { old_string: 'a\nb', new_string: 'c' })).toEqual({ add: 1, del: 2 });
    expect(editCount('Write', { content: 'a\nb\nc' })).toEqual({ add: 3, del: 0 });
    expect(editCount('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: '', new_string: 'd' }] })).toEqual({ add: 3, del: 1 });
    expect(editCount('Read', { file_path: 'x' })).toBeNull();
  });
});

describe('buildTranscript', () => {
  it('merges consecutive edits of the same file and sums their counts', () => {
    const e1 = edit('/w/app/a.ts', 'x', 'y\nz');
    const e2 = edit('/w/app/a.ts', '', 'w');
    const items = buildTranscript([user('go'), e1, result(e1.id), e2, result(e2.id), say('Done')]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'file', 'assistant']);
    expect(items[1]).toMatchObject({ kind: 'file', path: '/w/app/a.ts', count: { add: 3, del: 1 } });
  });

  it('keeps edits apart when another step or file sits between them', () => {
    const items = buildTranscript([edit('/w/app/a.ts', 'x', 'y'), tool('Read', { file_path: '/w/app/b.ts' }), edit('/w/app/a.ts', 'x', 'y'), edit('/w/app/b.ts', '', 'q')]);
    expect(items.map((i) => i.kind)).toEqual(['file', 'step', 'file', 'file']);
  });

  it('shows a failed edit on its own card with the first line of the error', () => {
    const ok = edit('/w/app/a.ts', 'x', 'y');
    const bad = edit('/w/app/a.ts', 'x', 'y');
    const items = buildTranscript([ok, result(ok.id), bad, result(bad.id, 'String not found\nmore', true)]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'file', error: 'String not found', count: { add: 0, del: 0 } });
  });

  it('turns sub-agent calls into agent rows, hides the status tool and skips empty replies', () => {
    const task = tool('Task', { description: 'Health check', subagent_type: 'Explore' });
    const items = buildTranscript([tool('mcp__designstudio__set_status', { text: 'x' }), task, say('  '), result(task.id, 'report')]);
    expect(items.map((i) => i.kind)).toEqual(['agent']);
    expect(items[0]).toMatchObject({ kind: 'agent', result: { text: 'report' } });
  });
});

describe('set_status items', () => {
  it('turns done and important into rows and numbers node revisions', () => {
    const status = (input: Record<string, unknown>) => tool('mcp__designstudio__set_status', input);
    const items = buildTranscript([status({ text: 'a', done: 'Header built', nodes: ['1:2'] }), status({ text: 'b', done: ' ', important: ' ' }), status({ text: 'c', done: 'Header fixed', nodes: ['1:2'], important: 'Token missing' })]);
    expect(items.map((i) => i.kind)).toEqual(['done', 'done', 'note']);
    expect(items[0]).toMatchObject({ text: 'Header built', nodes: [['1:2', 1]] });
    expect(items[1]).toMatchObject({ nodes: [['1:2', 2]] });
  });
});

describe('review events', () => {
  it('maps to a review item that stays outside the steps group', () => {
    const r = tool('Read', { file_path: '/w/a.ts' });
    const items = buildTranscript([user('go'), r, result(r.id), { id: 'rv', kind: 'review', at: 5, runAt: 4 }, say('Done')]);
    expect(items.find((i) => i.kind === 'review')).toEqual({ kind: 'review', id: 'rv', runAt: 4 });
    const blocks = groupTurns(items)[0].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'review', 'steps', 'assistant']);
  });
});

describe('groupTurns', () => {
  it('puts the tools and earlier replies of a turn in one group before the last reply', () => {
    const r = tool('Read', { file_path: '/w/app/a.ts' });
    const e = edit('/w/app/a.ts', 'x', 'y');
    const turns = groupTurns(buildTranscript([user('go'), say('Looking'), r, result(r.id), e, result(e.id), say('Done')]));
    expect(turns).toHaveLength(1);
    expect(turns[0].blocks.map((b) => b.kind)).toEqual(['user', 'steps', 'assistant']);
    const group = turns[0].blocks[1];
    expect(group).toMatchObject({ kind: 'steps', count: 2 });
    expect(group.kind === 'steps' && group.items.map((i) => i.kind)).toEqual(['assistant', 'step', 'file']);
  });

  it('keeps Fable rows, done rows and a reply that precedes the tools outside the group', () => {
    const fable = tool('Agent', { description: 'Ask', subagent_type: 'big-bro' });
    const other = tool('Task', { description: 'Look', subagent_type: 'Explore' });
    const status = tool('mcp__designstudio__set_status', { text: 'x', done: 'Part one' });
    const turns = groupTurns(buildTranscript([user('go'), say('Plan'), fable, status, other]));
    expect(turns[0].blocks.map((b) => b.kind)).toEqual(['user', 'assistant', 'agent', 'done', 'steps']);
  });

  it('starts a new turn at each prompt and leaves tool-free turns ungrouped', () => {
    const r = tool('Read', { file_path: '/w/app/a.ts' });
    const turns = groupTurns(buildTranscript([user('a'), say('hi'), user('b'), r, say('ok')]));
    expect(turns.map((t) => t.blocks.map((b) => b.kind))).toEqual([['user', 'assistant'], ['user', 'steps', 'assistant']]);
  });

  it('sums the time between the first and last step', () => {
    const a = tool('Read', { file_path: 'x' });
    const ra = result(a.id);
    ra.at = a.at + 5000;
    const group = groupTurns(buildTranscript([user('go'), a, ra]))[0].blocks[1];
    expect(group).toMatchObject({ kind: 'steps', ms: 5000 });
  });
});

describe('sumEdits and replyLine', () => {
  it('sums successful edits across the chat and skips failed ones', () => {
    const bad = edit('/w/app/c.ts', 'a\nb\nc', '');
    const events = [edit('/w/app/a.ts', 'x', 'y\nz'), tool('Write', { file_path: '/w/app/b.ts', content: 'one\ntwo' }), bad, result(bad.id, 'nope', true)];
    expect(sumEdits(events)).toEqual({ add: 4, del: 1 });
    expect(sumEdits([user('go'), tool('Read', {})])).toBeUndefined();
  });

  it('takes the first line of the last reply without markdown markers, trimmed to 60 chars', () => {
    expect(replyLine([say('## Done\n\nAll good'), user('x'), say('')])).toBe('Done');
    expect(replyLine([say('**Bold** start')])).toBe('Bold start');
    expect(replyLine([say('a'.repeat(80))])).toHaveLength(60);
    expect(replyLine([user('x')])).toBeUndefined();
  });
});

describe('welcomeChips', () => {
  it('offers her four starts and names the attached file', () => {
    const chips = welcomeChips('Checkout');
    expect(chips.map((c) => c.label)).toEqual(['Fix a frame: paste its link and a note', 'Plan a new flow', 'Fix something across all flows', 'Review only, no changes']);
    expect(chips.some((c) => c.attach)).toBe(false);
    expect(chips[0].text).toBeUndefined();
    expect(chips[3].text).toContain('Checkout');
  });

  it('leads with an attach chip when no file is attached', () => {
    const chips = welcomeChips(null);
    expect(chips).toHaveLength(4);
    expect(chips[0].attach).toBe(true);
  });
});
