import { describe, expect, it, vi } from 'vitest';
import { agentOptions, CHANGE_INPUT, historyGuard, historyPathFor, instructions } from './options.js';

const figma = { key: 'abc', name: 'Shop', url: 'https://www.figma.com/design/abc/Shop' };

describe('instructions', () => {
  it('points Claude at the file map and the helpers when a file is attached', () => {
    const text = instructions(figma as never, '', '/chat/.figma-cache/abc/map.md');
    expect(text).toContain('File map: /chat/.figma-cache/abc/map.md');
    expect(text).toContain('DS.check');
    expect(text).toContain('Do not call figma.saveVersionHistoryAsync');
    expect(text).not.toMatch(/save a version with use_figma/i);
  });

  it('tells Claude where the findings closed by hand are, so her fix request can stay in plain words', () => {
    expect(instructions(null)).toContain('closed by hand on the Review tab (fixed, won\'t fix or parked) are listed in triage.json');
    expect(instructions(null)).toContain('Leave the findings that wait for the designer\'s decision');
  });

  it('asks for changes in set_status and decisions on the stickies, and keeps both out of important', () => {
    const text = instructions(null);
    expect(text).toContain('When you finish a change in Figma, call set_status changes: what changed, on which screens, why.');
    expect(text).toContain('Decisions go on the Decision stickies under each screen, never in set_status.');
    expect(text).not.toContain('set_status decisions');
    expect(text).toContain('important only for a risk, blocker or surprise');
  });

  it('points a flow chat at its history file, read only', () => {
    expect(historyPathFor('/p/flows/03-connectors/iterations/1.19')).toBe('/p/flows/03-connectors/history.md');
    expect(historyPathFor('/p')).toBeNull();
    expect(historyPathFor('/p/iterations/1.19')).toBeNull();
    const text = instructions(figma as never, '', null, 'This chat works on Flow 3.', '/p/flows/03-connectors/history.md');
    expect(text).toContain("This flow's history is at /p/flows/03-connectors/history.md. Read it before changing a screen that was decided before. Do not edit it: Design Studio writes it.");
    expect(instructions(figma as never, '', null, null, '/p/flows/03-connectors/history.md')).not.toContain('history is at');
  });

  it('leaves the Figma speed notes out when no file is attached', () => {
    expect(instructions(null)).not.toContain('DS.');
  });

  it('swaps the Design Studio page rule for the flow and iteration block on an adopted file', () => {
    expect(instructions(figma as never)).toContain('put new work on a page named "Design Studio"');
    const text = instructions(figma as never, '', null, 'This chat works on Flow 2 · Connectors in iteration 1.19 (working).');
    expect(text).toContain('Projects, flows and iterations:\nThis chat works on Flow 2 · Connectors');
    expect(text).not.toContain('page named "Design Studio"');
  });
});

describe('agentOptions', () => {
  it('hooks subagent starts only when asked, and allows the map refresh tool', () => {
    const base = { cwd: '/c', figma: null, rules: '', figmaServers: {}, strictMcp: false, onStatus: vi.fn(), canUseTool: vi.fn(), beforeFigma: vi.fn(), afterTool: vi.fn() };
    expect(agentOptions(base as never).hooks!.PreToolUse!.map((m) => m.matcher)).toEqual(['mcp__.*use_figma', '^(Write|Edit|MultiEdit|NotebookEdit)$']);
    const o = agentOptions({ ...base, beforeAgent: vi.fn() } as never);
    expect(o.hooks!.PreToolUse!.map((m) => m.matcher)).toEqual(['mcp__.*use_figma', '^(Agent|Task)$', '^(Write|Edit|MultiEdit|NotebookEdit)$']);
    expect(o.hooks!.PostToolUse!.map((m) => m.matcher)).toEqual([undefined, 'mcp__.*use_figma']);
    expect(o.allowedTools).toContain('mcp__designstudio__refresh_file_map');
  });
});

describe('set_status changes', () => {
  it('takes what, with why and screens optional', () => {
    expect(CHANGE_INPUT.parse({ what: 'Readiness column added' })).toEqual({ what: 'Readiness column added' });
    expect(CHANGE_INPUT.safeParse({ what: 'A', why: 'B', screens: ['Connectors', '12:34'] }).success).toBe(true);
    expect(CHANGE_INPUT.safeParse({ why: 'B' }).success).toBe(false);
  });
});

describe('the history file guard', () => {
  const run = (file: string, tool = 'Edit') => historyGuard('/p/flows/03-connectors/iterations/1.19')({ tool_name: tool, tool_input: { file_path: file } } as never, 'u1', { signal: new AbortController().signal });
  it('denies Write and Edit on a flow history file, relative or absolute', async () => {
    expect(await run('../../history.md')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('Design Studio writes this file') } });
    expect(await run('/p/flows/01-home/history.md', 'Write')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
  it('leaves other files alone', async () => {
    expect(await run('plan.md')).toEqual({});
    expect(await run('/p/history.md')).toEqual({});
  });
});
