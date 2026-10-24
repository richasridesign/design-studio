import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  HISTORY_FILE, appendDone, decisionTimes, ensureIteration, markEdited, oneLine, parseSticky, replaceDecisions,
  type HistoryIteration, type ScreenDecisions, type StickyText,
} from '../../shared/history.js';
import { SEP, TAG_NS, cleanId, weekdayDate, type Flow, type Iteration, type Project } from '../../shared/project.js';
import { figmaNodeUrl } from '../../shared/design.js';
import { chatContext, flowDir, iterationDir, readProject } from './project.js';
import { WORKFLOW_FILE, WORKFLOW_INFO, isWorkflow } from '../../shared/workflow.js';
import { projectRoot } from './roots.js';
import { cachedMap, ownerChain, taggedSections, type FileMap } from './fileMap.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';

// The history file of each flow (flows/NN-slug/history.md): what changed in each iteration and why. Decisions are
// copied one way from the Decision stickies under each screen in Figma (the stickies are the source); what was done
// comes from set_status changes. Only this module writes the file, one write at a time per file, and a PreToolUse
// hook keeps Claude's Write and Edit tools off it. Design Studio reads it to show the History tab.

/** The namespace DS.decisions tags its stickies with (iteration, screen, n). */
export const DECISION_NS = 'designstudio_decision';

export class HistoryError extends Error {}

export type HistoryContext = { root: string; project: Project; flow: Flow; iteration: Iteration; file: string };

export const historyFile = (root: string, flow: Pick<Flow, 'n' | 'slug'>) => path.join(flowDir(root, flow), HISTORY_FILE);

/** True for a path that is some flow's history file: Claude may read it but never write it. */
export const isHistoryPath = (p: string) => /(^|[\\/])flows[\\/][^\\/]+[\\/]history\.md$/.test(String(p ?? ''));

/** The flow and iteration of a chat folder, with its history file. Null for a chat that is not on a flow. */
export async function historyContext(cwd: string): Promise<HistoryContext | null> {
  const ctx = await chatContext(cwd);
  if (!ctx || ctx.scope !== 'flow' || !ctx.flow || !ctx.iteration) return null;
  const root = projectRoot(cwd);
  return { root, project: ctx.project, flow: ctx.flow, iteration: ctx.iteration, file: historyFile(root, ctx.flow) };
}

/** "1.19 · Readiness · Tue 20 Oct 2026" */
export const blockTitle = (it: Iteration) => [it.id, it.topic?.trim(), it.date ? weekdayDate(it.date) : ''].filter(Boolean).join(SEP);

/** The flow's subsection (and states subsection) in this iteration: project.json first, then the tags in the map. */
export function flowSections(project: Project, it: Iteration, flow: Flow, map: FileMap | null): { node?: string; states?: string } {
  const known = it.flows?.[flow.slug];
  const tagged = map ? taggedSections(map).filter((s) => s.tag.iteration === it.id && s.tag.flow === flow.slug) : [];
  // Newer nodes have the larger first id number.
  const newest = (kind: string) => tagged.filter((s) => s.tag.kind === kind).sort((a, b) => (Number(b.id.split(':')[0]) || 0) - (Number(a.id.split(':')[0]) || 0))[0]?.id;
  return { node: known?.node ?? newest('flow'), states: known?.states ?? newest('states') };
}

async function blockIteration(root: string, c: Pick<HistoryContext, 'project' | 'iteration' | 'flow'>, map: FileMap | null): Promise<HistoryIteration> {
  const node = flowSections(c.project, c.iteration, c.flow, map).node ?? c.iteration.node;
  // The meta line names the workflow and round once the flow has a workflow.json in this iteration.
  const w = await readFile(path.join(iterationDir(root, c.flow, c.iteration.id), WORKFLOW_FILE), 'utf8').then(JSON.parse, () => null) as { workflow?: unknown; round?: unknown } | null;
  const wf = w && isWorkflow(w.workflow) ? { workflow: WORKFLOW_INFO[w.workflow].name, round: Math.max(1, Math.floor(Number(w.round) || 1)) } : {};
  return { id: c.iteration.id, title: blockTitle(c.iteration), state: c.iteration.state, ...wf, ...(node ? { link: figmaNodeUrl(c.project.key, node) } : {}) };
}

/** After a workflow step moves: rewrites the iteration's meta line (State, Workflow, Round). Nothing else changes. */
export async function refreshMeta(cwd: string): Promise<void> {
  const ctx = await historyContext(cwd);
  if (!ctx || ctx.iteration.state === 'frozen') return;
  const map = await cachedMap(ctx.root, ctx.project.key).catch(() => null);
  const it = await blockIteration(ctx.root, ctx, map);
  await updateHistory(ctx.file, (md) => ensureIteration(md, ctx.flow, it));
}

