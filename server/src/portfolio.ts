import path from 'node:path';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import {
  PORTFOLIO_FOLDER, SITE_PAGES, blockKey, blockLabel, blockOutcome, cleanConfig, cleanPortfolio, cleanSite, cleanSuggestions, dayStart, decisionsOf,
  changedPages, findFlags, hideNames, isNew, isRunId, isRunning, mergeFlags, pickOf, pickSummary, keyError, projectLinkError, publishLine, publishMoved, runBlock, runId, siteError,
  upsertRunBlock, usedLine,
  type BlockRef, type Clearance, type EditPlanItem, type EditRecord, type PublishReading, type FlagKind, type FramerConfig, type PickEntry, type Picks, type PortfolioFile, type Run, type RunState, type ScreenNote, type Suggestion,
} from '../../shared/portfolio.js';
import type { Flow, Iteration, Project } from '../../shared/project.js';
import { decisionTimes } from '../../shared/history.js';
import { projectsRoot } from './settings.js';
import { chatFolders } from './figma.js';
import { iterationDir, readProject } from './project.js';
import { historyFile, recordDone, syncDecisions } from './history.js';
import { pluginShots, type ReadDeps } from './pluginRead.js';
import { cleanChromePlan, cleanEditReport, editInChrome, plan as planTurn, suggest, type BrowserTools, type ChatDeps } from './portfolioChat.js';
import { BrowserPending, CHROME_EDITS_READY, checkChrome, pendingBrowser, projectId, readPublish, watchPublish, type FramerBrowser } from './portfolioChrome.js';
import { deleteKey, hasKey, readKey, saveKey, type KeyDeps } from './framerKey.js';
import { projectInfo, type Connect } from './framer.js';

// Update portfolio, on the server: the portfolio folder, finding finished work, a run (gather, suggest, pick, copy
// pack or Framer edits) and what is recorded afterwards. Reads only project folders in the roots (project.json and
// each flow's history.md, Decisions part only), Figma read-only, and the public pages of the site. Never chat
// transcripts, never anything else in the workspace.

export class PortfolioError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type PortfolioDeps = {
  figma?: ReadDeps; fetch?: typeof fetch; chat?: ChatDeps; browser?: FramerBrowser; browserTools?: BrowserTools; pollMs?: number; now?: () => Date;
  /** The Keychain (security) and the Framer API connection, faked in tests. */
  keychain?: KeyDeps; framerConnect?: Connect;
};
/** Tests swap these. The real ones refuse to run under vitest. */
export const portfolioDeps: PortfolioDeps = {};

const now = () => (portfolioDeps.now ? portfolioDeps.now() : new Date());

export const portfolioDir = () => path.join(projectsRoot(), PORTFOLIO_FOLDER);
const runsDir = () => path.join(portfolioDir(), 'runs');
export function runDir(id: string) {
  if (!isRunId(id)) throw new PortfolioError('There is no such run', 404);
  return path.join(runsDir(), id);
}

// ---------- Files ----------

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

const queues = new Map<string, Promise<unknown>>();
/** One writer per file, so two steps never lose each other's change. */
function queued<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(file, next);
  return next;
}

const portfolioFile = () => path.join(portfolioDir(), 'portfolio.json');
const configFile = () => path.join(portfolioDir(), 'framer.json');
const portfolioHistory = () => path.join(portfolioDir(), 'history.md');

export const readPortfolio = async () => cleanPortfolio(await readJson(portfolioFile(), {}));
export function updatePortfolio(fn: (f: PortfolioFile) => void): Promise<PortfolioFile> {
  return queued(portfolioFile(), async () => {
    const f = await readPortfolio();
    fn(f);
    const clean = cleanPortfolio(f);
    await writeJson(portfolioFile(), clean);
    return clean;
  });
}

export const readConfig = async () => cleanConfig(await readJson(configFile(), null));

// ---------- Finished work ----------

type Found = BlockRef & { frozenAt: number; dir: string; figmaKey: string; flowRef: Flow; itRef: Iteration };

/** "Fri 9 Oct", or null. */
const sinceOf = (file: PortfolioFile, p: Project) => (file.since ? dayStart(file.since) : p.adoptedAt ?? 0);

/**
 * Frozen iteration x flow blocks not used or skipped yet (or frozen again since). A flow belongs to an iteration when
 * the iteration lists it or the flow's history has a block for it. "Never" projects are not read at all. Adopted
 * iterations (no history of their own) are counted, and only read when she includes them.
 */
