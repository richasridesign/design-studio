import { AREA_NAMES, PRESET_INFO, type CopyRun, type CritRun, type Finding, type ReviewDoc, type ReviewPreset, type ReviewRun } from '../../../shared/design';

export type RunRow =
  | { kind: 'review' | 'audit'; id: string; at: number; tokens: number; run: ReviewRun }
  | { kind: 'crit'; id: string; at: number; tokens: number; run: CritRun }
  | { kind: 'copy'; id: string; at: number; tokens: number; run: CopyRun };

export const KIND_LABEL: Record<RunRow['kind'], string> = { review: 'Review', audit: 'Audit', crit: 'Crit', copy: 'Copy' };

export const shownPreset = (p: ReviewPreset): 'quick' | 'full' => (p === 'full' ? 'full' : 'quick');

export const isAudit = (r: ReviewRun) => r.kind === 'audit' || r.preset === 'check';

export function mergeRuns(review: ReviewRun[], crit: CritRun[], copy: CopyRun[]): RunRow[] {
  const rows: RunRow[] = [
    ...review.map((run): RunRow => ({ kind: isAudit(run) ? 'audit' : 'review', id: run.id, at: run.at, tokens: run.tokens, run })),
    ...crit.map((run): RunRow => ({ kind: 'crit', id: run.id, at: run.at, tokens: run.tokens, run })),
    ...copy.map((run): RunRow => ({ kind: 'copy', id: run.id, at: run.at, tokens: run.tokens, run })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function summarize(row: RunRow): string {
  if (row.kind === 'crit') return plural(row.run.personas.reduce((n, p) => n + p.points.length, 0), 'note');
  if (row.kind === 'copy') return plural(row.run.items.length, 'change');
  const findings = [...row.run.check, ...row.run.results.flatMap((r) => r.findings)];
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  const major = findings.filter((f) => f.severity === 'major').length;
  return blocking || major ? `${blocking} blocking, ${major} major` : 'No issues';
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  for (const [n, unit] of [[86400 * 7, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']] as const) if (s >= n) return `${Math.floor(s / n)}${unit} ago`;
  return 'just now';
}

export const runLabel = (run: ReviewRun) => (run.kind === 'audit' ? 'File audit' : run.kind === 'verify' ? 'Final check' : `Review ${run.round} · ${PRESET_INFO[run.preset].label}`);

export const unposted = (run: ReviewRun, doc: ReviewDoc): Finding[] => [...run.check, ...run.results.flatMap((r) => r.findings)].filter((f) => !doc.posted?.includes(f.id) && f.severity !== 'minor');

export function areaRows(run: ReviewRun): Array<{ key: string; name: string; pass: boolean; failed: boolean }> {
  return [
    { key: 'check', name: 'Design system check', pass: !run.checkError && !run.check.some((f) => f.severity !== 'minor'), failed: !!run.checkError },
    ...run.results.map((r) => ({ key: r.area, name: r.area === 'all' ? 'All areas' : AREA_NAMES[r.area], pass: r.pass, failed: !!r.error })),
  ];
}

export const canGoDeeper = (run: ReviewRun) => run.preset === 'quick' || run.preset === 'check';

export const retryPrompt = (run: ReviewRun) => (areaRows(run).some((a) => a.failed) ? `/review ${run.preset} ${run.frames.join(' ')}` : null);

export function isStale(run: Pick<ReviewRun, 'at'>, lastModified: string | null | undefined, latestAt: number): boolean {
  const t = lastModified ? Date.parse(lastModified) : NaN;
  return run.at === latestAt && !Number.isNaN(t) && t > run.at;
}
