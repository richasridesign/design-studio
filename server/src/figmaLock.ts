// One write at a time per Figma file. Two chats on different flows each run their own Figma MCP server, so their
// use_figma calls could interleave inside the plugin, and a restack by Design Studio could move nodes a chat is
// mid-edit on. The lock holds for one call, so chats interleave at call level and rarely wait. Reads never take it.

export const LOCK_TIMEOUT_MS = 120_000;
/** A holder that never releases (a crashed call) loses the lock after this long, so the queue moves on. */
export const HOLD_MAX_MS = 180_000;

type Waiter = { resolve: (release: () => void) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };
type Lock = { holder: symbol | null; queue: Waiter[]; holdTimer: NodeJS.Timeout | null };

const locks = new Map<string, Lock>();
const lockFor = (key: string) => locks.get(key) ?? locks.set(key, { holder: null, queue: [], holdTimer: null }).get(key)!;

function give(key: string, lock: Lock, w: Waiter) {
  const me = Symbol('hold');
  lock.holder = me;
  clearTimeout(w.timer);
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    if (lock.holder !== me) return;
    lock.holder = null;
    if (lock.holdTimer) clearTimeout(lock.holdTimer);
    lock.holdTimer = null;
    const next = lock.queue.shift();
    if (next) give(key, lock, next);
    else if (!lock.queue.length) locks.delete(key);
  };
  lock.holdTimer = setTimeout(() => {
    console.error(`figma lock: ${key} held for ${HOLD_MAX_MS / 1000}s, released`);
    release();
  }, HOLD_MAX_MS);
  lock.holdTimer.unref?.();
  w.resolve(release);
}

/**
 * Waits for the file's write lock and resolves with the release function. Rejects after `timeoutMs` in the queue.
 * Releasing twice is harmless.
 */
export function acquireWrite(key: string, timeoutMs = LOCK_TIMEOUT_MS): Promise<() => void> {
  const lock = lockFor(key);
  return new Promise<() => void>((resolve, reject) => {
    const w: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        lock.queue.splice(lock.queue.indexOf(w), 1);
        reject(new Error(`Another chat has been editing this Figma file for over ${Math.round(timeoutMs / 1000)} seconds. Try again in a moment.`));
      }, timeoutMs),
    };
    w.timer.unref?.();
    if (lock.holder === null) give(key, lock, w);
    else lock.queue.push(w);
  });
}

/** Runs `fn` under the file's write lock. */
export async function withWrite<T>(key: string, fn: () => Promise<T>, timeoutMs = LOCK_TIMEOUT_MS): Promise<T> {
  const release = await acquireWrite(key, timeoutMs);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** True while someone holds the file's lock (for tests and the restack's idle check). */
export const isLocked = (key: string) => locks.get(key)?.holder !== null && locks.has(key);

/** How many calls wait for the file. */
export const waiting = (key: string) => locks.get(key)?.queue.length ?? 0;