export async function findBlocks(file: PortfolioFile): Promise<{ blocks: Found[]; adopted: number; projects: Array<{ key: string; name: string; clearance: Clearance }> }> {
  const blocks: Found[] = [];
  const projects: Array<{ key: string; name: string; clearance: Clearance }> = [];
  let adopted = 0;
  for (const f of await chatFolders()) {
    if (!f.figma) continue;
    const project = await readProject(f.dir);
    if (!project) continue;
    const clearance = file.clearance[project.key] ?? 'ask';
    projects.push({ key: project.key, name: f.figma.name, clearance });
    if (clearance === 'never') continue;
    const since = sinceOf(file, project);
    const md = new Map<string, string>();
    const history = async (flow: Flow) => {
      if (!md.has(flow.slug)) md.set(flow.slug, await readFile(historyFile(f.dir, flow), 'utf8').catch(() => ''));
      return md.get(flow.slug) as string;
    };
    for (const it of project.iterations) {
      if (it.state !== 'frozen') continue;
      const frozenAt = it.frozenAt ?? it.createdAt ?? project.adoptedAt ?? 0;
      if (it.adopted && !file.includeAdopted) {
        if (project.flows.some((fl) => isNew(file, blockKey(project.key, it.id, fl.slug), frozenAt))) adopted++;
        continue;
      }
      if (!it.adopted && frozenAt < since) continue;
      for (const flow of project.flows) {
        const listed = !!it.flows?.[flow.slug] || (await history(flow)).includes(`<!-- ds:iteration ${it.id} -->`);
        if (!listed) continue;
        const key = blockKey(project.key, it.id, flow.slug);
        if (!isNew(file, key, frozenAt)) continue;
        blocks.push({
          key, clearance, frozenAt, dir: f.dir, figmaKey: project.key, flowRef: flow, itRef: it,
          project: { key: project.key, name: f.figma.name, root: f.dir },
          iteration: { id: it.id, title: [it.id, it.topic].filter(Boolean).join(' · '), frozenAt, adopted: !!it.adopted },
          flow: { n: flow.n, slug: flow.slug, name: flow.name },
        });
      }
    }
  }
  return { blocks, adopted, projects };
}

const publicBlock = (b: Found) => ({ key: b.key, label: blockLabel(b), project: { key: b.project.key, name: b.project.name }, iteration: b.iteration, flow: b.flow, clearance: b.clearance, frozenAt: b.frozenAt });
export type PublicBlock = ReturnType<typeof publicBlock>;

// ---------- The live site ----------

/** Visible text of a page: headings marked, scripts, styles and markup gone. */
export function htmlText(html: string): string {
  const ent: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, k) => ent[k])
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000);
}

const siteSlug = (p: string) => (p === '/' ? 'home' : p.slice(1).replace(/[^a-z0-9.-]/gi, '-'));

/** Under this many characters a page read by plain GET is taken as empty (the site renders in the browser). */
const THIN = 200;

/**
 * Plain GETs of the known public pages, no login, never following a link to another host. A page that comes back
 * empty or thin is read again rendered, in the browser, when one is available.
 */
