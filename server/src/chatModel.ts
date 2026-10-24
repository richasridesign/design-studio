import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { CHAT_MODEL } from '../../shared/design.js';

// The model she picked for a chat in the composer, saved per Claude session in the chat folder, so her pick survives a
// reload, a server restart and a resume. The SDK starts a resumed chat on whatever model the options name.

const file = (cwd: string) => path.join(path.resolve(cwd), 'models.json');
/** A pick is saved as { pick }. A bare string is from before, when every turn start also saved the id it ran on. */
type Saved = Record<string, string | { pick?: unknown }>;

/** Model ids and aliases look like "opus", "claude-sonnet-5-5" or "opus[1m]". Anything else is never saved or used. */
export const modelId = (v: unknown): string | null => (typeof v === 'string' && /^[\w.\-]{1,80}(\[1m\])?$/i.test(v) ? v : null);

async function readAll(cwd: string): Promise<Saved> {
  const raw = await readFile(file(cwd), 'utf8').then((t) => JSON.parse(t) as unknown).catch(() => null);
  return raw && typeof raw === 'object' ? (raw as Saved) : {};
}

/**
 * The model picked for a session (in the composer, or by a run across flows), or null. A bare string is a pick only
 * when it is an alias (sonnet, opus[1m], default): the composer offers aliases, and the old turn-start save wrote the
 * full id a turn ran on ("claude-sonnet-5-5"), which is not a pick.
 */
export async function readChatModel(cwd: string, sessionId: string): Promise<string | null> {
  const v = (await readAll(cwd))[sessionId];
  if (v && typeof v === 'object') return modelId(v.pick);
  const id = modelId(v);
  return id && !id.startsWith('claude-') ? id : null;
}

export async function saveChatModel(cwd: string, sessionId: string, model: string) {
  const id = modelId(model);
  if (!id) return;
  const all = await readAll(cwd);
  const had = all[sessionId];
  if (had && typeof had === 'object' && had.pick === id) return;
  const f = file(cwd);
  await mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...all, [sessionId]: { pick: id } }, null, 2));
  await rename(tmp, f);
}

/** The model a chat starts on: her pick for its session when she made one, else Opus, for new and reopened chats alike. */
export function startModel(saved: string | null): string {
  return saved ?? CHAT_MODEL;
}
