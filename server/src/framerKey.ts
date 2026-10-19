import { spawn } from 'node:child_process';
import { keyError } from '../../shared/portfolio.js';

// The Framer API key lives only in the macOS Keychain (service DesignStudio.framer, account = the Framer project id).
// It is never written to the portfolio folder, never logged, never put in an error, a response, Claude's environment
// or argv: the add command goes to `security -i` on stdin. framer.json only says hasKey.

export const KEY_SERVICE = 'DesignStudio.framer';

export type Exec = (args: string[], input?: string) => Promise<{ code: number; out: string }>;
export type KeyDeps = { exec?: Exec };

const realExec: Exec = (args, input) =>
  new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, out }));
    p.stdin.end(input ?? '');
  });

function exec(deps: KeyDeps): Exec {
  if (deps.exec) return deps.exec;
  if (process.env.VITEST) throw new Error('Tests must not reach the Keychain');
  return realExec;
}

/** The Keychain account: the project id from the link (https://framer.com/projects/<id>), a plain token. */
const account = (project: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(project)) throw new Error('This is not a Framer project link');
  return project;
};

/** True when a key is stored for the project. Reads the item's attributes only, never the secret. */
export async function hasKey(project: string, deps: KeyDeps = {}): Promise<boolean> {
  const r = await exec(deps)(['find-generic-password', '-s', KEY_SERVICE, '-a', account(project)]);
  return r.code === 0;
}

/** The key, for the server's own Framer calls. Null when none is stored. */
export async function readKey(project: string, deps: KeyDeps = {}): Promise<string | null> {
  const r = await exec(deps)(['find-generic-password', '-s', KEY_SERVICE, '-a', account(project), '-w']);
  const key = r.out.trim();
  return r.code === 0 && key ? key : null;
}

/** Stores or replaces the key. The key is checked first, so nothing but a plain token reaches the shell line. */
export async function saveKey(project: string, key: string, deps: KeyDeps = {}): Promise<void> {
  const err = keyError(key);
  if (err) throw new Error(err);
  const line = `add-generic-password -U -s ${KEY_SERVICE} -a ${account(project)} -l "Design Studio, Framer" -w ${key.trim()}\n`;
  const r = await exec(deps)(['-i'], line);
  // security -i can end with 0 after a failed inner command, so the item is looked up afterwards.
  if (r.code !== 0 || !(await hasKey(project, deps))) throw new Error('The Keychain did not save the key');
}

export async function deleteKey(project: string, deps: KeyDeps = {}): Promise<void> {
  await exec(deps)(['delete-generic-password', '-s', KEY_SERVICE, '-a', account(project)]);
}