// ---------- The writer ----------

const queues = new Map<string, Promise<unknown>>();
const listeners = new Set<(file: string) => void>();

/** Called after each write with the file's absolute path, so open chats on that flow can refresh their History tab. */
export function onHistoryWrite(fn: (file: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const readText = (file: string) => readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'ENOENT') return '';
  throw err;
});

/** One write at a time per file: read, change, write a temp file and rename it over. Unchanged text is not written. */
export function updateHistory(file: string, fn: (md: string) => string): Promise<string> {
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const had = await readText(file);
    const next = fn(had);
    if (next !== had) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, next);
      await rename(`${file}.tmp`, file);
      for (const l of listeners) {
        try { l(file); } catch { /* a listener never fails a write */ }
      }
    }
    return next;
  });
  queues.set(file, run);
  void run.finally(() => { if (queues.get(file) === run) queues.delete(file); }).catch(() => {});
  return run;
}

// ---------- What was done ----------

export type Change = { what: string; why?: string; screens?: string[] };

/** "Readiness column added on Connectors, Connected. Why: she starts with the closest workflow." */
export function changeLine(c: Change, name: (id: string) => string = (id) => id): string {
  const screens = (c.screens ?? []).map(name).filter(Boolean);
  const what = oneLine(c.what).replace(/\.$/, '');
  return `${what}${screens.length ? ` on ${screens.join(', ')}` : ''}${c.why?.trim() ? `. Why: ${oneLine(c.why)}` : ''}`;
}

const screenName = (map: FileMap | null) => (id: string) => {
  if (!map || !/^\d+:\d+$/.test(id)) return id;
  for (const [, , top] of map.raw.pages) {
    const find = (rows: typeof top): string | null => {
      for (const r of rows) {
        if (r[1] === id) return r[2];
        const hit = r[7] ? find(r[7]) : null;
        if (hit) return hit;
      }
      return null;
    };
    const hit = find(top);
    if (hit) return hit;
  }
  return id;
};

/**
 * Adds set_status changes to what was done. A chat on a flow writes to its own flow's file. A project task writes each
 * change to the flows its screens sit in (found by the tags in the map), and drops a change it cannot place.
 */
export async function recordChanges(cwd: string, changes: Change[], now = new Date()): Promise<number> {
  const list = changes.filter((c) => c.what?.trim());
  if (!list.length) return 0;
  const ctx = await historyContext(cwd);
  const root = projectRoot(cwd);
  const project = ctx?.project ?? (await readProject(root));
  if (!project) return 0;
  const map = await cachedMap(root, project.key).catch(() => null);
  const name = screenName(map);
  if (ctx) {
    const it = await blockIteration(ctx.root, ctx, map);
    await updateHistory(ctx.file, (md) => list.reduce((acc, c) => appendDone(acc, it.id, changeLine(c, name), now), ensureIteration(md, ctx.flow, it)));
    return list.length;
  }
  if (!map) return 0;
  // Project task: one entry per flow and iteration the screens sit in.
  const byFlow = new Map<string, { flow: Flow; iteration: Iteration; lines: string[] }>();
  for (const c of list) {
    const places = new Set<string>();
    for (const id of c.screens ?? []) {
      const tag = ownerChain(map, id).map((s) => s.tag).filter((t) => t && (t.kind === 'flow' || t.kind === 'states') && t.iteration && t.flow).at(-1);
      if (tag) places.add(`${tag.flow}|${tag.iteration}`);
    }
    for (const place of places) {
      const [slug, id] = place.split('|');
      const flow = project.flows.find((f) => f.slug === slug);
      const iteration = project.iterations.find((x) => x.id === cleanId(id));
      if (!flow || !iteration) continue;
      const entry = byFlow.get(place) ?? { flow, iteration, lines: [] };
      entry.lines.push(changeLine(c, name));
      byFlow.set(place, entry);
    }
  }
  for (const { flow, iteration, lines } of byFlow.values()) {
    const it = await blockIteration(root, { project, iteration, flow }, map);
    await updateHistory(historyFile(root, flow), (md) => lines.reduce((acc, l) => appendDone(acc, it.id, l, now), ensureIteration(md, flow, it)));
  }
  return [...byFlow.values()].reduce((n, e) => n + e.lines.length, 0);
}

/** Adds a line to what was done in a flow chat's iteration (a review, a freeze). No-op outside a flow chat. */
export async function recordDone(cwd: string, text: string, now = new Date()): Promise<boolean> {
  const ctx = await historyContext(cwd);
  if (!ctx || !text.trim()) return false;
  const map = await cachedMap(ctx.root, ctx.project.key).catch(() => null);
  const it = await blockIteration(ctx.root, ctx, map);
  await updateHistory(ctx.file, (md) => appendDone(ensureIteration(md, ctx.flow, it), it.id, text, now));
  return true;
}

