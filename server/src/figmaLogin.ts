import { spawn, type ChildProcess } from 'node:child_process';
import { FIGMA_PLUGIN_SERVER } from './lean.js';

export type FigmaLoginState = { state: 'idle' | 'waiting' | 'done' | 'failed'; url?: string; error?: string };

const TIMEOUT_MS = 5 * 60_000;
// The CLI prints the sign-in link, which also arrives wrapped in terminal link codes.
const LINK = /https:\/\/www\.figma\.com\/oauth\/[^\s\x07\x1b]+/;
const CODES = /\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[a-zA-Z]|\r/g;

let now: FigmaLoginState = { state: 'idle' };
let child: ChildProcess | null = null;

export const figmaLoginState = (): FigmaLoginState => now;

/** The login command refuses to run without a terminal, so it runs inside `script`, which gives it one. */
export function loginCommand(platform = process.platform, server = FIGMA_PLUGIN_SERVER): [string, string[]] {
  const cmd = ['claude', 'mcp', 'login', server];
  return platform === 'darwin' ? ['script', ['-q', '/dev/null', ...cmd]] : ['script', ['-qec', cmd.join(' '), '/dev/null']];
}

/** Reads the CLI output: the sign-in link while it waits, and why it failed if it did. */
export function readLoginOutput(text: string): { url?: string; ok: boolean; error?: string } {
  const plain = text.replace(CODES, '');
  const url = plain.match(LINK)?.[0];
  if (/Authenticated with/i.test(plain)) return { url, ok: true };
  const failed = plain.match(/Couldn't complete authentication[^\n]*/i)?.[0];
  return { url, ok: false, error: failed?.trim() };
}

/**
 * Starts the same sign-in as /mcp in the Claude CLI: it opens Figma in the browser and waits for her to approve.
 * The CLI keeps the login, so Claude in every chat can use it afterwards.
 */
export function startFigmaLogin(): FigmaLoginState {
  if (child) return now;
  const [cmd, args] = loginCommand();
  let out = '';
  now = { state: 'waiting' };
  // script fails when its input is a pipe, so input comes from /dev/null.
  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child = proc;
  const timer = setTimeout(() => {
    proc.kill();
    now = { state: 'failed', url: now.url, error: 'The sign-in timed out after 5 minutes.' };
  }, TIMEOUT_MS);
  const read = (d: Buffer) => {
    out += d.toString();
    const r = readLoginOutput(out);
    if (r.url && now.state === 'waiting') now = { ...now, url: r.url };
  };
  proc.stdout?.on('data', read);
  proc.stderr?.on('data', read);
  proc.on('error', (e) => { now = { state: 'failed', error: e.message }; });
  proc.on('exit', (code) => {
    clearTimeout(timer);
    child = null;
    if (now.state !== 'waiting') return;
    const r = readLoginOutput(out);
    now = r.ok || code === 0 ? { state: 'done' } : { state: 'failed', url: r.url, error: r.error ?? 'The sign-in stopped before Figma approved it.' };
  });
  return now;
}

export function cancelFigmaLogin(): FigmaLoginState {
  child?.kill();
  child = null;
  now = { state: 'idle' };
  return now;
}
