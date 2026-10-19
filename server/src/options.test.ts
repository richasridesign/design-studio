import { describe, expect, it, vi } from 'vitest';
import { agentOptions, DECISION_INPUT, instructions } from './options.js';

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

  it('asks Claude to log decisions in set_status, and keeps them out of important', () => {
    const text = instructions(null);
    expect(text).toContain('Log each design or product decision once in set_status decisions');
    expect(text).toContain('important only for a risk, blocker or surprise');
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
    expect(agentOptions(base as never).hooks!.PreToolUse).toHaveLength(1);
    const o = agentOptions({ ...base, beforeAgent: vi.fn() } as never);
    expect(o.hooks!.PreToolUse!.map((m) => m.matcher)).toEqual(['mcp__.*use_figma', '^(Agent|Task)$']);
    expect(o.allowedTools).toContain('mcp__designstudio__refresh_file_map');
  });
});

describe('set_status decisions', () => {
  it('takes what and by, with over, why and screen optional', () => {
    expect(DECISION_INPUT.parse({ what: 'Ready replaces Ready to turn on', by: 'you' })).toEqual({ what: 'Ready replaces Ready to turn on', by: 'you' });
    expect(DECISION_INPUT.safeParse({ what: 'A', over: 'B', why: 'C', by: 'claude', screen: 'Connectors' }).success).toBe(true);
    expect(DECISION_INPUT.safeParse({ what: 'A', by: 'designer' }).success).toBe(true);
    expect(DECISION_INPUT.safeParse({ what: 'A', by: 'someone' }).success).toBe(false);
    expect(DECISION_INPUT.safeParse({ by: 'you' }).success).toBe(false);
  });
});
