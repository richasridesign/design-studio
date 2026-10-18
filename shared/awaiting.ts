// "Awaiting your decision": review findings whose fix changes something shared (a token, a main component,
// a feature, screens outside the reviewed frames). Fix rounds skip them and they wait here, across chats,
// until the designer approves, rejects or parks them.

import type { AnyArea, Finding, Severity } from './design.js';

export const AWAIT_STATES = ['open', 'approved', 'rejected', 'parked'] as const;
export type AwaitState = (typeof AWAIT_STATES)[number];
export const AWAIT_LABEL: Record<AwaitState, string> = { open: 'Open', approved: 'Approved', rejected: 'Rejected', parked: 'Parked' };

export type AwaitItem = {
  id: string;
  at: number;
  fileKey: string;
  fileName: string;
  node: string;
  nodeName?: string;
  /** 'long_run': a question from a long run report, not a review finding. */
  area: AnyArea | 'check' | 'long_run';
  severity: Severity;
  rule: string;
  /** The reviewer's suggested fix: the recommended option. */
  fix: string;
  /** What the fix touches beyond these frames. */
  impact: string;
  state: AwaitState;
  decidedAt?: number;
};

export const MAX_AWAIT = 300;
const TEXT_MAX = 400;
const text = (v: unknown, max = TEXT_MAX) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** One item per file and problem: the same finding in a later round does not add a second row. */
export const awaitKey = (fileKey: string, f: Pick<Finding, 'rule' | 'node'>) => `${fileKey}|${f.node}|${text(f.rule, 120).toLowerCase()}`;

export function cleanAwaiting(input: unknown): AwaitItem[] {
  if (!Array.isArray(input)) return [];
  const out: AwaitItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 300);
    const rule = text(r.rule);
    if (!id || !rule || typeof r.at !== 'number' || !AWAIT_STATES.includes(r.state as AwaitState)) continue;
    out.push({
      id,
      at: r.at,
      fileKey: text(r.fileKey, 64),
      fileName: text(r.fileName, 200),
      node: text(r.node, 64),
      ...(r.nodeName ? { nodeName: text(r.nodeName, 200) } : {}),
      area: (text(r.area, 20) || 'check') as AwaitItem['area'],
      severity: (['blocking', 'major', 'minor'].includes(r.severity as string) ? r.severity : 'major') as Severity,
      rule,
      fix: text(r.fix),
      impact: text(r.impact),
      state: r.state as AwaitState,
      ...(typeof r.decidedAt === 'number' ? { decidedAt: r.decidedAt } : {}),
    });
  }
  return out.slice(-MAX_AWAIT);
}

/** Adds the run's findings that need a decision. A finding already on the list keeps its state; an open one gets the newer wording. */
export function addFindings(list: AwaitItem[], findings: Finding[], file: { key: string; name: string }, now = Date.now()): AwaitItem[] {
  const next = [...list];
  for (const f of findings) {
    if (!f.decide) continue;
    const id = awaitKey(file.key, f);
    const at = next.findIndex((x) => x.id === id);
    const item: AwaitItem = { id, at: now, fileKey: file.key, fileName: file.name, node: f.node, ...(f.nodeName ? { nodeName: f.nodeName } : {}), area: f.area, severity: f.severity, rule: f.rule, fix: f.fix, impact: f.decide, state: 'open' };
    if (at < 0) next.push(item);
    else if (next[at].state === 'open') next[at] = { ...item, at: next[at].at };
  }
  return next.slice(-MAX_AWAIT);
}

/** The items under "Needs your decision" in a long run report. Each keeps its node link when it has one. */
export function addQuestions(list: AwaitItem[], items: Array<{ text: string; fileKey: string; node: string }>, file: { key: string; name: string }, now = Date.now()): AwaitItem[] {
  const next = [...list];
  for (const q of items) {
    const rule = text(q.text);
    if (!rule) continue;
    const id = awaitKey(q.fileKey, { rule, node: q.node });
    if (next.some((x) => x.id === id)) continue;
    next.push({ id, at: now, fileKey: q.fileKey, fileName: q.fileKey === file.key ? file.name : '', node: q.node, area: 'long_run', severity: 'major', rule, fix: '', impact: '', state: 'open' });
  }
  return next.slice(-MAX_AWAIT);
}

/** The prompt Answer puts in the message box for a long run question. */
export const answerPrompt = (rule: string) => `About "${rule.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()}": `;

export function decide(list: AwaitItem[], id: string, state: AwaitState, now = Date.now()): AwaitItem[] {
  return list.map((x) => (x.id === id ? (state === 'open' ? { ...x, state, decidedAt: undefined } : { ...x, state, decidedAt: now }) : x));
}

/** The prompt an approval puts in the message box. It is never sent on its own. */
export function approvePrompt(item: Pick<AwaitItem, 'rule' | 'fix' | 'impact' | 'node' | 'nodeName'>, nodeUrl?: string) {
  return [
    `Fix this across the file, I approved it: ${item.rule.replace(/\.$/, '')}.`,
    `Fix: ${item.fix}`,
    `It touches: ${item.impact}`,
    `Found on ${item.nodeName ? `"${item.nodeName}" ` : ''}${nodeUrl ?? item.node}.`,
    'Plan first: list every place it changes and wait for my go. Save a version before editing.',
  ].join('\n');
}

/** How many of a run's findings still wait for her decision. Without the list (not loaded yet) every finding marked decide counts. */
export function stillAwaiting(findings: Finding[], fileKey: string | undefined, list: AwaitItem[] | null): number {
  const asked = findings.filter((f) => f.decide);
  if (!list || !fileKey) return asked.length;
  const open = new Set(list.filter((x) => x.state === 'open').map((x) => x.id));
  return asked.filter((f) => open.has(awaitKey(fileKey, f))).length;
}
