import { parkedRules, type Scope } from './scope.js';
import type { TriageEntry } from './triage.js';

export type RuleState = 'pass' | 'fail' | 'unchecked';
/** triage is set on a failed rule the designer resolved by hand (see openRun). It is never stored in review.json. */
export type RuleResult = { rule: string; state: RuleState; frames: string[]; triage?: TriageEntry };

export const MAX_CHECKED_RULES = 40;

const BULLET = /^(?:[-*+•]\s*(?:\[[ xX]?\]\s*)?|\d{1,3}[.)]\s+)/;

// One rule per non-empty line. Bullets and numbers are stripped, headings are skipped, repeats are dropped.
export function parseRules(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const rule = line.replace(BULLET, '').trim();
    if (rule && !out.includes(rule)) out.push(rule);
  }
  return out;
}

// Parked features join the rules, so every review checks they stay out.
export const allRules = (r: { global: string; file: string; scope?: Scope }) => [...new Set([...parseRules(r.global), ...parseRules(r.file), ...parkedRules(r.scope)])];

const ID = /^I?\d+[:-]\d+(?:;\d+[:-]\d+)*$/;
const toId = (s: string) => s.trim().replace(/-/g, ':');

// Maps the reviewer's verdicts back onto the rules by number. Missing or bad verdicts stay "not checked".
export function ruleResults(rules: string[], raw: unknown, frames: string[]): RuleResult[] {
  const out: RuleResult[] = rules.map((rule) => ({ rule, state: 'unchecked', frames: [] }));
  if (!Array.isArray(raw)) return out;
  const seen = new Set<number>();
  for (const item of raw) {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > Math.min(rules.length, MAX_CHECKED_RULES) || seen.has(n)) continue;
    const state = item.state === 'pass' || item.state === 'fail' ? item.state : null;
    if (!state) continue;
    seen.add(n);
    const ids = Array.isArray(item.frames) ? item.frames.filter((f: unknown): f is string => typeof f === 'string' && ID.test(f.trim())).map(toId) : [];
    out[n - 1] = { rule: rules[n - 1], state, frames: state === 'fail' ? [...new Set(ids as string[])].filter((id) => frames.includes(id)) : [] };
  }
  return out;
}

/** failed counts only rules still open; a failed rule resolved by hand counts as resolved. */
export function rulesSummary(results: RuleResult[]) {
  const passed = results.filter((r) => r.state === 'pass').length;
  const resolved = results.filter((r) => r.state === 'fail' && r.triage).length;
  const failed = results.filter((r) => r.state === 'fail' && !r.triage).length;
  return { passed, failed, resolved, unchecked: results.length - passed - failed - resolved, total: results.length };
}

export function rulesLine(results: RuleResult[]) {
  const s = rulesSummary(results);
  return `${s.passed} of ${s.total} passed${s.resolved ? `, ${s.resolved} resolved by hand` : ''}${s.unchecked ? `, ${s.unchecked} not checked` : ''}`;
}
