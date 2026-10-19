import { TAG_NS, decisionsNoteName, flowSectionName, iterationName, type Flow, type Iteration, type Project } from '../../shared/project.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { withWrite } from './figmaLock.js';
import { refreshMapSoon } from './fileMap.js';
import { readProject, updateProject } from './project.js';
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
export type RestackResult = { moves: Move[]; fit: { x: number; y: number; w: number; h: number }; changed: boolean };

/**
 * Stacks a section's child subsections in the given order, 800px apart, keeps their x, fits the section around them
 * with 320px padding, and lifts the whole section when its bottom would come within 800px of the section below it.
 * Pure: absolute boxes in, absolute targets out. The first child stays where it is, so a section that is already
 * tidy produces no moves.
 */
export function restackPlan(children: Box[], section: Box, below: Box | null = null): RestackResult {
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
  const lift = below ? Math.max(0, fit.y + fit.h + GAP - below.y) : 0;
  if (lift) {
    fit = { ...fit, y: fit.y - lift };
    for (const t of targets) t.y -= lift;
  }
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const moves = targets.filter((t) => { const c = children.find((k) => k.id === t.id)!; return !same(c.x, t.x) || !same(c.y, t.y); });
  const changed = moves.length > 0 || !same(fit.x, section.x) || !same(fit.y, section.y) || !same(fit.w, section.w) || !same(fit.h, section.h);
  return { moves, fit, changed };
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
export type SectionResult = { node: string; flows: Record<string, { node: string; entries: string[] }>; missing: string[]; note: string | null };

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
    const c = src.clone();
    sub.appendChild(c);
    c.x = ex; c.y = PAD;
    c.name = src.name + ' (Entry, unchanged)';
    try { tag(c, ['entry', ${JSON.stringify(spec.id)}, f.slug]); } catch (e) {}
    ex += c.width + ENTRY_GAP;
    h = Math.max(h, c.height);
    entries.push(c.id);
  }
  sub.resizeWithoutConstraints(Math.max(1600, ex - ENTRY_GAP + PAD), Math.max(1200, h + 2 * PAD));
  sub.x = x; sub.y = y;
  y += sub.height + GAP;
  out[f.slug] = { node: sub.id, entries };
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
  refreshMapSoon(root, key, deps);
  return made;
}

// ---------- Restack after edits ----------

const READ_SCRIPT = (id: string) => `const s = await figma.getNodeByIdAsync(${JSON.stringify(id)});
if (!s || s.type !== 'SECTION') return null;
const box = (n) => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
const kids = s.children.filter((c) => c.type === 'SECTION').map((c) => ({ id: c.id, ...box(c), flow: c.getSharedPluginData(${JSON.stringify(TAG_NS)}, 'flow') || null }));
const page = s.parent;
const belowAll = page && page.type === 'PAGE' ? page.children.filter((c) => c !== s && c.y >= s.y + s.height - 1) : [];
const below = belowAll.length ? belowAll.reduce((a, b) => (b.y < a.y ? b : a)) : null;
return { section: { id: s.id, ...box(s) }, kids, below: below ? { id: below.id, ...box(below) } : null };`;

const APPLY_SCRIPT = (id: string, plan: RestackResult) => `const s = await figma.getNodeByIdAsync(${JSON.stringify(id)});
if (!s || s.type !== 'SECTION') return { moved: 0 };
const fit = ${JSON.stringify(plan.fit)};
const moves = ${JSON.stringify(plan.moves)};
const sb = s.absoluteBoundingBox || { x: s.x, y: s.y };
const dx = s.x - sb.x, dy = s.y - sb.y;
s.resizeWithoutConstraints(fit.w, fit.h);
s.x = fit.x + dx; s.y = fit.y + dy;
let moved = 0;
for (const m of moves) {
  const c = await figma.getNodeByIdAsync(m.id);
  if (!c || c.parent !== s) continue;
  c.x = m.x - fit.x; c.y = m.y - fit.y;
  moved++;
}
return { moved };`;

type ReadOut = { section: Box; kids: Array<Box & { flow: string | null }>; below: Box | null } | null;

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
    const plan = restackPlan(flowOrder(got.kids, project.flows), got.section, got.below);
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
