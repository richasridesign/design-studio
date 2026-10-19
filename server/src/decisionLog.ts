import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { DECISIONS_LOG_FILE, mergeChatDecisions, type ChatDecision } from '../../shared/decisionLog.js';

/** Decisions Claude logged from the chat with set_status, oldest first. Kept in the chat folder. */
export const readChatDecisions = (dir: string): Promise<ChatDecision[]> =>
  readFile(path.join(dir, DECISIONS_LOG_FILE), 'utf8').then((t) => mergeChatDecisions(JSON.parse(t), [], 0)).catch(() => []);

// One write at a time per folder, so two set_status calls in one reply never drop a row.
const queues = new Map<string, Promise<unknown>>();

export function logDecisions(dir: string, items: unknown[], now = Date.now()): Promise<ChatDecision[]> {
  const run = (queues.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const had = await readChatDecisions(dir);
    const next = mergeChatDecisions(had, items, now);
    if (JSON.stringify(next) !== JSON.stringify(had)) await writeFile(path.join(dir, DECISIONS_LOG_FILE), JSON.stringify(next, null, 2));
    return next;
  });
  queues.set(dir, run);
  void run.finally(() => { if (queues.get(dir) === run) queues.delete(dir); }).catch(() => {});
  return run;
}
