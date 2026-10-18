import type { PlanLimit } from './protocol.js';

export type LongRunState = 'running' | 'reporting' | 'done' | 'stopped';
export type LongRunReason = 'time' | 'cap' | 'weekly' | 'rejected' | 'user' | 'errors' | 'reported' | 'ended';

export type LongRun = {
  until: number;
  /** Stop at this percent of the 5-hour plan window. */
  cap: number;
  /** Stop at this percent of the weekly plan window. Older runs have none, so it falls back to the default. */
  weeklyCap?: number;
  /** How many review, fix, check rounds Claude is asked to do. */
  rounds?: number;
  /** The round Claude last said it was on ("Round 2 of 3"). */
  round?: number;
  startedAt: number;
  turns: number;
  state: LongRunState;
  reason?: LongRunReason;
  /** When the Mac is kept awake until (macOS only): the run's end time. */
  awakeUntil?: number;
  /** How many report questions were saved to Awaiting your decision when the run ended. */
  awaiting?: number;
};

export const DEFAULT_CAP = 90;
export const DEFAULT_WEEKLY_CAP = 70;
export const DEFAULT_ROUNDS = 3;
export const MAX_ROUNDS = 6;
/** The Mac stays awake this long past the end time, so the report turn is not cut by sleep. */
export const AWAKE_GRACE = 15 * 60_000;

/** The latest plan limit per window ("five_hour", "seven_day", ...). */
export type Limits = Record<string, PlanLimit>;
export type Window = 'five_hour' | 'weekly';
/** Weekly windows: the overall one and the per-model ones; the highest is the one that stops work first. */
const WEEKLY = ['seven_day', 'seven_day_opus', 'seven_day_sonnet'];

export const LONG_RUN_ACTIVE: LongRunState[] = ['running', 'reporting'];
export const isActive = (r: LongRun | null | undefined) => !!r && LONG_RUN_ACTIVE.includes(r.state);

export const MAX_ERRORS = 2;

export const REASON_TEXT: Record<LongRunReason, string> = {
  time: 'time reached',
  cap: '5-hour usage cap reached',
  weekly: 'weekly usage cap reached',
  rejected: 'plan limit reached',
  user: 'stopped by you',
  errors: `${MAX_ERRORS} errors in a row`,
  reported: 'report ready',
  ended: 'the session ended',
};

export const ASK_DENIED =
  'This is a long run and I am away, so I cannot answer. Do not ask. Pick the safe option or leave it as it is, list the question under "## Needs your decision" in the report, and keep working.';

export const CONTINUE_TEXT =
  'Keep going with the long run task. Work through what is left, check your work, and say which round you are on ("Round 2 of 3"). Do not wait for me. When the rounds are done or you are blocked on my decisions, reply with the long run report.';

export function reportAsk(reason: LongRunReason) {
  const why = reason === 'cap' ? '5-hour plan usage reached the cap for this long run.' : reason === 'weekly' ? 'Weekly plan usage reached the cap for this long run.' : 'The time for this long run is up.';
  return `${why} Stop working now. Do not start new edits. Reply with the long run report in the format I gave you.`;
}

export type PromptOpts = { cap: number; weeklyCap?: number; rounds?: number; mapFile?: string | null };

export function longRunPrompt(task: string, until: number, o: PromptOpts) {
  const end = new Date(until).toTimeString().slice(0, 5);
  const rounds = o.rounds ?? DEFAULT_ROUNDS;
  const map = o.mapFile ? `Use the cached file map (${o.mapFile}) to find frames instead of exploring the file. ` : 'Use the cached file map to find frames instead of exploring the file. ';
  return `${task}

This is a long run. I am away, so work on your own until it is done or until ${end}. Work in rounds, up to ${rounds}: review, fix, then check again. Start each round's text with "Round 1 of ${rounds}", "Round 2 of ${rounds}" and so on. With several flows, give each flow its own subagent and pass it the file map. Write the report after round ${rounds}, or sooner when a round finds nothing new.

Be careful with tokens: no repeated screenshots or full-file reads when a smaller check will do. ${map}Do not ask me questions and do not wait for me. When something needs my decision, pick the safe option or leave it as it is, note it, and move on to the next thing. I will send "keep going" after each of your turns. Usage stops at ${o.cap}% of the 5-hour plan limit or ${o.weeklyCap ?? DEFAULT_WEEKLY_CAP}% of the weekly limit.

When everything is done, or you are blocked on my decisions, end with the long run report in exactly this format: these three headings, bullets under each, keep Figma node links as full links, write "- None" under an empty section.

## Fixed
- what you changed, with the node link

## Needs your decision
- the question, the options, and what you did for now, with the node link

## Not checked
- what you could not verify, and why`;
}

export type Decision = { action: 'continue' } | { action: 'ask_report'; reason: LongRunReason } | { action: 'stop'; reason: LongRunReason } | { action: 'done' } | { action: 'none' };

export type TurnEnd = {
  now: number;
  /** The latest limit of any window: a rejection there stops the run. */
  limit: PlanLimit | null | undefined;
  /** The latest limit per window. Without it, only `limit` is known. */
  limits?: Limits | null;
  errorStreak: number;
  reported: boolean;
};

/** Keeps the latest limit per window. */
export const withLimit = (limits: Limits | null | undefined, l: PlanLimit): Limits => ({ ...(limits ?? {}), [l.kind]: l });

