import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AgentSession } from './session.js';
import { BRAINSTORM_DENIED, ROUND_MAX, chooseOption, listRounds, parseRound, readMode, saveMode, saveRound } from './brainstorm.js';
import { FIGMA_WRITE_MATCHER } from './lean.js';

const F = 'mcp__plugin_figma_figma__';
const EDIT = "const f = figma.createFrame(); f.name = 'Home';";
const READ = "const n = await figma.getNodeByIdAsync('1:2'); return n.name;";

const sketch = { frame: 'phone', rows: [[{ kind: 'header', label: 'Title' }], [{ kind: 'input', label: 'Email' }, { kind: 'button', label: 'Go' }]] };
const round = (extra: Record<string, unknown> = {}) => ({
  problem: 'People cannot find their connectors',
  assumptions: ['Admins set it up once'],
  options: [
    { title: 'Cards', sketch, goodFor: 'Few apps', watchOut: 'Gets long' },
    { title: 'Table', sketch, goodFor: 'Many apps', watchOut: 'Dense' },
  ],
  flow: [{ label: 'Open' }, { label: 'Pick an app', branches: [{ when: 'Not connected', to: 'Connect' }] }],
  questions: [{ text: 'How many apps?', answers: ['Under 10', 'More'] }],
  ...extra,
});

/** The session's own PreToolUse hook for Figma write tools, as the SDK calls it. */
const hook = (s: AgentSession, tool: string, input: Record<string, unknown>) =>
  (s as unknown as { beforeFigma: (i: unknown) => Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }> })
    .beforeFigma({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: `t-${Math.random()}`, session_id: 's', transcript_path: '', cwd: '' });

describe('brainstorm write lock', () => {
  it('denies Figma writes while brainstorming, allows reads, and building lifts it', async () => {
    const s = new AgentSession(await mkdtemp(path.join(os.tmpdir(), 'bs-')), null);
    s.setBrainstorm(true, true);
    const edit = await hook(s, `${F}use_figma`, { code: EDIT });
    expect(edit.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(edit.hookSpecificOutput?.permissionDecisionReason).toBe(BRAINSTORM_DENIED);
    for (const t of ['generate_figma_design', 'upload_assets', 'send_code_to_figma', 'create_new_file']) expect((await hook(s, `${F}${t}`, {})).hookSpecificOutput?.permissionDecision).toBe('deny');
    // A read-only script runs, and read tools never reach the hook at all (create_session included: reads need it).
    expect((await hook(s, `${F}use_figma`, { code: READ })).hookSpecificOutput?.permissionDecision).toBeUndefined();
    const m = new RegExp(FIGMA_WRITE_MATCHER);
    for (const t of ['get_screenshot', 'get_metadata', 'get_design_context', 'create_session', 'search_design_system']) expect(m.test(`${F}${t}`)).toBe(false);
    for (const t of ['send_code_to_figma', 'create_shader', 'update_generative_plugin', 'weave_run_tool']) expect(m.test(`${F}${t}`)).toBe(true);

    s.setBrainstorm(false, true);
    expect((await hook(s, `${F}use_figma`, { code: EDIT })).hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect((await hook(s, `${F}upload_assets`, {})).hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('keeps the mode per chat across a restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bs-'));
    await saveMode(dir, 'chat-a', true);
    expect(await readMode(dir, 'chat-a')).toBe(true);
    expect(await readMode(dir, 'chat-b')).toBe(false);
    await saveMode(dir, 'chat-a', false);
    expect(await readMode(dir, 'chat-a')).toBe(false);
  });
});

describe('brainstorm_update input', () => {
  it('takes a round with 2 or 3 options and refuses the wrong shape', () => {
    expect(parseRound(round()).ok).toBe(true);
    const one = parseRound(round({ options: [round().options[0]] }));
    expect(one.ok).toBe(false);
    expect(parseRound(round({ options: [...round().options, ...round().options] })).ok).toBe(false);
    expect(parseRound(round({ questions: [{ text: 'Q', answers: ['Only one'] }] })).ok).toBe(false);
    expect(parseRound(round({ options: [{ ...round().options[0], sketch: { rows: [[{ kind: 'carousel' }]] } }, round().options[1]] })).ok).toBe(false);
  });

  it('refuses a round over the size cap', () => {
    const long = (n: number) => 'x'.repeat(n);
    const big = { frame: 'desktop', rows: Array.from({ length: 10 }, () => [1, 2, 3].map(() => ({ kind: 'card', label: long(48) }))) };
    const r = parseRound(round({
      problem: long(200),
      assumptions: Array.from({ length: 6 }, () => long(160)),
      options: [1, 2, 3].map(() => ({ title: long(60), sketch: big, goodFor: long(140), watchOut: long(140) })),
      flow: Array.from({ length: 10 }, () => ({ label: long(60), branches: [{ when: long(60), to: long(60) }, { when: long(60), to: long(60) }] })),
      questions: Array.from({ length: 4 }, () => ({ text: long(200), answers: [long(80), long(80), long(80), long(80)] })),
    }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(String(ROUND_MAX));
  });
});

describe('round files', () => {
  it('saves each round in the chat folder (a flow chat: its iteration), numbered, and never outside it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bs-'));
    const iteration = path.join(root, 'flows', '01-discover', 'iterations', '1.19');
    const s = new AgentSession(iteration, null);
    const post = (input: unknown) => (s as unknown as { postRound: (i: unknown) => Promise<{ text: string; isError?: boolean }> }).postRound(input);

    expect((await post(round())).isError).toBeUndefined();
    expect((await post(round({ problem: 'Second try' }))).isError).toBeUndefined();
    expect((await post(round({ options: [] }))).isError).toBe(true);
    expect((await readdir(path.join(iteration, 'brainstorm'))).sort()).toEqual(['round-1.json', 'round-2.json']);
    expect(await readdir(root)).toEqual(['flows']);
    expect(s.state.brainstorm?.map((r) => r.problem)).toEqual(['People cannot find their connectors', 'Second try']);

    // Another chat in the same iteration keeps its own rounds; numbers stay unique in the folder.
    const other = parseRound(round());
    if (other.ok) await saveRound(iteration, 'other', other.round);
    expect((await listRounds(iteration, s.id)).length).toBe(2);
    expect((await readdir(path.join(iteration, 'brainstorm'))).length).toBe(3);

    // Build this records the option; a round number that is not a plain number, or another chat's round, is refused.
    await chooseOption(iteration, s.id, 2, 1);
    expect(JSON.parse(await readFile(path.join(iteration, 'brainstorm', 'round-2.json'), 'utf8')).chosen.option).toBe(1);
    for (const n of [0, -1, 1.5, Number.NaN]) await expect(chooseOption(iteration, s.id, n, 0)).rejects.toThrow();
    await expect(chooseOption(iteration, s.id, 3, 0)).rejects.toThrow('another chat');
    await expect(chooseOption(iteration, s.id, 1, 5)).rejects.toThrow('No such option');
  });
});
