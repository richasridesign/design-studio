import { TAG_NS, compareIds, decisionsNoteName, flowSectionName, iterationName, type Flow, type Iteration, type Project } from '../../shared/project.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { withWrite } from './figmaLock.js';
import { refreshMapSoon } from './fileMap.js';
import { createIteration, ensureIterationFolders, readProject, setIterationState, updateProject, type NewIterationInput } from './project.js';
import { projectRoot } from './roots.js';

// An iteration in Figma: one page-level section 800px above the newest one (the existing sections never move), one
// subsection per flow stacked 800px apart in flow order, each holding copies of the flow's entry screens. Design
// Studio restacks the subsections after an edited turn so a flow that grew never covers the next one. Everything
// here runs under the file's write lock, in the same queue as the chats' own use_figma calls.

/** Between sections, and between a section's children and its edges, from Richa's rules. */
export const GAP = 800;
export const PAD = 320;
/** Between the entry copies placed side by side inside a new flow subsection. */
const ENTRY_GAP = 160;

export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Move = { id: string; x: number; y: number };
export type RestackResult = { moves: Move[]; fit: { x: number; y: number; w: number; h: number }; changed: boolean; cramped?: boolean };

/**
 * Stacks a section's child subsections in the given order, 800px apart, keeps their x, fits the section around them
 * with 320px padding, and lifts the whole section when its bottom would come within 800px of the section below it.
 * Pure: absolute boxes in, absolute targets out. The first child stays where it is, so a section that is already
 * tidy produces no moves. The lift never brings the section within 800px of the node above it (`above`): when there is
 * not that much room, it lifts as far as it can and says `cramped`, since existing sections are never moved.
 */
export function restackPlan(children: Box[], section: Box, below: Box | null = null, above: Box | null = null): RestackResult {
  if (!children.length) return { moves: [], fit: { x: section.x, y: section.y, w: section.w, h: section.h }, changed: false };
  const targets: Move[] = [];
  let y = children[0].y;
  for (const c of children) {
    targets.push({ id: c.id, x: c.x, y });
    y += c.h + GAP;
  }
  const left = Math.min(...targets.map((t) => t.x));
  const top = targets[0].y;
  const right = Math.max(...children.map((c, i) => targets[i].x + c.w));
  const bottom = Math.max(...children.map((c, i) => targets[i].y + c.h));
  let fit = { x: left - PAD, y: top - PAD, w: right - left + 2 * PAD, h: bottom - top + 2 * PAD };
  // The newest section sits on top, so growth is taken upward: lift it clear of the section under it.
  const need = below ? Math.max(0, fit.y + fit.h + GAP - below.y) : 0;
  const room = above ? Math.max(0, fit.y - (above.y + above.h + GAP)) : Infinity;
  const lift = Math.min(need, room);
  const cramped = need > room;
  if (lift) {
    fit = { ...fit, y: fit.y - lift };
    for (const t of targets) t.y -= lift;
  }
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const moves = targets.filter((t) => { const c = children.find((k) => k.id === t.id)!; return !same(c.x, t.x) || !same(c.y, t.y); });
  const changed = moves.length > 0 || !same(fit.x, section.x) || !same(fit.y, section.y) || !same(fit.w, section.w) || !same(fit.h, section.h);
  return { moves, fit, changed, ...(cramped ? { cramped } : {}) };
}

/** Orders a section's child subsections: tagged flows in flow order first, then the rest by their y. */
export function flowOrder<T extends { id: string; y: number; flow?: string | null }>(children: T[], flows: Array<Pick<Flow, 'slug'>>): T[] {
  const rank = (c: T) => { const i = c.flow ? flows.findIndex((f) => f.slug === c.flow) : -1; return i < 0 ? flows.length : i; };
  return [...children].sort((a, b) => rank(a) - rank(b) || a.y - b.y);
}

// ---------- Making the section ----------

export type SectionFlow = { slug: string; n: number; name: string; entry: string[] };
export type SectionSpec = {
  key: string;
  pageId: string | null;
  id: string;
  /** The iteration section to add to, or null to make it (800px above the topmost page-level node). */
  section: string | null;
  name: string;
  flows: SectionFlow[];
  madeAt?: string;
};
export type SectionResult = { node: string; flows: Record<string, { node: string; entries: string[]; rewired?: string[] }>; missing: string[]; note: string | null };

