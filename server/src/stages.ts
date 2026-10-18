import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  chatKind, cleanApprovals, cleanChatSteps, CHAT_KINDS, fromApprovals, KIND_INFO, markStep, setKind, stages, STAGE_IDS, STAGE_INFO, toApprovals,
  type ChatKind, type ChatSteps, type StageApprovals, type StageEvidence, type StageId, type StagesView,
} from '../../shared/stages.js';

export const STAGES_FILE = 'stages.json';

/**
 * stages.json sits in the Figma file's folder, which every chat on that file shares, so each chat keeps its own
 * steps under its Claude session id. Old files are one flat set of approvals: they stay as they are and still load.
 */
export type StagesFile = { approvals: StageApprovals; chats: Record<string, ChatSteps> };

export function cleanStagesFile(input: unknown): StagesFile {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const chats: Record<string, ChatSteps> = {};
  if (o.chats && typeof o.chats === 'object' && !Array.isArray(o.chats)) {
    for (const [k, v] of Object.entries(o.chats as Record<string, unknown>)) if (k && k.length <= 200) chats[k] = cleanChatSteps(v);
  }
  return { approvals: cleanApprovals(o), chats };
}

export const readStagesFile = (dir: string): Promise<StagesFile> =>
  readFile(path.join(dir, STAGES_FILE), 'utf8').then((t) => cleanStagesFile(JSON.parse(t))).catch(() => ({ approvals: {}, chats: {} }));

// Old approvals stay at the top level, next to the per-chat steps.
const writeStagesFile = (dir: string, f: StagesFile) => writeFile(path.join(dir, STAGES_FILE), JSON.stringify({ ...f.approvals, chats: f.chats }, null, 2));

const lastAt = (c: ChatSteps) => Math.max(0, ...Object.values(c.marks).map((m) => m?.at ?? 0));

/** One chat's steps. Old folder-wide approvals are not copied in: they belong to the chats that made them, and stay in the report. */
export const chatSteps = (f: StagesFile, chat: string | null): ChatSteps => (chat && f.chats[chat]) || { marks: {} };

/** Every done step in the folder, the newest of each, for the handoff report and its decision log. */
export async function readApprovals(dir: string): Promise<StageApprovals> {
  const f = await readStagesFile(dir);
  const out: StageApprovals = { ...f.approvals };
  for (const c of Object.values(f.chats)) {
    for (const [id, a] of Object.entries(toApprovals(c.marks)) as Array<[StageId, NonNullable<StageApprovals[StageId]>]>) if (!out[id] || out[id]!.at < a.at) out[id] = a;
  }
  return out;
}

/** The folder's tag in Chats: the next step of the chat on it that moved last. */
export async function folderLabel(dir: string): Promise<string | null> {
  const f = await readStagesFile(dir);
  const latest = Object.values(f.chats).filter((c) => c.kind !== 'none' && lastAt(c) > 0).sort((a, b) => lastAt(b) - lastAt(a))[0];
  const c = latest ?? (Object.keys(f.approvals).length ? { kind: 'new' as const, marks: fromApprovals(f.approvals) } : null);
  if (!c) return null;
  const steps = KIND_INFO[c.kind && c.kind !== 'none' ? c.kind : 'new'].steps;
  const next = steps.find((id) => !c.marks[id] || c.marks[id]!.state === 'todo');
  return next ? STAGE_INFO[next].name : 'All done';
}

export type StageInput = { action?: unknown; id?: unknown; note?: unknown; kind?: unknown };

/** Marks one step, or sets the chat's kind. Nothing else in the chat changes. */
export async function changeStage(dir: string, chat: string | null, input: StageInput, opts: { first?: string | null; seenRound?: number; now?: number } = {}): Promise<ChatSteps> {
  const now = opts.now ?? Date.now();
  if (!chat) throw new Error('Send a message first, then pick the steps');
  const f = await readStagesFile(dir);
  let c = chatSteps(f, chat);
  if (input.action === 'kind') {
    if (input.kind !== 'none' && !CHAT_KINDS.includes(input.kind as ChatKind)) throw new Error('Pick a kind of work');
    c = setKind(c, input.kind as ChatKind | 'none');
  } else {
    const id = STAGE_IDS.find((s) => s === input.id);
    // approve and reopen come from the first version of the panel.
    const action = input.action === 'approve' ? 'done' : input.action === 'reopen' ? 'undo' : input.action;
    if (!id || (action !== 'done' && action !== 'skip' && action !== 'undo' && action !== 'again')) throw new Error('Pick a step to change');
    // Marking a step keeps the guessed kind, so the list she is looking at stays the same.
    if (!c.kind) c = { ...c, kind: chatKind(c, opts.first).kind ?? 'new' };
    c = markStep(c, id, action, now, typeof input.note === 'string' ? input.note : undefined, opts.seenRound ?? 1);
  }
  f.chats[chat] = c;
  await writeStagesFile(dir, f);
  return c;
}

export async function readChatSteps(dir: string, chat: string | null): Promise<ChatSteps> {
  return chatSteps(await readStagesFile(dir), chat);
}

export async function readStages(dir: string, chat: string | null, first: string | null, evidence: StageEvidence): Promise<StagesView> {
  const c = await readChatSteps(dir, chat);
  const { kind, guessed } = chatKind(c, first);
  return { kind, guessed, steps: stages(evidence, c, kind) };
}
