import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { CHAT_MODEL, LEGACY_CHAT_MODEL } from '../../shared/design.js';

// The model each chat runs on, saved per Claude session in the chat folder, so a switch in the composer survives a
// reload, a server restart and a resume. The SDK starts a resumed chat on whatever model the options name.

const file = (cwd: string) => path.join(path.resolve(cwd), 'models.json');
type Saved = Record<string, string>;

/** Model ids and aliases look like "opus", "claude-sonnet-5-5" or "opus[1m]". Anything else is never saved or used. */
export const modelId = (v: unknown): string | null => (typeof v === 'string' && /^[\w.\-]{1,80}(\[1m\])?$/i.test(v) ? v : null);

async function readAll(cwd: string): Promise<Saved> {
  const raw = await readFile(file(cwd), 'utf8').then((t) => JSON.parse(t) as unknown).catch(() => null);
  return raw && typeof raw === 'object' ? (raw as Saved) : {};
}

export async function readChatModel(cwd: string, sessionId: string): Promise<string | null> {
  return modelId((await readAll(cwd))[sessionId]);
}

export async function saveChatModel(cwd: string, sessionId: string, model: string) {
  const id = modelId(model);
  if (!id) return;
  const all = await readAll(cwd);
  if (all[sessionId] === id) return;
  const f = file(cwd);
  await mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...all, [sessionId]: id }, null, 2));
  await rename(tmp, f);
}

/** The model of the last main-thread reply in a saved transcript ("<synthetic>" error and command rows skipped). */
export function lastModel(msgs: SessionMessage[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== 'assistant' || m.parent_tool_use_id) continue;
    const id = modelId((m.message as { model?: unknown })?.model);
    if (id && id.startsWith('claude-')) return id;
  }
  return null;
}

/**
 * The model a chat starts on: the one saved for its session, else the one its transcript last ran on, else Sonnet
 * for an old chat with neither (chats started on Sonnet before Opus became the default). A new chat starts on Opus.
 */
export function startModel(resume: string | undefined, saved: string | null, fromTranscript: string | null): string {
  if (!resume) return CHAT_MODEL;
  return saved ?? fromTranscript ?? LEGACY_CHAT_MODEL;
}
