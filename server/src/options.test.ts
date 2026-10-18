import { describe, expect, it, vi } from 'vitest';
import { agentOptions, instructions } from './options.js';

const figma = { key: 'abc', name: 'Shop', url: 'https://www.figma.com/design/abc/Shop' };

describe('instructions', () => {
  it('points Claude at the file map and the helpers when a file is attached', () => {
    const text = instructions(figma as never, '', '/chat/.figma-cache/abc/map.md');
    expect(text).toContain('File map: /chat/.figma-cache/abc/map.md');
    expect(text).toContain('DS.check');
    expect(text).toContain('Design Studio saves a version in Figma history before your first change in a turn');
    expect(text).not.toMatch(/save a version with use_figma/i);
  });

  it('leaves the Figma speed notes out when no file is attached', () => {
    expect(instructions(null)).not.toContain('DS.');
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