export async function fetchSite(site: string, dir: string, doFetch?: typeof fetch, rendered?: (url: string) => Promise<string>): Promise<{ read: number; failed: string[] }> {
  const get = doFetch ?? (process.env.VITEST ? null : fetch);
  if (!get) throw new Error('Tests must not reach the site');
  const host = cleanSite(site);
  await mkdir(dir, { recursive: true });
  let read = 0;
  const failed: string[] = [];
  for (const page of SITE_PAGES) {
    try {
      const res = await get(`https://${host}${page.path}`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      const final = new URL(res.url || `https://${host}${page.path}`).hostname;
      if (final !== host && final !== `www.${host}`) throw new Error('moved to another site');
      if (!res.ok) throw new Error(`status ${res.status}`);
      let text = htmlText((await res.text()).slice(0, 3_000_000));
      if (text.length < THIN && rendered) text = htmlText(await rendered(`https://${host}${page.path}`).catch(() => text));
      await writeFile(path.join(dir, `${siteSlug(page.path)}.txt`), `${page.title} (${page.path})\n\n${text}\n`);
      read++;
    } catch {
      const text = rendered ? await rendered(`https://${host}${page.path}`).catch(() => '') : '';
      if (text) {
        await writeFile(path.join(dir, `${siteSlug(page.path)}.txt`), `${page.title} (${page.path})\n\n${htmlText(text)}\n`);
        read++;
      } else failed.push(page.path);
    }
  }
  return { read, failed };
}

// ---------- Runs ----------

const runFile = (id: string) => path.join(runDir(id), 'run.json');
const active = new Map<string, AbortController>();

export type Candidate = PublicBlock & { screens: ScreenNote[] };

export async function readRun(id: string): Promise<Run> {
  const run = await readJson<Run | null>(runFile(id), null);
  if (!run) throw new PortfolioError('There is no such run', 404);
  // A step that was running when the server stopped will not finish.
  if (isRunning(run.state) && !active.has(id)) {
    const failed: Record<string, RunState> = { gathering: 'gather-failed', suggesting: 'suggest-failed', planning: 'plan-failed', editing: 'edit-failed' };
    return { ...run, state: failed[run.state], error: 'Design Studio restarted during this step. Nothing was published.' };
  }
  return run;
}

function updateRun(id: string, patch: Partial<Run>): Promise<Run> {
  return queued(runFile(id), async () => {
    const run = { ...(await readJson<Run>(runFile(id), {} as Run)), ...patch };
    for (const k of Object.keys(patch) as Array<keyof Run>) if (patch[k] === undefined) delete run[k];
    await writeJson(runFile(id), run);
    return run;
  });
}

export async function listRuns(limit = 10): Promise<Run[]> {
  const ids = (await readdir(runsDir()).catch(() => [] as string[])).filter(isRunId).sort().reverse().slice(0, limit);
  const out: Run[] = [];
  for (const id of ids) out.push(await readRun(id).catch(() => null as unknown as Run));
  return out.filter(Boolean);
}

const shotName = (id: string) => `${id.replace(/:/g, '-')}.png`;

/** Reads the picked blocks: decisions (syncing a never-read one from Figma), screens and the site. */
async function gather(id: string, found: Found[], signal: AbortSignal) {
  const dir = runDir(id);
  const notes: string[] = [];
  let figmaError = '';
  const candidates: Candidate[] = [];
  for (const b of found) {
    const cwd = iterationDir(b.dir, b.flowRef, b.itRef.id);
    const file = historyFile(b.dir, b.flowRef);
    let md = await readFile(file, 'utf8').catch(() => '');
    if (decisionTimes(md, b.itRef.id).synced === null) {
      try {
        await syncDecisions(cwd, portfolioDeps.figma);
        md = await readFile(file, 'utf8').catch(() => '');
      } catch (e) {
        figmaError = e instanceof Error ? e.message : String(e);
      }
    }
    if (signal.aborted) return null;
    candidates.push({ ...publicBlock(b), screens: decisionsOf(md, b.itRef.id) });
  }
  const decisions = candidates.reduce((n, c) => n + c.screens.length, 0);
  if (!decisions) {
    throw new PortfolioError(figmaError ? `Could not read Figma: ${figmaError}. Nothing was changed.` : 'These blocks have no decisions yet. Add Decision stickies in Figma, then try again.');
  }
  if (figmaError) notes.push('Some decisions could not be read from Figma, so those flows are left out.');
  await writeJson(path.join(dir, 'candidates.json'), candidates);

  // Screens, best effort: suggestions still work from the decisions alone.
  const byFile = new Map<string, string[]>();
  for (const c of candidates) for (const s of c.screens) if (s.id) byFile.set(c.project.key, [...(byFile.get(c.project.key) ?? []), s.id]);
  const screens = [...byFile.values()].reduce((n, l) => n + l.length, 0);
  await updateRun(id, { screens, progress: 'reading' });
  try {
    const shots = path.join(dir, 'shots');
    await mkdir(shots, { recursive: true });
    for (const [key, ids] of byFile) {
      const urls = await pluginShots(key, ids.slice(0, 24), 1600, { dir: found.find((b) => b.figmaKey === key)!.dir, signal, ...portfolioDeps.figma });
      for (const [node, url] of Object.entries(urls)) {
        if (!url) continue;
        const res = await (portfolioDeps.fetch ?? fetch)(url, { signal });
        if (res.ok) await writeFile(path.join(shots, shotName(node)), Buffer.from(await res.arrayBuffer()));
      }
    }
  } catch (e) {
    if (signal.aborted) return null;
    notes.push(`Screens were not exported (${e instanceof Error ? e.message : String(e)}), so suggestions use the decisions only.`);
  }
  const config = await readConfig();
  const site = await fetchSite(config?.site ?? 'richadesign.in', path.join(dir, 'site'), portfolioDeps.fetch, (url) => browser().pageText(url)).catch(() => ({ read: 0, failed: SITE_PAGES.map((p) => p.path) }));
  if (site.failed.length) notes.push(site.read ? `Could not read ${site.failed.join(', ')} on the site.` : 'Could not read the live site, so suggestions may repeat what it says.');
  return { candidates, note: notes.join(' ') };
}

const projectNames = (c: Candidate[]): Array<{ name: string; kind: FlagKind }> => [...new Set(c.map((x) => x.project.name))].map((name) => ({ name, kind: 'product' as const }));

/** Claude's raw suggestions, cleaned, with names hidden for "Cleared, hide names" projects. */
export function finishSuggestions(raw: unknown, candidates: Candidate[]): Suggestion[] {
  const names = projectNames(candidates);
  const list = cleanSuggestions(raw, candidates.map((c) => ({ key: c.key, screens: c.screens.map((s) => s.id).filter((x): x is string => !!x) })), names);
  const cleared = new Set(candidates.filter((c) => c.clearance === 'cleared').map((c) => c.key));
  return list.map((s) => {
    if (!s.sources.some((x) => cleared.has(x.block))) return s;
    const draft = hideNames(s.draft, s.flags);
    return { ...s, draft, flags: findFlags(draft, names).length ? mergeFlags([], findFlags(draft, names)) : s.flags.filter((f) => f.kind === 'number' && draft.includes(f.text)) };
  });
}

async function pipeline(id: string, found: Found[] | null) {
  const abort = new AbortController();
  active.set(id, abort);
  try {
    let candidates: Candidate[];
    if (found) {
      const g = await gather(id, found, abort.signal);
      if (!g) return;
      candidates = g.candidates;
      await updateRun(id, { state: 'suggesting', progress: undefined, note: g.note || undefined });
    } else {
      candidates = await readJson<Candidate[]>(path.join(runDir(id), 'candidates.json'), []);
      await updateRun(id, { state: 'suggesting', error: undefined });
    }
    let raw: unknown[];
    try {
      raw = (await suggest(runDir(id), candidates.length, portfolioDeps.chat, abort.signal)).raw;
    } catch (e) {
      if (abort.signal.aborted) return;
      await updateRun(id, { state: 'suggest-failed', error: `Claude could not suggest updates: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    if (abort.signal.aborted) return;
    const list = finishSuggestions(raw, candidates);
    await writeJson(path.join(runDir(id), 'suggestions.json'), list);
    await updateRun(id, { state: 'picking' });
  } catch (e) {
    if (abort.signal.aborted) return;
    await updateRun(id, { state: 'gather-failed', progress: undefined, error: e instanceof Error ? e.message : String(e) });
  } finally {
    active.delete(id);
  }
}

/** Starts a run on the ticked blocks. Returns at once; the run moves on in the background and the view polls. */
export async function startRun(keys: string[]): Promise<Run> {
  const config = await readConfig();
  if (!config) throw new PortfolioError('Connect your portfolio first');
  const { blocks } = await findBlocks(await readPortfolio());
  const found = blocks.filter((b) => keys.includes(b.key));
  if (!found.length) throw new PortfolioError('Tick at least one block of finished work');
  if ([...active.keys()].length) throw new PortfolioError('A run is already going. Stop it or wait for it to finish', 409);
  const id = runId(now());
  const run: Run = { id, state: 'gathering', startedAt: now().getTime(), blocks: found.map((b) => b.key), mode: config.mode };
  await mkdir(runDir(id), { recursive: true });
  await writeJson(runFile(id), run);
  void pipeline(id, found);
  return run;
}

export async function retryRun(id: string): Promise<Run> {
  const run = await readRun(id);
  if (run.state === 'suggest-failed') {
    await updateRun(id, { state: 'suggesting', error: undefined });
    void pipeline(id, null);
    return { ...run, state: 'suggesting', error: undefined };
  }
  if (run.state === 'gather-failed' || run.state === 'stopped') {
    const { blocks } = await findBlocks(await readPortfolio());
    const found = blocks.filter((b) => run.blocks.includes(b.key));
    if (!found.length) throw new PortfolioError('This work was used or skipped in another run');
    await updateRun(id, { state: 'gathering', error: undefined, note: undefined });
    void pipeline(id, found);
    return { ...run, state: 'gathering', error: undefined };
  }
  if (run.state === 'plan-failed') return makePlan(id);
  throw new PortfolioError('This run has nothing to try again', 409);
}

export async function stopRun(id: string): Promise<Run> {
  const run = await readRun(id);
  active.get(id)?.abort();
  active.delete(id);
  if (run.state === 'gathering' || run.state === 'suggesting') return updateRun(id, { state: 'stopped', progress: undefined, error: undefined });
  if (run.state === 'planning') return updateRun(id, { state: 'picking' });
  return run;
}

// ---------- Picks ----------

const picksFile = (id: string) => path.join(runDir(id), 'picks.json');
const suggestionsOf = (id: string) => readJson<Suggestion[]>(path.join(runDir(id), 'suggestions.json'), []);
const candidatesOf = (id: string) => readJson<Candidate[]>(path.join(runDir(id), 'candidates.json'), []);
const editsOf = (id: string) => readJson<EditRecord[]>(path.join(runDir(id), 'edits.json'), []);
export const readPicks = async (id: string) => readJson<Picks>(picksFile(id), {});

/** Autosave of her picks, ticks and drafts: only known suggestions and their own screens are kept. */
export async function savePicks(id: string, input: unknown): Promise<Picks> {
  const run = await readRun(id);
  if (run.state !== 'picking') throw new PortfolioError('Picks are fixed once the edits start', 409);
  const list = await suggestionsOf(id);
  const o = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const out: Picks = {};
  for (const s of list) {
    const p = o[s.id];
    if (!p || typeof p !== 'object') continue;
    const choice = ['use', 'skip', 'later'].includes(p.choice) ? p.choice : null;
    out[s.id] = {
      choice,
      draft: typeof p.draft === 'string' ? p.draft.slice(0, 4000) : s.draft,
      images: (Array.isArray(p.images) ? p.images : []).map(String).filter((x: string) => s.images.includes(x)),
      cleared: p.cleared === true,
    } satisfies PickEntry;
  }
  return queued(picksFile(id), async () => {
    await writeJson(picksFile(id), out);
    return out;
  });
}

async function ready(id: string) {
  const [list, picks] = await Promise.all([suggestionsOf(id), readPicks(id)]);
  const sum = pickSummary(list, picks);
  if (sum.blocker) throw new PortfolioError(sum.blocker, 409);
  return { list, picks };
}

/** Copy and paste: the picks become the copy pack. */
export async function toCopy(id: string): Promise<Run> {
  const run = await readRun(id);
  if (run.state !== 'picking') throw new PortfolioError('This run is past picking', 409);
  await ready(id);
  return updateRun(id, { state: 'copy' });
}

/** Back to the picks from the copy pack or the plan. Nothing in Framer changed yet. */
export async function backToPicks(id: string): Promise<Run> {
  const run = await readRun(id);
  if (!['copy', 'plan', 'plan-failed'].includes(run.state)) throw new PortfolioError('This run cannot go back to the picks', 409);
  return updateRun(id, { state: 'picking', error: undefined });
}

/** Skips blocks without a run: marks them so the next gather does not offer them. */
export async function skipBlocks(keys: string[], why?: string): Promise<PortfolioFile> {
  const { blocks } = await findBlocks(await readPortfolio());
  const at = runId(now());
  return updatePortfolio((f) => {
    for (const b of blocks) if (keys.includes(b.key)) f.skipped[b.key] = { frozenAt: b.frozenAt, run: at, ...(why ? { why } : {}) };
  });
}

// ---------- Recording ----------

/**
 * Used and skipped blocks go to portfolio.json, one line goes to each source flow's history, and the run's block to
 * the portfolio history. Safe to call twice (edits landed, then published).
 */
async function record(id: string, published: boolean) {
  const [run, list, picks, candidates, edits] = await Promise.all([readRun(id), suggestionsOf(id), readPicks(id), candidatesOf(id), editsOf(id)]);
  const outcome = blockOutcome(list, picks, run.blocks);
  const at = now();
  // The flow history lines are written once per run: edits landed first, then "I published it" only updates the marks.
  const firstTime = (await readPortfolio()).used[run.blocks.find((k) => outcome[k] === 'used') ?? '']?.run !== id;
  await updatePortfolio((f) => {
    for (const c of candidates) {
      if (outcome[c.key] === 'used') f.used[c.key] = { frozenAt: c.frozenAt, run: id, state: published ? 'published' : 'edited' };
      if (outcome[c.key] === 'skipped') f.skipped[c.key] = { frozenAt: c.frozenAt, run: id };
    }
    f.lastUpdate = { at: at.getTime(), run: id };
  });
  if (firstTime) {
    for (const c of candidates) {
      if (outcome[c.key] !== 'used') continue;
      const used = list.filter((s) => pickOf(picks, s).choice === 'use' && s.sources.some((x) => x.block === c.key));
      const found = (await chatFolders()).find((f) => f.figma?.key === c.project.key);
      if (!found) continue;
      const p = await readProject(found.dir);
      const flow = p?.flows.find((fl) => fl.slug === c.flow.slug);
      if (flow) await recordDone(iterationDir(found.dir, flow, c.iteration.id), usedLine(used), at).catch(() => false);
    }
  }
  const usedN = run.blocks.filter((k) => outcome[k] === 'used').length;
  const skippedN = run.blocks.filter((k) => outcome[k] === 'skipped').length;
  const done = { ...run, published };
  const block = runBlock(done, list, picks, candidates.map((c) => ({ key: c.key, label: c.label })), edits, at);
  await queued(portfolioHistory(), async () => {
    const md = await readFile(portfolioHistory(), 'utf8').catch(() => '');
    await mkdir(portfolioDir(), { recursive: true });
    await writeFile(portfolioHistory(), upsertRunBlock(md, id, block));
  });
  return { used: usedN, skipped: skippedN };
}

/** "I pasted it" (copy pack), "I published it" (Framer edits) or "Keep them" (publish changed): the run is done. */
export async function finishRun(id: string): Promise<Run> {
  const run = await readRun(id);
  // publish-changed: Framer published the edits without her, she checked the live site and keeps them.
  if (run.state !== 'copy' && run.state !== 'edited' && run.state !== 'publish-changed') throw new PortfolioError('This run is not ready to finish', 409);
  const published = run.state !== 'copy';
  const r = await record(id, published);
  return updateRun(id, { state: 'done', doneAt: now().getTime(), published, used: r.used, skipped: r.skipped });
}

// ---------- Framer edits, in her Chrome ----------

const browser = () => portfolioDeps.browser ?? pendingBrowser;

/** Edits in Chrome need a browser tool the portfolio chat can reach. Until Phase 0 picks it, runs end in the copy pack. */
export const canEdit = async () => {
  const config = await readConfig();
  if (!config || config.mode === 'copy' || !config.project) return { ok: false, reason: 'Copy and paste mode: you paste the copy in Framer yourself.' };
  // With a key the edits still go through her Chrome for now: the API edit route waits for the Phase 0 spike.
  if (!portfolioDeps.browserTools && !CHROME_EDITS_READY) return { ok: false, reason: new BrowserPending().message };
  return { ok: true, reason: '' };
};

async function chromeProject(): Promise<string> {
  const config = await readConfig();
  if (!config || config.mode === 'copy' || !config.project) throw new PortfolioError('Connect Framer in your Chrome to make edits there');
  const tab = await checkChrome(browser(), config.project);
  if (!tab.ok) throw new PortfolioError(tab.reason ?? 'Chrome is not showing this Framer project. Open it there, signed in.');
  return config.project;
}

/** Claude plans from her final copy and the live site. Nothing is written. */
export async function makePlan(id: string): Promise<Run> {
  const run = await readRun(id);
  if (run.state !== 'picking' && run.state !== 'plan-failed') throw new PortfolioError('This run is past picking', 409);
  const { list, picks } = await ready(id);
  const can = await canEdit();
  if (!can.ok) throw new PortfolioError(can.reason, 409);
  await updateRun(id, { state: 'planning', error: undefined });
  const abort = new AbortController();
  active.set(id, abort);
  void (async () => {
    try {
      const used = list.filter((x) => pickOf(picks, x).choice === 'use');
      await writeJson(path.join(runDir(id), 'picked.json'), used.map((x) => ({ suggestion: x.id, page: x.page, section: x.section, what: x.what, copy: pickOf(picks, x).draft })));
      const site: Record<string, string> = {};
      for (const p of SITE_PAGES) site[p.path] = await readFile(path.join(runDir(id), 'site', `${siteSlug(p.path)}.txt`), 'utf8').catch(() => '');
      const r = await planTurn(runDir(id), portfolioDeps.chat, abort.signal);
      if (abort.signal.aborted) return;
      const items = cleanChromePlan(r.raw, site, used);
      await writeJson(path.join(runDir(id), 'plan.json'), items);
      await writeJson(path.join(runDir(id), 'edits.json'), items.map((p) => ({ ...p, state: p.kind === 'copy' ? 'copy' : 'waiting' })));
      await updateRun(id, { state: 'plan' });
    } catch (e) {
      if (!abort.signal.aborted) await updateRun(id, { state: 'plan-failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      active.delete(id);
    }
  })();
  return { ...run, state: 'planning' };
}

const touchedPages = (records: EditRecord[]) => [...new Set(records.filter((e) => e.kind === 'text' && e.state === 'done').map((e) => (e as { page: string }).page))];

/**
 * Go. The Publish panel is read first (publish-before.json), then Claude edits in her Chrome while the panel is
 * watched: a publish she did not make stops the run at once. Afterwards the panel is read again
 * (publish-after.json) and gives the changed pages. Design Studio never publishes.
 */
export async function applyRun(id: string): Promise<Run> {
  const run = await readRun(id);
  if (run.state !== 'plan' && run.state !== 'edit-failed') throw new PortfolioError('There is no plan to apply', 409);
  const project = await chromeProject();
  const all = await editsOf(id);
  const kept = all.filter((e) => e.state === 'done');
  const todo = all.filter((e) => e.state !== 'done' && e.state !== 'undone').map(({ state: _s, error: _e, ...p }) => p as EditPlanItem);
  const before = await readPublish(browser(), project, now().getTime()).catch((e) => {
    throw new PortfolioError(`Could not read the Publish panel in Framer, so nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
  });
  await writeJson(path.join(runDir(id), 'publish-before.json'), before);
  await writeJson(path.join(runDir(id), 'plan.json'), todo);
  await updateRun(id, { state: 'editing', error: undefined, publishBefore: publishLine(before) });
  const abort = new AbortController();
  active.set(id, abort);
  let moved: PublishReading | null = null;
  const stopWatch = watchPublish(browser(), project, before, portfolioDeps.pollMs ?? 20_000, (after) => {
    moved = after;
    abort.abort();
  });
  void (async () => {
    let records: EditRecord[] = todo.map((p) => ({ ...p, state: p.kind === 'copy' ? 'copy' : 'waiting' }));
    let error: string | null = null;
    try {
      const raw = await editInChrome(runDir(id), portfolioDeps.browserTools ?? null, portfolioDeps.chat, abort.signal);
      records = cleanEditReport(raw, todo);
      error = records.find((r) => r.state === 'failed')?.error ?? (records.some((r) => r.state === 'failed') ? 'An edit did not go in' : null);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      stopWatch();
    }
    try {
      const done = [...kept, ...records];
      await writeJson(path.join(runDir(id), 'edits.json'), done);
      const after = moved ?? (await readPublish(browser(), project, now().getTime()).catch(() => null));
      if (after) await writeJson(path.join(runDir(id), 'publish-after.json'), after);
      const pages = after ? changedPages(before, after, touchedPages(done)) : { changed: touchedPages(done), outside: [] };
      if (after && publishMoved(before, after)) {
        await updateRun(id, { state: 'publish-changed', error: undefined, ...pages, changed: touchedPages(done), publishAfter: publishLine(after), warnings: after.warnings });
        return;
      }
      if (error) {
        await updateRun(id, { state: 'edit-failed', error, ...pages, ...(after ? { publishAfter: publishLine(after), warnings: after.warnings } : {}) });
        return;
      }
      await updateRun(id, { state: 'edited', ...pages, ...(after ? { publishAfter: publishLine(after), warnings: after.warnings } : {}) });
      active.delete(id);
      await record(id, false);
    } finally {
      active.delete(id);
    }
  })();
  return { ...run, state: 'editing' };
}

/** Undo all: Claude puts back the old text it read before each edit, the same careful way. Back to picking. */
export async function undoRun(id: string): Promise<Run> {
  const run = await readRun(id);
  if (!['edited', 'edit-failed', 'publish-changed'].includes(run.state)) throw new PortfolioError('There is nothing to undo', 409);
  await chromeProject();
  const records = await editsOf(id);
  const back: EditPlanItem[] = records.filter((r) => r.kind === 'text' && r.state === 'done').map((r) => ({ ...(r as Extract<EditPlanItem, { kind: 'text' }>), old: (r as any).text, text: (r as any).old }));
  if (!back.length) return updateRun(id, { state: 'picking' });
  await writeJson(path.join(runDir(id), 'plan.json'), back);
  const raw = await editInChrome(runDir(id), portfolioDeps.browserTools ?? null, portfolioDeps.chat);
  const report = cleanEditReport(raw, back);
  const undone = new Set(report.filter((r) => r.state === 'done').map((r) => r.id));
  await writeJson(path.join(runDir(id), 'edits.json'), records.map((r) => (undone.has(r.id) ? { ...r, state: 'undone' } : r)));
  await updatePortfolio((f) => {
    for (const [k, v] of Object.entries(f.used)) if (v.run === id) delete f.used[k];
  });
  if (undone.size < back.length) return updateRun(id, { state: 'edit-failed', error: `${back.length - undone.size} of ${back.length} could not be put back. Site settings, Versions in Framer has the older text.` });
  return updateRun(id, { state: 'picking', error: undefined, changed: undefined, outside: undefined });
}

// ---------- Setup ----------

export type SetupInput = { project?: string; site?: string; mode?: 'chrome' | 'copy' | 'api'; key?: string };

const keyAccount = (project: string) => {
  const id = projectId(project);
  if (!id) throw new PortfolioError('This is not a Framer project link');
  return id;
};

/**
 * Chrome: checks the project is open in her Chrome, signed in. Copy: the site only. API: the key is checked with
 * Framer first (Check key), then saved in the Keychain; framer.json only says hasKey. A key that fails leaves the
 * saved setup as it was, so Chrome stays the route.
 */
export async function setup(input: SetupInput): Promise<FramerConfig> {
  const mode = input.mode === 'copy' ? 'copy' : input.mode === 'api' ? 'api' : 'chrome';
  const site = cleanSite(String(input.site ?? ''));
  const project = String(input.project ?? '').trim();
  const fieldErr = siteError(site) || (mode !== 'copy' || project ? projectLinkError(project) : '');
  if (fieldErr) throw new PortfolioError(fieldErr);
  const before = await readConfig();
  const keptKey = !!before?.hasKey && before.project === project;
  if (mode === 'api') {
    const typed = String(input.key ?? '');
    if (!typed.trim() && !keptKey) throw new PortfolioError('Paste the API key');
    await checkKey({ project, key: typed.trim() ? typed : undefined }, true);
    if (typed.trim()) await saveKey(keyAccount(project), typed, keyDeps()).catch(() => { throw new PortfolioError('The Keychain did not save the key. Nothing was changed.', 500); });
  }
  if (mode === 'chrome') {
    const tab = await checkChrome(browser(), project);
    if (!tab.ok) throw new PortfolioError(tab.reason ?? 'Chrome is not showing this Framer project. Open it there, signed in.');
  }
  const config: FramerConfig = { site, project, mode, ...(mode === 'api' || keptKey ? { hasKey: true } : {}) };
  await writeJson(configFile(), config);
  return config;
}

const keyDeps = (): KeyDeps => portfolioDeps.keychain ?? {};

/**
 * Check key: connect, read the project name, disconnect. With no key typed it checks the one in the Keychain.
 * The key is never in the answer or the error.
 */
export async function checkKey(input: { project?: string; key?: string }, raise = false): Promise<{ ok: boolean; name?: string; error?: string }> {
  const project = String(input.project ?? '').trim();
  const fail = (error: string, status = 400) => {
    if (raise) throw new PortfolioError(error, status);
    return { ok: false, error };
  };
  const linkErr = projectLinkError(project);
  if (linkErr) return fail(linkErr);
  let key = typeof input.key === 'string' ? input.key.trim() : '';
  if (key) {
    const err = keyError(key);
    if (err) return fail(err);
  } else {
    key = (await readKey(keyAccount(project), keyDeps()).catch(() => null)) ?? '';
    if (!key) return fail('No key is saved for this project. Paste the API key.');
  }
  try {
    const info = await projectInfo(project, key, portfolioDeps.framerConnect);
    return { ok: true, name: info.name };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Framer did not accept the key check.', 400);
  }
}

/** Remove key: deletes it from the Keychain. Edits go back to Framer in her Chrome. */
export async function removeKey(): Promise<FramerConfig | null> {
  const config = await readConfig();
  if (!config?.project) return config;
  const id = keyAccount(config.project);
  await deleteKey(id, keyDeps()).catch(() => {});
  if (await hasKey(id, keyDeps()).catch(() => false)) throw new PortfolioError('The Keychain did not remove the key. Open Keychain Access and delete DesignStudio.framer.', 500);
  const next: FramerConfig = { site: config.site, project: config.project, mode: config.mode === 'copy' ? 'copy' : 'chrome' };
  await writeJson(configFile(), next);
  return next;
}

/** "Framer in your Chrome: Signed in", or why not. Reads tab addresses only. */
export const chromeCheck = (project: string) => checkChrome(browser(), project);

export type Settings = { since?: string | null; clearance?: { key: string; value: Clearance }; includeAdopted?: boolean };

export function updateSettings(input: Settings): Promise<PortfolioFile> {
  return updatePortfolio((f) => {
    if (input.since === null) delete f.since;
    else if (typeof input.since === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.since) || !dayStart(input.since)) throw new PortfolioError('Pick a date');
      f.since = input.since;
    }
    if (input.clearance && ['ask', 'cleared', 'never'].includes(input.clearance.value)) f.clearance[String(input.clearance.key)] = input.clearance.value;
    if (typeof input.includeAdopted === 'boolean') {
      if (input.includeAdopted) f.includeAdopted = true;
      else delete f.includeAdopted;
    }
  });
}

// ---------- Views ----------

export async function portfolioView() {
  const [config, file] = await Promise.all([readConfig(), readPortfolio()]);
  const { blocks, adopted, projects } = await findBlocks(file);
  const edit = await canEdit();
  return { config, canEdit: edit.ok, editReason: edit.reason, file, blocks: blocks.map(publicBlock), adopted, projects, runs: await listRuns(), active: [...active.keys()] };
}

export async function runView(id: string) {
  const [run, candidates, suggestions, picks, edits] = await Promise.all([readRun(id), candidatesOf(id), suggestionsOf(id), readPicks(id), editsOf(id)]);
  const shots = await readdir(path.join(runDir(id), 'shots')).catch(() => [] as string[]);
  return { run, candidates, suggestions, picks, edits, shots: shots.filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '').replace('-', ':')) };
}

export async function readShot(id: string, node: string): Promise<Buffer> {
  if (!/^\d+[:-]\d+$/.test(node)) throw new PortfolioError('There is no such screen', 404);
  try {
    return await readFile(path.join(runDir(id), 'shots', shotName(node.replace('-', ':'))));
  } catch {
    throw new PortfolioError('There is no such screen', 404);
  }
}