/**
 * The Plugin API script. With `section` null it creates the iteration section and its Decisions note; with a
 * section id it adds flow subsections under the last one. Entry copies are clones of the flow's entry screens,
 * renamed "<name> (Entry, unchanged)" and tagged `entry`, so a chat knows not to change them. Nothing already on the
 * page moves.
 */
export function sectionScript(spec: SectionSpec): string {
  const tag = (kind: string, flow: string) => `[${JSON.stringify(kind)}, ${JSON.stringify(spec.id)}, ${JSON.stringify(flow)}]`;
  return `const NS = ${JSON.stringify(TAG_NS)}, KEY = ${JSON.stringify(spec.key)}, MADE = ${JSON.stringify(spec.madeAt ?? new Date().toISOString())};
const GAP = ${GAP}, PAD = ${PAD}, ENTRY_GAP = ${ENTRY_GAP};
const flows = ${JSON.stringify(spec.flows.map((f) => ({ slug: f.slug, name: flowSectionName(spec.id, f), entry: f.entry })))};
const tag = (node, t) => { node.setSharedPluginData(NS, 'kind', t[0]); node.setSharedPluginData(NS, 'iteration', t[1]); node.setSharedPluginData(NS, 'flow', t[2]); node.setSharedPluginData(NS, 'project', KEY); node.setSharedPluginData(NS, 'madeAt', MADE); };
const missing = [];
let page = ${spec.pageId ? `await figma.getNodeByIdAsync(${JSON.stringify(spec.pageId)})` : 'null'};
let section = ${spec.section ? `await figma.getNodeByIdAsync(${JSON.stringify(spec.section)})` : 'null'};
if (section && section.type !== 'SECTION') section = null;
if (section) page = section.parent;
if (!page || page.type !== 'PAGE') page = figma.currentPage;
await page.loadAsync();
try { await figma.setCurrentPageAsync(page); } catch (e) {}
let note = null;
if (!section) {
  section = figma.createSection();
  section.name = ${JSON.stringify(spec.name)};
  page.appendChild(section);
  tag(section, ${tag('iteration', '')});
  try {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const t = figma.createText();
    t.characters = ${JSON.stringify(decisionsNoteName(spec.id))} + '\\n• ';
    t.fontSize = 24;
    section.appendChild(t);
    t.x = PAD; t.y = PAD / 2;
    note = t.id;
  } catch (e) {}
}
// New subsections go under the last child (x of the first one), or at the padding when the section is empty.
const subs = section.children.filter((c) => c.type === 'SECTION');
let x = subs.length ? Math.min(...subs.map((s) => s.x)) : PAD;
let y = subs.length ? Math.max(...subs.map((s) => s.y + s.height)) + GAP : PAD;
const out = {};
for (const f of flows) {
  const sub = figma.createSection();
  sub.name = f.name;
  section.appendChild(sub);
  tag(sub, ['flow', ${JSON.stringify(spec.id)}, f.slug]);
  const entries = [];
  let ex = PAD, h = 0;
  for (const id of f.entry) {
    const src = await figma.getNodeByIdAsync(id);
    if (!src || !('clone' in src)) { missing.push(id); continue; }
    // A clone lands on the page (checked live), never in the source's section, so the source section is not changed.
    const c = src.clone();
    sub.appendChild(c);
    c.x = ex; c.y = PAD;
    c.name = src.name + ' (Entry, unchanged)';
    try { tag(c, ['entry', ${JSON.stringify(spec.id)}, f.slug]); } catch (e) {}
    ex += c.width + ENTRY_GAP;
    h = Math.max(h, c.height);
    entries.push(c.id);
  }
  // Clones keep their prototype reactions, still pointing at the source screens. Links between two entry screens of
  // this flow are pointed at the copies; links elsewhere stay for Claude to wire into the new screens.
  const remap = {};
  f.entry.forEach((id, i) => { if (entries[i] !== undefined) remap[id] = entries[i]; });
  const rewired = [];
  for (const cid of entries) {
    const c = await figma.getNodeByIdAsync(cid);
    const all = [c, ...(typeof c.findAll === 'function' ? c.findAll((n) => Array.isArray(n.reactions) && n.reactions.length > 0) : [])];
    for (const n of all) {
      if (!Array.isArray(n.reactions) || !n.reactions.length || typeof n.setReactionsAsync !== 'function') continue;
      let hit = false;
      const next = n.reactions.map((r) => ({ trigger: r.trigger, actions: (r.actions || []).map((a) => (a && a.destinationId && remap[a.destinationId] ? (hit = true, { ...a, destinationId: remap[a.destinationId] }) : a)) }));
      if (hit) { try { await n.setReactionsAsync(next); rewired.push(n.id); } catch (e) {} }
    }
  }
  sub.resizeWithoutConstraints(Math.max(1600, ex - ENTRY_GAP + PAD), Math.max(1200, h + 2 * PAD));
  sub.x = x; sub.y = y;
  y += sub.height + GAP;
  out[f.slug] = { node: sub.id, entries, rewired };
}
// Fit the section around its children, then, when it is new, place it 800px above everything on the page.
const kids = section.children;
const right = Math.max(...kids.map((c) => c.x + c.width), PAD);
const bottom = Math.max(...kids.map((c) => c.y + c.height), PAD);
section.resizeWithoutConstraints(right + PAD, bottom + PAD);
if (${spec.section ? 'false' : 'true'}) {
  const others = page.children.filter((c) => c !== section);
  const top = others.length ? Math.min(...others.map((c) => c.y)) : 0;
  const left = others.length ? Math.min(...others.map((c) => c.x)) : 0;
  section.x = left;
  section.y = top - GAP - section.height;
}
return { node: section.id, flows: out, missing, note };`;
}

