import { spawn } from 'node:child_process';
import { keyError } from '../../shared/portfolio.js';

// The Framer API key lives only in the macOS Keychain (service designstudio.framer, account = the site). It is
// never written to the portfolio folder, never logged, never put in Claude's environment or in argv: the add command
// goes to `security -i` on stdin.

export const KEY_SERVICE = 'designstudio.framer';

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

const account = (site: string) => {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) throw new Error('Type the address without a path, like richadesign.in');
  return site;
};

/** True when a key is stored for the site. Reads the item's attributes only, never the secret. */
export async function hasKey(site: string, deps: KeyDeps = {}): Promise<boolean> {
  const r = await exec(deps)(['find-generic-password', '-s', KEY_SERVICE, '-a', account(site)]);
  return r.code === 0;
}

/** The key, for the server's own Framer calls. Null when none is stored. */
export async function readKey(site: string, deps: KeyDeps = {}): Promise<string | null> {
  const r = await exec(deps)(['find-generic-password', '-s', KEY_SERVICE, '-a', account(site), '-w']);
  const key = r.out.trim();
  return r.code === 0 && key ? key : null;
}

/** Stores or replaces the key. The key is checked first, so nothing but a plain token reaches the shell line. */
export async function saveKey(site: string, key: string, deps: KeyDeps = {}): Promise<void> {
  const err = keyError(key);
  if (err) throw new Error(err);
  const line = `add-generic-password -U -s ${KEY_SERVICE} -a ${account(site)} -l "Design Studio, Framer" -w ${key.trim()}\n`;
  const r = await exec(deps)(['-i'], line);
  // security -i can end with 0 after a failed inner command, so the item is looked up afterwards.
  if (r.code !== 0 || !(await hasKey(site, deps))) throw new Error('The Keychain did not save the key');
}

export async function deleteKey(site: string, deps: KeyDeps = {}): Promise<void> {
  await exec(deps)(['delete-generic-password', '-s', KEY_SERVICE, '-a', account(site)]);
}
