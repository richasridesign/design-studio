// Decision log: what was chosen, what it was chosen over, and why.
// Built from the sketch picks (sketch.json), the steps marked done with a note (stages.json)
// and the decisions Claude logs from the chat with set_status (decisions-log.json).

import type { SketchDoc } from './design.js';
import { STAGE_IDS, STAGE_INFO, type StageApprovals, type StageId } from './stages.js';

/** A decision made in the chat: the designer gave a direction, or Claude made a choice she should know. */
export type ChatDecision = {
  what: string;
  over?: string;
  why?: string;
  by: 'designer' | 'claude';
  screen?: string;
  at: number;
};

export const DECISIONS_LOG_FILE = 'decisions-log.json';
/** The newest decisions kept in the file. */
export const MAX_CHAT_DECISIONS = 200;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const sameWhat = (what: string) => what.toLowerCase();

/** One decision from set_status or the file, or null when it has no "what". "you" is the designer. */
export function cleanChatDecision(input: unknown, at: number): ChatDecision | null {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const what = text(o?.what, 300);
  if (!o || !what) return null;
  const d: ChatDecision = { what, by: o.by === 'claude' ? 'claude' : 'designer', at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : at };
  const over = text(o.over, 400);
  const why = text(o.why, 800);
  const screen = text(o.screen, 200);
  if (over) d.over = over;
  if (why) d.why = why;
  if (screen) d.screen = screen;
  return d;
}

/**
 * Adds new decisions to the log. The same "what" (ignoring case and spaces) is kept once, at its first time;
 * a repeat only fills in an "over", "why" or screen the first one left out. Oldest first, newest 200 kept.
 */
export function mergeChatDecisions(had: unknown, incoming: unknown, now: number): ChatDecision[] {
  const out: ChatDecision[] = [];
  const index = new Map<string, number>();
  const add = (d: ChatDecision | null) => {
    if (!d) return;
    const k = sameWhat(d.what);
    const i = index.get(k);
    if (i === undefined) {
      index.set(k, out.length);
      out.push(d);
      return;
    }
    const first = out[i];
    out[i] = { ...first, over: first.over ?? d.over, why: first.why ?? d.why, screen: first.screen ?? d.screen };
    for (const f of ['over', 'why', 'screen'] as const) if (out[i][f] === undefined) delete out[i][f];
  };
  for (const d of Array.isArray(had) ? had : []) add(cleanChatDecision(d, 0));
  for (const d of Array.isArray(incoming) ? incoming : []) add(cleanChatDecision(d, now));
  return out.slice(-MAX_CHAT_DECISIONS);
}

export type LogRow = {
  id: string;
  kind: 'pick' | 'stage' | 'chat';
  /** Screen name for a pick, "Step" for a step marked done, the screen (or "Chat") for a decision from the chat. */
  title: string;
  /** "Chose Classic list", "Approved Plan", or the decision from the chat. */
  choice: string;
  over: string[];
  why: string;
  by: 'designer' | 'claude';
  /** Claude picks made before this log existed have no time. */
  at?: number;
  screen?: string;
  direction?: string;
};

export function decisionLog(sketch: SketchDoc | null, approvals: StageApprovals, chat: ChatDecision[] = []): LogRow[] {
  const picks: LogRow[] = (sketch?.screens ?? []).flatMap((s) => {
    const d = s.directions.find((x) => x.id === s.chosen);
    if (!d) return [];
    const claude = s.chosenBy !== 'designer';
    return [{
      id: `pick:${s.id}`,
      kind: 'pick',
      title: s.name,
      choice: `Chose ${d.name}`,
      over: s.rejected ?? s.directions.filter((x) => x.id !== d.id).map((x) => x.name),
      why: (claude ? s.reason || d.rationale : s.reason) ?? '',
      by: claude ? 'claude' : 'designer',
      at: s.at,
      screen: s.id,
      direction: d.id,
    }];
  });
  const stages: LogRow[] = STAGE_IDS.flatMap((id: StageId) => {
    const a = approvals[id];
    if (!a?.note) return [];
    return [{ id: `stage:${id}`, kind: 'stage', title: 'Step', choice: `Approved ${STAGE_INFO[id].name}`, over: [], why: a.note, by: 'designer', at: a.at }];
  });
  const said: LogRow[] = chat.map((d) => ({
    id: `chat:${sameWhat(d.what)}`,
    kind: 'chat',
    // Same columns as a pick: where it applies, then what was decided.
    title: d.screen || 'Chat',
    choice: d.what,
    over: d.over ? [d.over] : [],
    why: d.why ?? '',
    by: d.by,
    at: d.at || undefined,
    screen: d.screen,
  }));
  // Newest first. Rows without a time come last, in screen order.
  return [...picks, ...stages, ...said].map((r, i) => ({ r, i })).sort((a, b) => (b.r.at ?? -1) - (a.r.at ?? -1) || a.i - b.i).map(({ r }) => r);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "you" in the app, "the designer" in the handoff report. A decision from the chat names only who made it. */
export const whoLabel = (r: LogRow, designer = 'you') => {
  const who = r.by === 'claude' ? 'Claude' : designer;
  return r.kind === 'chat' ? cap(who) : `${r.kind === 'stage' ? 'Approved' : 'Picked'} by ${who}`;
};
