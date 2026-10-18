import { execFile, type ExecFileException } from 'node:child_process';

export type ClaudeStatus = { ok: boolean; detail: string };

export function parseAuthStatus(out: string): ClaudeStatus {
  let s: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
  try {
    s = JSON.parse(out);
  } catch {
    return { ok: false, detail: 'Could not read the Claude login status' };
  }
  if (s.loggedIn !== true) return { ok: false, detail: 'Claude is installed but not signed in' };
  const how = [s.authMethod, s.subscriptionType].filter((v): v is string => typeof v === 'string' && !!v).join(', ');
  return { ok: true, detail: how ? `Signed in to Claude (${how})` : 'Signed in to Claude' };
}

const run = (args: string[]) =>
  new Promise<{ out: string; err?: ExecFileException }>((resolve) =>
    execFile('claude', args, { timeout: 10_000, maxBuffer: 1 << 20 }, (err, out) => resolve({ out: String(out), err: err ?? undefined })),
  );

export async function claudeStatus(): Promise<ClaudeStatus> {
  const r = await run(['auth', 'status']);
  if (r.err?.code === 'ENOENT') return { ok: false, detail: 'Claude CLI is not installed' };
  if (r.out.trim().startsWith('{')) return parseAuthStatus(r.out);
  if (r.err) return { ok: false, detail: r.err.killed ? 'Claude CLI did not answer in 10 seconds' : 'Claude is installed but not signed in' };
  return parseAuthStatus(r.out);
}
