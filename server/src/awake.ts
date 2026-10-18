import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Keeps the Mac from idle sleep while a long run works: `caffeinate -i` until `until`, tied to this server's
 * process so it ends if the server stops. Returns a function that lets the Mac sleep again, or null on other
 * platforms or when caffeinate could not start. A closed lid still sleeps unless the Mac is on power with a display.
 */
export function keepAwake(until: number, opts: { now?: number; platform?: NodeJS.Platform; spawnFn?: typeof spawn } = {}): (() => void) | null {
  if ((opts.platform ?? process.platform) !== 'darwin') return null;
  const secs = Math.max(60, Math.ceil((until - (opts.now ?? Date.now())) / 1000));
  let child: ChildProcess;
  try {
    child = (opts.spawnFn ?? spawn)('/usr/bin/caffeinate', ['-i', '-w', String(process.pid), '-t', String(secs)], { stdio: 'ignore' });
  } catch {
    return null;
  }
  if (!child.pid) return null;
  child.on('error', () => {});
  child.unref();
  return () => { if (child.exitCode === null && !child.killed) child.kill(); };
}
