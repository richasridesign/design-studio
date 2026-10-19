import {
  CLEARANCE_LABEL, dayStart, shortDate, type Clearance, type EditRecord, type FramerConfig, type PortfolioFile, type Run, type RunState, type ScreenNote,
} from '../../../shared/portfolio';

// What the Update portfolio page shows, as pure functions over the server's view, so every line is tested.

export type Block = {
  key: string;
  label: string;
  project: { key: string; name: string };
  iteration: { id: string; title: string; frozenAt: number; adopted: boolean };
  flow: { n: number; slug: string; name: string };
  clearance: Clearance;
  frozenAt: number;
};
export type Candidate = Block & { screens: ScreenNote[] };

export type PortfolioView = {
  config: FramerConfig | null;
  canEdit: boolean;
  editReason: string;
  file: PortfolioFile;
  blocks: Block[];
  adopted: number;
  projects: Array<{ key: string; name: string; clearance: Clearance }>;
  runs: Run[];
  active: string[];
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The run the page opens on: the one she chose, else the newest that still waits for her. */
export function currentRun(runs: Run[], chosen: string | null): Run | null {
  if (chosen) return runs.find((r) => r.id === chosen) ?? null;
  return runs.find((r) => r.state !== 'done' && r.state !== 'stopped') ?? null;
}

const sinceText = (file: PortfolioFile) => (file.since ? shortDate(dayStart(file.since)) : file.lastUpdate ? shortDate(file.lastUpdate.at) : null);

/** "Found 3 frozen iterations since Mon 12 Oct: 2 projects, 4 flows." */
export function gatherLine(blocks: Block[], file: PortfolioFile): string {
  const its = new Set(blocks.map((b) => `${b.project.key}/${b.iteration.id}`)).size;
  const projects = new Set(blocks.map((b) => b.project.key)).size;
  const since = sinceText(file);
  return `Found ${plural(its, 'frozen iteration')}${since ? ` since ${since}` : ''}: ${plural(projects, 'project')}, ${plural(blocks.length, 'flow')}.`;
}

export function emptyLine(file: PortfolioFile): string {
  if (file.lastUpdate) return `No finished work since your last update on ${shortDate(file.lastUpdate.at)}. Freeze an iteration to see it here.`;
  if (file.since) return `No finished work since ${shortDate(dayStart(file.since))}. Freeze an iteration to see it here.`;
  return 'No finished work yet. Freeze an iteration to see it here.';
}

/** "3 older iterations have no history." */
export const adoptedLine = (n: number) => `${plural(n, 'older iteration')} ${n === 1 ? 'has' : 'have'} no history.`;

/** Running line for the gather and suggest steps. 2 minutes is an estimate to confirm. */
export function gatherRunning(run: Run): string {
  if (run.progress) return run.progress;
  return run.state === 'suggesting'
    ? 'Writing suggestions from your decisions and the live site, about 2 minutes. You can keep working.'
    : `Reading decisions and exporting ${run.screens ? plural(run.screens, 'screen') : 'screens'}, about 2 minutes. You can keep working.`;
}

const pagesOf = (edits: EditRecord[], state?: EditRecord['state']) =>
  [...new Set(edits.filter((e) => e.kind === 'text' && (!state || e.state === state)).map((e) => (e as { page: string }).page))];

/** "Editing 3 pages in Framer, about 30 minutes per edit. Nothing is published." 30 minutes is an estimate to confirm. */
export const editingLine = (edits: EditRecord[]) => `Editing ${plural(pagesOf(edits).length, 'page')} in Framer, about 30 minutes per edit. Nothing is published.`;

/** "Plan: 3 edits in Framer, 1 by copy and paste." */
export function planLine(edits: EditRecord[]): string {
  const text = edits.filter((e) => e.kind === 'text').length;
  const copy = edits.length - text;
  return `Plan: ${plural(text, 'edit')} in Framer${copy ? `, ${copy} by copy and paste` : ''}. Nothing is written before Go.`;
}

/** "3 edits made in Framer, not published. 1 needs copy and paste." */
export function editedLine(edits: EditRecord[]): string {
  const done = edits.filter((e) => e.kind === 'text' && e.state === 'done').length;
  const copy = edits.filter((e) => e.state === 'copy').length;
  return `${plural(done, 'edit')} made in Framer, not published.${copy ? ` ${copy} ${copy === 1 ? 'needs' : 'need'} copy and paste.` : ''}`;
}

export const listPages = (pages: string[]) => pages.join(', ');

/** "Your edits are in Framer, not live yet. Changed pages: /helpdesk-dashboard, /." */
export function publishLine(run: Run, edits: EditRecord[]): string {
  const pages = run.changed?.length ? run.changed : pagesOf(edits, 'done');
  return `Your edits are in Framer, not live yet.${pages.length ? ` Changed pages: ${listPages(pages)}.` : ''}`;
}

export function publishChangedLine(run: Run, edits: EditRecord[]): string {
  const pages = run.changed?.length ? run.changed : pagesOf(edits, 'done');
  return `Framer published during this run, so the live site now has these edits: ${pages.length ? listPages(pages) : 'none yet'}. Check it, then choose.`;
}

/** "Portfolio updated Tue 20 Oct. 3 iterations used, 2 skipped." */
export const doneLine = (run: Run) => `Portfolio updated ${shortDate(run.doneAt ?? run.startedAt)}. ${plural(run.used ?? 0, 'iteration')} used, ${run.skipped ?? 0} skipped.`;

/** The tag on a gather row, shape plus label: triangle asks, circle is cleared. */
export const clearanceTag = (c: Clearance) => ({ shape: c === 'ask' ? 'triangle' : c === 'cleared' ? 'circle' : 'square', label: CLEARANCE_LABEL[c] });

export const SHOWN_RUNS = 3;

/** The sidebar row's Count pill: frozen blocks not used or skipped yet. */
export const newCount = (v: PortfolioView | null) => v?.blocks.length ?? 0;

export const STATES_DONE: RunState[] = ['done', 'stopped'];

/** The screen name for an image, from the run's candidates. */
export function screenName(candidates: Candidate[], id: string): string {
  for (const c of candidates) for (const s of c.screens) if (s.id === id) return s.name;
  return `Screen ${id}`;
}

/** The block label of a suggestion's first source. */
export function sourceLabel(candidates: Candidate[], block: string): string {
  return candidates.find((c) => c.key === block)?.label ?? block;
}