/** After a Figma edit in a flow chat: the decisions in its block may be out of date. Writes only when not stale yet. */
export async function markFlowEdited(cwd: string, now = new Date()): Promise<void> {
  const ctx = await historyContext(cwd);
  if (!ctx || ctx.iteration.state === 'frozen') return;
  const it = await blockIteration(ctx.root, ctx, null);
  await updateHistory(ctx.file, (md) => {
    const t = decisionTimes(md, it.id);
    if (md.includes(`<!-- ds:iteration ${it.id} -->`) && t.edited !== null && (t.synced === null || t.edited > t.synced)) return md;
    return markEdited(ensureIteration(md, ctx.flow, it), it.id, now);
  });
}

// ---------- Reading the stickies from Figma ----------

type RawBox = { id: string; name: string; x: number; y: number; w: number; h: number };
export type RawSticky = RawBox & { screen?: string; n?: number; iteration?: string; parts: Array<{ key?: string; text: string }> };
export type StickyRead = { screens: RawBox[]; stickies: RawSticky[]; missing: string[] };

/** Read only: the screens and Decision stickies directly inside the given sections (and one level of sections in them). */
export function stickyScript(sections: string[]): string {
  return `const ids = ${JSON.stringify(sections)};
const NS = ${JSON.stringify(DECISION_NS)};
const TAG = ${JSON.stringify(TAG_NS)};
const r = (v) => Math.round(Number(v || 0));
const box = (n) => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { id: n.id, name: String(n.name || '').slice(0, 120), x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) }; };
const cut = (s) => String(s == null ? '' : s).slice(0, 600);
const DECISION = /^decision( sticky)?$/i;
const NAMED = /^\\s*decision\\s*\\d+\\s*[·•:|-]/i;
async function stickyOf(n) {
  const screen = n.getSharedPluginData ? n.getSharedPluginData(NS, 'screen') : '';
  if (n.type === 'STICKY') return { parts: [{ text: cut(n.text && n.text.characters) }], screen };
  if (n.type !== 'INSTANCE' && n.type !== 'FRAME' && n.type !== 'GROUP') return null;
  let isDecision = !!screen || NAMED.test(n.name || '');
  if (n.type === 'INSTANCE') {
    const main = await n.getMainComponentAsync();
    const owner = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
    if (owner && DECISION.test(String(owner.name || '').trim())) isDecision = true;
  }
  if (!isDecision) return null;
  const parts = [];
  if (n.type === 'INSTANCE') {
    for (const [key, p] of Object.entries(n.componentProperties || {})) if (p && p.type === 'TEXT') parts.push({ key, text: cut(p.value) });
  }
  if (!parts.length) for (const t of n.findAll((x) => x.type === 'TEXT')) parts.push({ text: cut(t.characters) });
  return { parts, screen };
}
const out = { screens: [], stickies: [], missing: [] };
async function walk(sec, depth) {
  for (const n of sec.children) {
    if (n.type === 'SECTION') { if (depth < 1) await walk(n, depth + 1); continue; }
    const s = await stickyOf(n);
    if (s) {
      const num = Number(n.getSharedPluginData ? n.getSharedPluginData(NS, 'n') : '') || undefined;
      const it = n.getSharedPluginData ? n.getSharedPluginData(NS, 'iteration') : '';
      out.stickies.push({ ...box(n), ...(s.screen ? { screen: s.screen } : {}), ...(num ? { n: num } : {}), ...(it ? { iteration: it } : {}), parts: s.parts });
      continue;
    }
    if (n.type !== 'FRAME' && n.type !== 'COMPONENT' && n.type !== 'INSTANCE') continue;
    if (/\\(entry, unchanged\\)/i.test(n.name || '') || (n.getSharedPluginData && n.getSharedPluginData(TAG, 'kind') === 'entry')) continue;
    out.screens.push(box(n));
  }
}
for (const id of ids) {
  const sec = await figma.getNodeByIdAsync(id);
  if (!sec || !('children' in sec)) { out.missing.push(id); continue; }
  await walk(sec, 0);
}
return out;`;
}

