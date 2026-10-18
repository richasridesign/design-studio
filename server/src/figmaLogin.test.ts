import { describe, expect, it } from 'vitest';
import { loginCommand, readLoginOutput } from './figmaLogin.js';

describe('figma login', () => {
  it('runs the CLI login inside script, which gives it a terminal', () => {
    expect(loginCommand('darwin', 'plugin:figma:figma')).toEqual(['script', ['-q', '/dev/null', 'claude', 'mcp', 'login', 'plugin:figma:figma']]);
    expect(loginCommand('linux', 'plugin:figma:figma')).toEqual(['script', ['-qec', 'claude mcp login plugin:figma:figma', '/dev/null']]);
  });

  it('reads the sign-in link while it waits, without terminal link codes', () => {
    const link = 'https://www.figma.com/oauth/mcp?response_type=code&state=abc';
    const r = readLoginOutput(`Starting authentication\r\nIf the browser didn't open, visit:\r\n  \x1b]8;;${link}\x07${link}\x1b]8;;\x07\r\nWaiting for authorization`);
    expect(r).toEqual({ url: link, ok: false, error: undefined });
  });

  it('sees success and failure', () => {
    expect(readLoginOutput('Authenticated with "plugin:figma:figma". Its tools are now available').ok).toBe(true);
    expect(readLoginOutput(`Couldn't complete authentication for "plugin:figma:figma": stdin isn't a terminal\nmore`).error).toBe(`Couldn't complete authentication for "plugin:figma:figma": stdin isn't a terminal`);
  });
});
