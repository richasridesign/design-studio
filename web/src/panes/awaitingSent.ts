import { useSyncExternalStore } from 'react';
import { sentKey, startsWithPrompt, type AwaitItem } from '../../../shared/awaiting';
import { postJson } from '../store';
import type { PendingRequest } from '../../../shared/protocol';
import { typedAnswer, type TypedAnswer } from './typedAnswer';

// Approve and Answer in "Awaiting your decision" put a prompt in the message box. The item is decided when a message
// that starts with that prompt is sent, from the message box itself, so leaving the Review tab, switching chats or
// reloading never loses it. The prompts waiting to be sent are kept in this browser.

/** A prompt Approve or Answer put in the message box, waiting to be sent. */
export type Inserted = { id: string; key: string; fileKey: string; at: number; rule: string; question: boolean };

const STORE_KEY = 'designstudio.awaiting.inserted';
export const MAX_INSERTED = 50;

const local = (): Storage | undefined => {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
};

export function readInserted(store = local()): Inserted[] {
  try {
    const v = JSON.parse(store?.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Inserted => !!x && typeof x.id === 'string' && typeof x.key === 'string' && typeof x.fileKey === 'string') : [];
  } catch {
    return [];
  }
}

function writeInserted(list: Inserted[], store = local()) {
  try { store?.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_INSERTED))); } catch {}
}

/** Approve or Answer: the item waits for its prompt to be sent. Inserting again moves it to the newest. */
export function noteInserted(item: Pick<AwaitItem, 'id' | 'area' | 'rule' | 'fileKey'>, now = Date.now(), store = local()) {
  const entry: Inserted = { id: item.id, key: sentKey(item), fileKey: item.fileKey, at: now, rule: item.rule, question: item.area === 'long_run' };
  writeInserted([...readInserted(store).filter((x) => x.id !== item.id), entry], store);
}

/** Park, Reject, Reopen or a send: the item no longer waits for its prompt. */
export function forgetInserted(ids: Iterable<string>, store = local()) {
  const drop = new Set(ids);
  writeInserted(readInserted(store).filter((x) => !drop.has(x.id)), store);
}

/** The waiting prompts this message starts with, on the open Figma file. */
export const sentItems = (text: string, fileKey: string | undefined, list: Inserted[]) =>
  fileKey ? list.filter((x) => x.fileKey === fileKey && startsWithPrompt(x.key, text)) : [];

/**
 * What a sent message does. An Approve or Answer prompt from "Awaiting your decision" is never a reply to Claude's
 * waiting card, and sending it while a card waits would drop the card, so it is held in the box (hold). Any other
 * message typed while a card waits answers that card (answer).
 */
export function routeMessage(text: string, fileKey: string | undefined, list: Inserted[], pending: PendingRequest | undefined): { decided: Inserted[]; hold: boolean; answer: TypedAnswer | null } {
  const decided = sentItems(text, fileKey, list);
  if (decided.length) return { decided, hold: !!pending, answer: null };
  return { decided, hold: false, answer: typedAnswer(text, pending) };
}

export const AWAITING_SENT = 'designstudio:awaiting-sent';
export type SentDetail = { list: AwaitItem[] | null; items: Inserted[]; failed: boolean };

/** Marks the sent items approved (answered, for a question) and tells the Awaiting list. */
export async function markSent(items: Inserted[]) {
  if (!items.length) return;
  forgetInserted(items.map((x) => x.id));
  let list: AwaitItem[] | null = null;
  let failed = false;
  for (const x of items) {
    const next = await postJson<AwaitItem[]>('/api/awaiting', { id: x.id, state: 'approved' }).catch(() => null);
    if (next) list = next;
    else failed = true;
  }
  window.dispatchEvent(new CustomEvent<SentDetail>(AWAITING_SENT, { detail: { list, items, failed } }));
}

// The message box text, so the Awaiting list can drop its "in the message box" line once the prompt leaves the box.
let draft = '';
const subs = new Set<() => void>();
export function publishDraft(text: string) {
  if (text === draft) return;
  draft = text;
  subs.forEach((f) => f());
}
export const useDraft = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => draft);
