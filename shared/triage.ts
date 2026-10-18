// Triage: the designer closes a review finding by hand (Fixed, Won't fix or Parked) with a why and a date.
// A finding's key is its run id plus its id. Reviewer ids carry the finding's index, so the same id in a later
// round can point at a different finding. Triage therefore applies only to the run it was made on, and every
// new round starts with every finding open.

import type { Finding, ReviewRun } from './design.js';

export const TRIAGE_STATES = ['fixed', 'wontfix', 'parked'] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];
export type TriageEntry = { state: TriageState; why: string; at: number };
export type Triage = Record<string, TriageEntry>;

export type TriageChange =
  | { action: 'close'; key: string; state: TriageState; why?: string }
  | { action: 'reopen'; key: string };

export const TRIAGE_LABEL: Record<TriageState, string> = { fixed: 'Fixed', wontfix: "Won't fix", parked: 'Parked' };
/** Won't fix and Parked need a why, so the handoff says what was decided. */
export const needsWhy = (s: TriageState) => s !== 'fixed';

const WHY_MAX = 200;
const KEY_MAX = 300;
const MAX_ENTRIES = 500;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isState = (v: unknown): v is TriageState => TRIAGE_STATES.includes(v as TriageState);

export const triageKey = (run: Pick<ReviewRun, 'id'>, f: Pick<Finding, 'id'>) => `${run.id}:${f.id}`;

export function cleanTriage(input: unknown): Triage {
  const out: Triage = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    const e = v as { state?: unknown; why?: unknown; at?: unknown } | null;
    if (!key || key.length > KEY_MAX || !e || !isState(e.state) || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
    const why = text(e.why, WHY_MAX);
    if (needsWhy(e.state) && !why) continue;
    out[key] = { state: e.state, why, at: e.at };
  }
  return out;
}

export function changeTriage(t: Triage, c: TriageChange, now: number): Triage {
  const key = text(c?.key, KEY_MAX);
  if (!key) throw new Error('Pick a finding');
  const next = { ...t };
  if (c.action === 'reopen') {
    delete next[key];
    return next;
  }
  if (c.action !== 'close') throw new Error('Pick close or reopen');
  if (!isState(c.state)) throw new Error("Pick Fixed, Won't fix or Parked");
  const why = text(c.why, WHY_MAX);
  if (needsWhy(c.state) && !why) throw new Error(`Say why it is ${c.state === 'parked' ? 'parked' : 'not fixed'}`);
  next[key] = { state: c.state, why, at: now };
  return cleanTriage(next);
}

export const allFindings = (run: Pick<ReviewRun, 'check' | 'results'>): Finding[] => [...run.check, ...run.results.flatMap((r) => r.findings)];

export type ClosedFinding = Finding & { triage: TriageEntry };

/** Splits a run's findings into the ones still open and the ones closed by hand. Keys from other runs are ignored. */
export function splitFindings(run: ReviewRun, findings: Finding[], triage: Triage | null | undefined): { open: Finding[]; closed: ClosedFinding[] } {
  const open: Finding[] = [];
  const closed: ClosedFinding[] = [];
  for (const f of findings) {
    const t = triage?.[triageKey(run, f)];
    if (t) closed.push({ ...f, triage: t });
    else open.push(f);
  }
  return { open, closed };
}

export const splitRun = (run: ReviewRun, triage: Triage | null | undefined) => splitFindings(run, allFindings(run), triage);

/** The run with closed findings left out, for counts that must agree with the open list. */
export const openRun = (run: ReviewRun, triage: Triage | null | undefined): ReviewRun => ({
  ...run,
  check: splitFindings(run, run.check, triage).open,
  results: run.results.map((r) => ({ ...r, findings: splitFindings(run, r.findings, triage).open })),
});

/** Blocking and major findings still open: what the Validate gate and the report summary count. */
export const openIssues = (run: ReviewRun, triage: Triage | null | undefined) => splitRun(run, triage).open.filter((f) => f.severity !== 'minor');

/** "1 fixed, 1 won't fix" for the closed findings given, in a fixed order. Empty when none. */
export function closedTally(closed: Array<{ triage: TriageEntry }>): string {
  return TRIAGE_STATES.map((s) => {
    const n = closed.filter((c) => c.triage.state === s).length;
    return n ? `${n} ${TRIAGE_LABEL[s].toLowerCase()}` : '';
  }).filter(Boolean).join(', ');
}