const sectionFlows = (project: Project, slugs: string[]): SectionFlow[] =>
  project.flows.filter((f) => slugs.includes(f.slug)).map((f) => ({ slug: f.slug, n: f.n, name: f.name, entry: f.entry }));

/**
 * Makes the iteration's section in Figma (or adds the missing flow subsections to it), under the write lock, and
 * writes the node ids into project.json. Flows that already have a subsection are left alone.
 */
export async function makeIterationSections(dir: string, key: string, id: string, slugs: string[] | null = null, deps: ReadDeps = {}, now = Date.now()): Promise<SectionResult> {
  const root = projectRoot(dir);
  const project = await readProject(root);
  const it = project?.iterations.find((i) => i.id === id);
  if (!project || !it) throw new Error(`No iteration ${id}`);
  if (it.state === 'frozen') throw new Error(`Iteration ${id} is frozen`);
  const wanted = (slugs ?? Object.keys(it.flows ?? {})).filter((s) => !it.flows?.[s]?.node);
  const flows = sectionFlows(project, wanted);
  if (it.node && !flows.length) return { node: it.node, flows: {}, missing: [], note: null };
  const spec: SectionSpec = { key, pageId: project.page?.id ?? null, id, section: it.node ?? null, name: it.name ?? iterationName(id, it.topic ?? '', it.date ?? ''), flows, madeAt: new Date(now).toISOString() };
  const r = await withWrite(key, () => pluginScript<SectionResult>(key, sectionScript(spec), `Make the Figma section for iteration ${id}`, { ...deps, dir: root }));
  const made = r.value;
  if (!made?.node) throw new Error('Figma returned no section id');
  await updateProject(root, (p) => {
    if (!p) return p;
    return {
      ...p,
      iterations: p.iterations.map((x) => {
        if (x.id !== id) return x;
        const next: Iteration = { ...x, node: made.node, name: x.name ?? spec.name, flows: { ...(x.flows ?? {}) } };
        for (const [slug, f] of Object.entries(made.flows ?? {})) next.flows![slug] = { ...(next.flows![slug] ?? {}), node: f.node };
        return next;
      }),
    };
  });
  // Flows added to a section that was there already grow it downward, into the older iteration under it: restack now.
  const re = spec.section ? await restack(root, key, id, deps).catch((err) => { console.error('restack:', (err as Error).message); return null; }) : null;
  if (!re?.changed) refreshMapSoon(root, key, deps);
  return made;
}