/** Reading order of screens on a canvas: rows top to bottom (a row is screens that start within 200px), then left to right. */
export function readingOrder<T extends { x: number; y: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const s of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(s.y - row[0].y) < 200) row.push(s);
    else rows.push([s]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

const DECISION_NAME = /^\s*decision\s*(\d+)\s*[·•:|-]\s*(.*)$/i;

/**
 * Puts each sticky under its screen: by DS.decisions' plugin data first, then by its name ("Decision 2 · Connectors"),
 * then by where it sits (the nearest screen above it that it overlaps horizontally). Stickies tagged for another
 * iteration are left out. Stickies keep their number order, else left to right.
 */
export function assignStickies(read: StickyRead, iteration: string, key: string): ScreenDecisions[] {
  const screens = readingOrder(read.screens);
  const byId = new Map(screens.map((s) => [s.id, s]));
  const byName = new Map(screens.map((s) => [s.name.trim().toLowerCase(), s]));
  const under = new Map<string, Array<{ n: number; x: number; y: number; text: StickyText }>>();
  for (const st of read.stickies) {
    if (st.iteration && st.iteration !== iteration) continue;
    const text = parseSticky(st.parts);
    if (!text) continue;
    const named = DECISION_NAME.exec(st.name);
    let screen = st.screen && byId.has(st.screen) ? byId.get(st.screen) : undefined;
    if (!screen && named) screen = byName.get(named[2].trim().toLowerCase());
    if (!screen) {
      const cx = st.x + st.w / 2;
      screen = screens
        .filter((s) => cx >= s.x - 16 && cx <= s.x + s.w + 16 && st.y >= s.y + s.h - 8)
        .sort((a, b) => (st.y - (a.y + a.h)) - (st.y - (b.y + b.h)))[0];
    }
    if (!screen) continue;
    const n = st.n ?? (named ? Number(named[1]) : 0);
    under.set(screen.id, [...(under.get(screen.id) ?? []), { n, x: st.x, y: st.y, text }]);
  }
  return screens.map((s) => ({
    id: s.id,
    name: s.name,
    link: figmaNodeUrl(key, s.id),
    stickies: (under.get(s.id) ?? []).sort((a, b) => (a.n && b.n ? a.n - b.n : 0) || a.y - b.y || a.x - b.x).map((x) => x.text),
  }));
}

/**
 * Copies the Decision stickies of a flow chat's iteration into its history file (Figma to file, one way). One read-only
 * plugin call. A frozen iteration that was read once is never read again.
 */
export async function syncDecisions(cwd: string, deps: ReadDeps = {}, now = new Date()): Promise<{ synced: boolean; screens: number }> {
  const ctx = await historyContext(cwd);
  if (!ctx) throw new HistoryError('History belongs to a flow. Open a chat on a flow to see it.');
  const had = await readText(ctx.file);
  if (ctx.iteration.state === 'frozen' && decisionTimes(had, ctx.iteration.id).synced !== null) return { synced: false, screens: 0 };
  const map = await cachedMap(ctx.root, ctx.project.key).catch(() => null);
  const { node, states } = flowSections(ctx.project, ctx.iteration, ctx.flow, map);
  const ids = [node, states].filter((x): x is string => !!x);
  let screens: ScreenDecisions[] = [];
  if (ids.length) {
    const r = await pluginScript<StickyRead>(ctx.project.key, stickyScript(ids), 'Read the Decision stickies of this flow (read only)', { ...deps, dir: ctx.root, key: `history:${ids.join(',')}`, socket: { name: 'stickies', args: { ids, ns: DECISION_NS, tag: TAG_NS } } });
    const read: StickyRead = { screens: r.value?.screens ?? [], stickies: r.value?.stickies ?? [], missing: r.value?.missing ?? [] };
    screens = assignStickies(read, ctx.iteration.id, ctx.project.key);
  }
  const it = await blockIteration(ctx.root, ctx, map);
  await updateHistory(ctx.file, (md) => replaceDecisions(ensureIteration(md, ctx.flow, it), it.id, screens, now));
  return { synced: true, screens: screens.length };
}

// ---------- The view ----------

export type HistoryView = {
  flow: { n: number; name: string; slug: string } | null;
  iteration: { id: string; state: 'working' | 'frozen' } | null;
  md: string;
  /** When this iteration's decisions were last read from Figma. */
  syncedAt: number | null;
  /** True when they were never read, or the flow was edited in Figma since. */
  stale: boolean;
};

export async function historyView(cwd: string): Promise<HistoryView> {
  const ctx = await historyContext(cwd);
  if (!ctx) return { flow: null, iteration: null, md: '', syncedAt: null, stale: false };
  const md = await readText(ctx.file);
  const t = decisionTimes(md, ctx.iteration.id);
  const frozenDone = ctx.iteration.state === 'frozen' && t.synced !== null;
  const stale = !frozenDone && (t.synced === null || (t.edited !== null && t.edited > t.synced));
  return {
    flow: { n: ctx.flow.n, name: ctx.flow.name, slug: ctx.flow.slug },
    iteration: { id: ctx.iteration.id, state: ctx.iteration.state },
    md,
    syncedAt: t.synced,
    stale,
  };
}

/** The flow folder a history file belongs to: chats under it get told the file changed. */
export const historyFlowDir = (file: string) => path.dirname(file);
