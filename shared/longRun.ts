import type { PlanLimit } from './protocol.js';

export type LongRunState = 'running' | 'reporting' | 'done' | 'stopped';
export type LongRunReason = 'time' | 'cap' | 'rejected' | 'user' | 'errors' | 'reported' | 'ended';

export type LongRun = {
  until: number;
  cap: number;
  startedAt: number;
  turns: number;
  state: LongRunState;
  reason?: LongRunReason;
};

export const LONG_RUN_ACTIVE: LongRunState[] = ['running', 'reporting'];
export const isActive = (r: LongRun | null | undefined) => !!r && LONG_RUN_ACTIVE.includes(r.state);

export const MAX_ERRORS = 2;

export const REASON_TEXT: Record<LongRunReason, string> = {
  time: 'time reached',
  cap: 'plan usage cap reached',
  rejected: 'plan limit reached',
  user: 'stopped by you',
  errors: `${MAX_ERRORS} errors in a row`,
  reported: 'report ready',
  ended: 'the session ended',
};

export const ASK_DENIED =
  'This is a long run and I am away, so I cannot answer. Do not ask. Pick the safe option or leave it as it is, list the question under "## Needs your decision" in the report, and keep working.';

export const CONTINUE_TEXT =
  'Keep going with the long run task. Work through what is left, check your work, and do not wait for me. When everything is done or you are blocked on my decisions, reply with the long run report.';

export function reportAsk(reason: LongRunReason) {
  const why = reason === 'cap' ? 'Plan usage reached the cap for this long run.' : 'The time for this long run is up.';
  return `${why} Stop working now. Do not start new edits. Reply with the long run report in the format I gave you.`;
}

export function longRunPrompt(task: string, until: number, cap: number) {
  const end = new Date(until).toTimeString().slice(0, 5);
  return `${task}

This is a long run. I am away, so work on your own until it is done or until ${end}. Be careful with tokens: no repeated screenshots or full-file reads when a smaller check will do. Do not ask me questions and do not wait for me. When something needs my decision, pick the safe option or leave it as it is, note it, and move on to the next thing. I will send "keep going" after each of your turns. Usage stops at ${cap}% of the 5-hour plan limit.

When everything is done, or you are blocked on my decisions, end with the long run report in exactly this format: these three headings, bullets under each, keep Figma node links as full links, write "- None" under an empty section.

## Fixed
- what you changed, with the node link

## Needs your decision
- the question, the options, and what you did for now

## Not checked
- what you could not verify, and why`;
}

export type Decision = { action: 'continue' } | { action: 'ask_report'; reason: LongRunReason } | { action: 'stop'; reason: LongRunReason } | { action: 'done' } | { action: 'none' };

export type TurnEnd = {
  now: number;
  limit: PlanLimit | null | undefined;
  errorStreak: number;
  reported: boolean;
};

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
  if (usedPct(t.limit) >= run!.cap) return { action: 'ask_report', reason: 'cap' };
  return { action: 'continue' };
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