export type FigmaOutcome = { ok: true; node: string; missing: string[] } | { ok: false; error: string };

const outcome = async (run: () => Promise<SectionResult>): Promise<FigmaOutcome> => {
  try {
    const r = await run();
    return { ok: true, node: r.node, missing: r.missing };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

/**
 * New iteration from the dialog: project.json and the folders first (createIteration), then the Figma section. The
 * Figma step is best effort: on failure the iteration is kept and the dialog offers Retry, which calls
 * makeIterationSections alone (a second create would say the iteration exists).
 */
export async function createIterationInFigma(dir: string, key: string | null, input: NewIterationInput, deps: ReadDeps = {}, now = Date.now()): Promise<{ iteration: Iteration; figma: FigmaOutcome }> {
  const iteration = await createIteration(dir, input, now);
  const slugs = (input.flows ?? []).filter(Boolean);
  if (!key) return { iteration, figma: { ok: false, error: 'This folder has no Figma file' } };
  const figma = await outcome(() => makeIterationSections(dir, key, iteration.id, slugs, deps, now));
  return { iteration: (await readProject(dir))?.iterations.find((it) => it.id === iteration.id) ?? iteration, figma };
}

/** Retry of the Figma step, or the section for an iteration made before Phase 2. */
export const makeSectionsFor = (dir: string, key: string, id: string, slugs: string[] | null, deps: ReadDeps = {}) => outcome(() => makeIterationSections(dir, key, id, slugs, deps));

/** Adds a flow to a working iteration: its folder, then its subsection with the entry copies, under the others. */
export async function addFlowToIteration(dir: string, key: string, id: string, slug: string, deps: ReadDeps = {}): Promise<{ cwd: string; figma: FigmaOutcome }> {
  const it = (await readProject(dir))?.iterations.find((x) => x.id === id);
  if (it?.state === 'frozen') throw new Error(`Iteration ${id} is frozen. Reopen it first.`);
  const cwd = await ensureIterationFolders(dir, slug, id);
  if (it?.flows?.[slug]?.node) return { cwd, figma: { ok: true, node: it.node ?? '', missing: [] } };
  return { cwd, figma: await outcome(() => makeIterationSections(dir, key, id, [slug], deps)) };
}

/** Freezes an iteration: chats only read it from now on, and a restack waiting for it is dropped. */
export async function freezeIteration(dir: string, key: string | null, id: string) {
  const project = await setIterationState(dir, id, 'frozen');
  if (key) cancelRestack(key, id);
  return { project };
}

/** Reopens a frozen iteration. `newer` names a working iteration with a higher id, which the confirm mentions. */
export async function reopenIteration(dir: string, id: string) {
  const project = await setIterationState(dir, id, 'working');
  const newer = project.iterations.filter((it) => it.state === 'working' && it.id !== id && compareIds(it.id, id) > 0).map((it) => it.id);
  return { project, newer };
}

// ---------- Restack after edits ----------

export const READ_SCRIPT = (id: string) => `const s = await figma.getNodeByIdAsync(${JSON.stringify(id)});
if (!s || s.type !== 'SECTION') return null;
const box = (n) => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
const kids = s.children.filter((c) => c.type === 'SECTION').map((c) => ({ id: c.id, ...box(c), flow: c.getSharedPluginData(${JSON.stringify(TAG_NS)}, 'flow') || null }));
const page = s.parent;
const others = page && page.type === 'PAGE' ? page.children.filter((c) => c !== s) : [];
// Below: the nearest node whose top is under this section's top, so a section that already grew into it still counts.
const belowAll = others.filter((c) => c.y > s.y);
const below = belowAll.length ? belowAll.reduce((a, b) => (b.y < a.y ? b : a)) : null;
const aboveAll = others.filter((c) => c.y < s.y);
const above = aboveAll.length ? aboveAll.reduce((a, b) => (b.y + b.height > a.y + a.height ? b : a)) : null;
return { section: { id: s.id, ...box(s) }, kids, below: below ? { id: below.id, ...box(below) } : null, above: above ? { id: above.id, ...box(above) } : null };`;

export const APPLY_SCRIPT = (id: string, plan: RestackResult) => `const s = await figma.getNodeByIdAsync(${JSON.stringify(id)});
if (!s || s.type !== 'SECTION') return { moved: 0 };
const fit = ${JSON.stringify(plan.fit)};
const moves = ${JSON.stringify(plan.moves)};
const abs = (n) => n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
// Children of a section sit relative to it, so moving the section moves them all. Every subsection is set from its
// absolute target after the move: a planned move, else where it was before. Other children (the Decisions note) keep
// their place in the section.
const subs = s.children.filter((c) => c.type === 'SECTION').map((c) => { const b = abs(c); return { c, x: b.x, y: b.y }; });
const sb = abs(s);
const dx = s.x - sb.x, dy = s.y - sb.y;
s.resizeWithoutConstraints(fit.w, fit.h);
s.x = fit.x + dx; s.y = fit.y + dy;
let moved = 0;
for (const k of subs) {
  const m = moves.find((x) => x.id === k.c.id);
  if (m) moved++;
  const t = m || k;
  k.c.x = t.x - fit.x; k.c.y = t.y - fit.y;
}
return { moved };`;

type ReadOut = { section: Box; kids: Array<Box & { flow: string | null }>; below: Box | null; above?: Box | null } | null;

/** Reads the iteration section's geometry, plans the restack and applies it, all under one hold of the write lock. */
export async function restack(dir: string, key: string, id: string, deps: ReadDeps = {}): Promise<{ moved: number; changed: boolean }> {
  const root = projectRoot(dir);
  const project = await readProject(root);
  const it = project?.iterations.find((i) => i.id === id);
  if (!project || !it?.node || it.state === 'frozen') return { moved: 0, changed: false };
  const node = it.node;
  return withWrite(key, async () => {
    const read = await pluginScript<ReadOut>(key, READ_SCRIPT(node), `Read the layout of iteration ${id}`, { ...deps, dir: root });
    const got = read.value;
    if (!got) return { moved: 0, changed: false };
    const plan = restackPlan(flowOrder(got.kids, project.flows), got.section, got.below, got.above ?? null);
    if (plan.cramped) console.error(`restack: iteration ${id} has less than 800px of room above it, so it still sits close to the section below`);
    if (!plan.changed) return { moved: 0, changed: false };
    const r = await pluginScript<{ moved: number }>(key, APPLY_SCRIPT(node, plan), `Restack the flows of iteration ${id} (800px apart)`, { ...deps, dir: root });
    refreshMapSoon(root, key, deps);
    return { moved: r.value?.moved ?? 0, changed: true };
  });
}

// Chats mid-turn on a file, so the restack waits for a quiet moment: a chat that is between two calls of one turn
// would otherwise find its subsection moved under it.
const turns = new Map<string, Set<string>>();
export function markTurn(key: string, chatId: string, on: boolean) {
  const set = turns.get(key) ?? turns.set(key, new Set()).get(key)!;
  if (on) set.add(chatId);
  else set.delete(chatId);
  if (!set.size) turns.delete(key);
}
export const turnsOn = (key: string) => turns.get(key)?.size ?? 0;

export const RESTACK_DEBOUNCE_MS = 20_000;
const timers = new Map<string, NodeJS.Timeout>();

/** Restacks once, 20s after the last edited turn on the iteration, and later again while any chat on the file is mid-turn. */
export function scheduleRestack(dir: string, key: string, id: string, deps: ReadDeps = {}, delay = RESTACK_DEBOUNCE_MS) {
  const k = `${key}/${id}`;
  const old = timers.get(k);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    timers.delete(k);
    if (turnsOn(key)) { scheduleRestack(dir, key, id, deps, delay); return; }
    restack(dir, key, id, deps).catch((err) => console.error('restack:', (err as Error).message));
  }, delay);
  timer.unref?.();
  timers.set(k, timer);
}

export const pendingRestacks = () => timers.size;

export function cancelRestack(key: string, id: string) {
  const k = `${key}/${id}`;
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
}