/** Percent used of the 5-hour or the weekly window, or null when no event has said yet. */
export function windowPct(limits: Limits | null | undefined, w: Window): number | null {
  const kinds = w === 'five_hour' ? ['five_hour'] : WEEKLY;
  const used = kinds.map((k) => limits?.[k]?.used).filter((u): u is number => typeof u === 'number');
  return used.length ? Math.max(...used) * 100 : null;
}

/** Percent used of the 5-hour window from one limit event (0 when it is another window). */
export function usedPct(limit: PlanLimit | null | undefined) {
  return limit && limit.kind === 'five_hour' && typeof limit.used === 'number' ? limit.used * 100 : 0;
}

/** What to do when a turn ends with the agent idle. */
export function decide(run: LongRun | null | undefined, t: TurnEnd): Decision {
  if (!isActive(run)) return { action: 'none' };
  if (t.reported) return { action: 'done' };
  if (t.limit?.status === 'rejected') return { action: 'stop', reason: 'rejected' };
  if (run!.state === 'reporting') return { action: 'stop', reason: run!.reason ?? 'time' };
  if (t.errorStreak >= MAX_ERRORS) return { action: 'stop', reason: 'errors' };
  if (t.now >= run!.until) return { action: 'ask_report', reason: 'time' };
  const limits = t.limits ?? (t.limit ? withLimit(null, t.limit) : null);
  if ((windowPct(limits, 'five_hour') ?? 0) >= run!.cap) return { action: 'ask_report', reason: 'cap' };
  if ((windowPct(limits, 'weekly') ?? 0) >= (run!.weeklyCap ?? DEFAULT_WEEKLY_CAP)) return { action: 'ask_report', reason: 'weekly' };
  return { action: 'continue' };
}

/** The round Claude says it is on ("Round 2 of 3"), the last one in the text. */
export function roundFrom(text: string): number | null {
  const all = [...text.matchAll(/\bround (\d{1,2}) of (\d{1,2})\b/gi)];
  const m = all[all.length - 1];
  return m ? +m[1] : null;
}

/** A report line as plain words: link labels kept, link targets and bare Figma links dropped. */
export function plainLine(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<?https?:\/\/(?:www\.)?figma\.com\/\S+?>?(?=[\s)]|$)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Never a real file: the sample tour's key. */
const SAMPLE = 'sample';

/** The report's "Needs your decision" items as they go to the Awaiting list: plain text, the node from the link, or the chat's file. */
export function reportQuestions(decide: string[], chatKey: string | null | undefined): Array<{ text: string; fileKey: string; node: string }> {
  const key = chatKey && chatKey !== SAMPLE ? chatKey : '';
  return decide
    .map((raw) => ({ text: plainLine(raw), ...(nodeLink(raw) ?? { fileKey: key, node: '' }) }))
    .filter((q) => q.text && q.fileKey && q.fileKey !== SAMPLE);
}

/** A Figma node link in a report line: its file key and node id ("12:34"). */
export function nodeLink(text: string): { fileKey: string; node: string } | null {
  const m = /figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)[^\s)]*?[?&]node-id=(\d+)[-:](\d+)/.exec(text);
  return m ? { fileKey: m[1], node: `${m[2]}:${m[3]}` } : null;
}

/** "04:00" as the next time it comes round after `now` (tomorrow when it has passed today). */
export function untilFrom(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export type Report = { intro: string; fixed: string[]; decide: string[]; unchecked: string[] };

const HEADS: Array<[keyof Omit<Report, 'intro'>, RegExp]> = [
  ['fixed', /^fixed$/i],
  ['decide', /^needs? your decisions?$/i],
  ['unchecked', /^not checked$/i],
];

const NONE = /^(none|nothing|n\/a)\.?$/i;

/** Parses the long run report. Returns null unless all three headings start a line. */
export function parseReport(text: string): Report | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: Report = { intro: '', fixed: [], decide: [], unchecked: [] };
  const seen = new Set<string>();
  const intro: string[] = [];
  let cur: keyof Omit<Report, 'intro'> | null = null;
  for (const line of lines) {
    const h = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const title = h[1].replace(/[*_]/g, '').replace(/\s*[:(\-]?\s*\d+\s*\)?\s*$/, '').replace(/:\s*$/, '').trim();
      const hit = HEADS.find(([, re]) => re.test(title));
      if (hit) { cur = hit[0]; seen.add(cur); continue; }
      if (cur) { cur = null; continue; }
    }
    if (!cur) { if (seen.size === 0) intro.push(line); continue; }
    const b = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const list = out[cur];
    if (b) list.push(b[1].trim());
    else if (line.trim() && list.length) list[list.length - 1] += ` ${line.trim()}`;
    else if (line.trim()) list.push(line.trim());
  }
  if (seen.size < 3) return null;
  for (const [k] of HEADS) out[k] = out[k].filter((x) => x && !NONE.test(x));
  out.intro = intro.join('\n').trim();
  return out;
}

/** Why a run could stop overnight to wait for an approval, or '' when it will not. */
export function stallReason(permissionMode: string | null | undefined, askBeforeEdit: boolean): string {
  if (askBeforeEdit) return 'Ask before changing the file is on, so the run waits for you at each Figma change.';
  if (permissionMode && !['auto', 'bypassPermissions'].includes(permissionMode)) return 'This chat asks before Claude uses tools, so the run waits for you at each one.';
  return '';
}
