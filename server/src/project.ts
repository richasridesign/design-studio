import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  PROJECT_FILE, TAG_NS, adoptFromMap, cleanId, compareIds, flowDirName, packTag, reconcileNodes, slugify, todayIso, workingIteration,
  type AdoptProposal, type ChatContext, type Flow, type Iteration, type IterationFlow, type Project, type ProjectSummary, type Tag,
} from '../../shared/project.js';
import { projectRoot } from './roots.js';
import { chatFolders, installSkills } from './figma.js';
import { cachedMap, ensureMapSoon, taggedSections, type FileMap } from './fileMap.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { withWrite } from './figmaLock.js';
import { projectLabel } from './workflow.js';
import { renamePlan } from '../../shared/projectNames.js';

// A project is one Figma file: a folder with figma.json (its root) and, once adopted, project.json with its flows
// and iterations. A chat on a flow in an iteration runs in <root>/flows/<nn-slug>/iterations/<id>, so every
// per-chat file (plan, review, decisions log) keeps working unchanged, while rules, scope, the design system profile
// and the map cache resolve to the root (see roots.ts). Chats from before adoption stay at the root ("Before flows").

export const FLOWS_DIR = 'flows';
export const ITERATIONS_DIR = 'iterations';
export const TASKS_DIR = 'tasks';

export const projectFile = (root: string) => path.join(root, PROJECT_FILE);

export async function readProject(dir: string): Promise<Project | null> {
  const root = projectRoot(dir);
  return readFile(projectFile(root), 'utf8').then((t) => cleanProject(JSON.parse(t))).catch(() => null);
}

/** Keeps only the fields the model has, so a hand edit or an older file never breaks the tree. */
export function cleanProject(input: unknown): Project | null {
  const o = input && typeof input === 'object' ? (input as Record<string, any>) : null;
  if (!o || typeof o.key !== 'string') return null;
  const flows: Flow[] = (Array.isArray(o.flows) ? o.flows : [])
    .filter((f: any) => f && typeof f.name === 'string')
    .map((f: any, i: number) => ({ n: Number(f.n) || i + 1, slug: slugify(typeof f.slug === 'string' ? f.slug : f.name), name: String(f.name).slice(0, 80), entry: Array.isArray(f.entry) ? f.entry.filter((x: unknown) => typeof x === 'string') : [], ...(typeof f.baseline === 'string' ? { baseline: f.baseline } : {}), ...(f.adopted ? { adopted: true } : {}), ...(f.missing ? { missing: true } : {}) }));
  const iterations: Iteration[] = (Array.isArray(o.iterations) ? o.iterations : [])
    .map((it: any) => ({ ...it, id: cleanId(String(it?.id ?? '')) }))
    .filter((it: any) => it.id)
    .map((it: any) => ({
      id: it.id,
      ...(typeof it.node === 'string' ? { node: it.node } : {}),
      ...(typeof it.name === 'string' ? { name: it.name } : {}),
      ...(typeof it.topic === 'string' && it.topic ? { topic: it.topic } : {}),
      ...(typeof it.date === 'string' && it.date ? { date: it.date } : {}),
      state: it.state === 'working' ? 'working' : 'frozen',
      ...(it.adopted ? { adopted: true } : {}),
      ...(it.flows && typeof it.flows === 'object' ? { flows: it.flows } : {}),
      ...(Number.isFinite(it.createdAt) ? { createdAt: it.createdAt } : {}),
      ...(Number.isFinite(it.frozenAt) ? { frozenAt: it.frozenAt } : {}),
      ...(it.missing ? { missing: true } : {}),
    }));
  return {
    key: o.key,
    ...(Number.isFinite(o.adoptedAt) ? { adoptedAt: o.adoptedAt } : {}),
    ...(o.page && typeof o.page.id === 'string' ? { page: { id: o.page.id, name: String(o.page.name ?? '') } } : {}),
    flows,
    iterations,
    ...(o.parked && typeof o.parked.node === 'string' ? { parked: { node: o.parked.node } } : {}),
    ...(Number.isFinite(o.taggedAt) ? { taggedAt: o.taggedAt } : {}),
  } as Project;
}

// One write at a time per project, so two chats that finish together never clobber project.json.
const queues = new Map<string, Promise<unknown>>();

export function updateProject(dir: string, fn: (p: Project | null) => Project | null | Promise<Project | null>): Promise<Project | null> {
  const root = projectRoot(dir);
  const run = (queues.get(root) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const had = await readProject(root);
    const next = await fn(had);
    if (next && JSON.stringify(next) !== JSON.stringify(had)) {
      const file = projectFile(root);
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${file}.tmp`, file);
    }
    return next;
  });
  queues.set(root, run);
  void run.finally(() => { if (queues.get(root) === run) queues.delete(root); }).catch(() => {});
  return run;
}

export const writeProject = (dir: string, p: Project) => updateProject(dir, () => p);

// ---------- Folders ----------

export const flowDir = (root: string, flow: Pick<Flow, 'n' | 'slug'>) => path.join(root, FLOWS_DIR, flowDirName(flow));
export const iterationDir = (root: string, flow: Pick<Flow, 'n' | 'slug'>, id: string) => path.join(flowDir(root, flow), ITERATIONS_DIR, id);
export const projectIterationDir = (root: string, id: string) => path.join(root, ITERATIONS_DIR, id);
export const tasksDir = (root: string) => path.join(root, TASKS_DIR);

const writeIfMissing = async (file: string, body: unknown) => {
  const exists = await readFile(file, 'utf8').then(() => true, () => false);
  if (!exists) await writeFile(file, JSON.stringify(body, null, 2));
};

/** The folder a chat on `slug` in iteration `id` runs in, made with its flow.json and iteration.json when new. */
export async function ensureIterationFolders(dir: string, slug: string, id: string, now = Date.now()): Promise<string> {
  const root = projectRoot(dir);
  const project = await readProject(root);
  if (!project) throw new Error('This file has no flows yet. Adopt it first from the sidebar.');
  const flow = project.flows.find((f) => f.slug === slug);
  if (!flow) throw new Error(`No flow "${slug}" in this project`);
  const it = project.iterations.find((x) => x.id === cleanId(id));
  if (!it) throw new Error(`No iteration ${id} in this project`);
  const fdir = flowDir(root, flow);
  const idir = iterationDir(root, flow, it.id);
  await mkdir(idir, { recursive: true });
  await writeIfMissing(path.join(fdir, 'flow.json'), { n: flow.n, slug: flow.slug, name: flow.name, entry: flow.entry, ...(flow.baseline ? { baseline: flow.baseline } : {}) });
  await writeIfMissing(path.join(idir, 'iteration.json'), { id: it.id, flow: flow.slug, createdAt: now });
  await mkdir(projectIterationDir(root, it.id), { recursive: true });
  await writeIfMissing(path.join(projectIterationDir(root, it.id), 'iteration.json'), { id: it.id, topic: it.topic ?? '', date: it.date ?? '', state: it.state, createdAt: it.createdAt ?? now });
  await installSkills(idir);
  return idir;
}

/** What a chat folder is in its project: a flow in an iteration, a project task, or a chat at the root. */
export async function chatContext(cwd: string): Promise<ChatContext | null> {
  const root = projectRoot(cwd);
  const project = await readProject(root);
  if (!project) return null;
  const parts = path.relative(root, path.resolve(cwd)).split(path.sep).filter(Boolean);
  if (parts[0] === FLOWS_DIR && parts[2] === ITERATIONS_DIR && parts[3]) {
    const flow = project.flows.find((f) => flowDirName(f) === parts[1]);
    const iteration = project.iterations.find((it) => it.id === cleanId(parts[3]));
    if (flow && iteration) return { scope: 'flow', project, flow, iteration };
  }
  return { scope: 'project', project };
}

// ---------- The tree ----------

export type ProjectView = ProjectSummary;

/** Every project folder in the roots, with its project.json (node ids checked against the latest map). */
export async function listProjects(): Promise<ProjectView[]> {
  const out: ProjectView[] = [];
  for (const f of await chatFolders()) {
    if (!f.figma) continue;
    const saved = await readProject(f.dir);
    let project = saved;
    let doubles: ProjectView['doubles'];
    let renames = 0;
    if (saved) {
      const map = await cachedMap(f.dir, f.figma.key);
      if (map) {
        const r = reconcileNodes(saved, taggedSections(map).map((s) => ({ id: s.id, tag: s.tag })), mapIds(map));
        project = r.project;
        doubles = r.doubles.length ? r.doubles : undefined;
        renames = renamePlan(project, taggedSections(map)).length;
        if (JSON.stringify(project) !== JSON.stringify(saved)) void writeProject(f.dir, project).catch(() => {});
      }
    }
    out.push({ cwd: f.dir, key: f.figma.key, name: f.figma.name, url: f.figma.url, stage: await projectLabel(f.dir, project).catch(() => null), project, ...(doubles ? { doubles } : {}), ...(renames ? { renames } : {}) });
  }
  return out;
}

function mapIds(map: FileMap): Set<string> {
  const ids = new Set<string>();
  const walk = (n: any) => { ids.add(n[1]); for (const k of n[7] ?? []) walk(k); };
  for (const [, , top] of map.raw.pages) for (const n of top) walk(n);
  return ids;
}

// ---------- Adoption ----------

export type AdoptInput = {
  page?: { id: string; name: string } | null;
  flows?: Array<{ n?: number; slug?: string; name: string; entry?: string[]; baseline?: string }>;
  iterations?: Array<{ id: string; node?: string; name?: string; topic?: string; date?: string; flows?: Record<string, { node: string }> }>;
  parked?: { node: string } | null;
};

/** The adoption proposal from the saved map (never reads Figma here). Throws when the map is not read yet. */
export async function adoptProposal(dir: string, key: string): Promise<AdoptProposal & { adopted: Project | null }> {
  const root = projectRoot(dir);
  const map = await cachedMap(root, key);
  if (!map) {
    void ensureMapSoon(root, key);
    throw new Error('The file map is being read (about 30 seconds). Try again in a moment.');
  }
  return { ...adoptFromMap(map.raw.pages as never), adopted: await readProject(root) };
}

/**
 * project.json after an adoption, merged into what is there. Adopting again never drops anything: every flow and
 * iteration stays with its number, slug and folders (a flow made with New flow included), the ones the list names
 * get their Figma nodes refreshed, new ones are added, and an adopted one Figma no longer has is marked missing.
 */
export function mergeAdoption(existing: Project | null, key: string, input: AdoptInput, now = Date.now()): Project {
  const old = existing?.flows ?? [];
  const flows: Flow[] = old.map((f) => ({ ...f }));
  const seen = new Set<string>();
  // Proposal slug -> slug in project.json, so the iteration subsections land on the merged flows.
  const slugOf = new Map<string, string>();
  for (const f of input.flows ?? []) {
    const name = String(f?.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    const asked = slugify(typeof f.slug === 'string' && f.slug ? f.slug : name);
    const baseline = typeof f.baseline === 'string' && f.baseline ? f.baseline : undefined;
    const entry = (f.entry ?? []).filter((x) => typeof x === 'string').slice(0, 8);
    const same = (x: Flow) => !seen.has(x.slug) && ((baseline && x.baseline === baseline) || x.slug === asked || x.name.toLowerCase() === name.toLowerCase());
    const at = flows.findIndex(same);
    if (at >= 0) {
      // The folder is nn-slug and chats run inside it: n and slug never change.
      const { missing: _gone, ...had } = flows[at];
      flows[at] = { ...had, name, entry: entry.length ? entry : had.entry, ...(baseline ? { baseline } : {}), adopted: true };
      seen.add(had.slug);
      slugOf.set(asked, had.slug);
      continue;
    }
    let slug = asked;
    for (let i = 2; flows.some((x) => x.slug === slug); i++) slug = `${asked.slice(0, 36)}-${i}`;
    flows.push({ n: Math.max(0, ...flows.map((x) => x.n)) + 1, slug, name, entry, ...(baseline ? { baseline } : {}), adopted: true });
    seen.add(slug);
    slugOf.set(asked, slug);
  }
  for (const [i, f] of flows.entries()) if (!seen.has(f.slug) && (f.adopted || f.baseline)) flows[i] = { ...f, missing: true };
  if (!flows.length) throw new Error('Name at least one flow');

  const iterations: Iteration[] = (existing?.iterations ?? []).map((it) => ({ ...it }));
  const found = new Set<string>();
  for (const it of input.iterations ?? []) {
    const id = cleanId(String(it?.id ?? ''));
    if (!id || found.has(id)) continue;
    found.add(id);
    const flowsIn: Record<string, IterationFlow> = {};
    if (it.flows && typeof it.flows === 'object') {
      for (const [slug, v] of Object.entries(it.flows)) {
        const to = slugOf.get(slug) ?? slug;
        if (typeof v?.node === 'string' && flows.some((f) => f.slug === to)) flowsIn[to] = { node: v.node };
      }
    }
    const fields = { ...(it.node ? { node: String(it.node) } : {}), ...(it.name ? { name: String(it.name).slice(0, 120) } : {}), ...(it.topic ? { topic: String(it.topic).slice(0, 80) } : {}), ...(it.date ? { date: String(it.date).slice(0, 10) } : {}) };
    const at = iterations.findIndex((x) => x.id === id);
    if (at >= 0) {
      // State, times and subsections made since (with their states sections) stay.
      const { missing: _gone, ...had } = iterations[at];
      const merged: Record<string, IterationFlow> = { ...(had.flows ?? {}) };
      for (const [slug, v] of Object.entries(flowsIn)) merged[slug] = { ...(merged[slug] ?? {}), node: v.node };
      iterations[at] = { ...had, ...fields, ...(Object.keys(merged).length || had.flows ? { flows: merged } : {}) };
      continue;
    }
    iterations.push({ id, ...fields, state: 'frozen', adopted: true, ...(Object.keys(flowsIn).length ? { flows: flowsIn } : {}) });
  }
  for (const [i, it] of iterations.entries()) if (it.adopted && !found.has(it.id)) iterations[i] = { ...it, missing: true };
  iterations.sort((a, b) => compareIds(a.id, b.id));

  const page = input.page?.id ? { id: String(input.page.id), name: String(input.page.name ?? '') } : existing?.page;
  const parked = input.parked?.node ? { node: String(input.parked.node) } : existing?.parked;
  return { key, adoptedAt: now, ...(page ? { page } : {}), flows, iterations, ...(parked ? { parked } : {}) };
}

/** Merges the confirmed list into project.json, makes the flow folders, then tags the sections in Figma. */
export async function confirmAdopt(dir: string, key: string, input: AdoptInput, deps: ReadDeps = {}, now = Date.now()): Promise<{ project: Project; tagError: string | null }> {
  const root = projectRoot(dir);
  // Inside the queued writer, so a New flow that lands at the same moment is read and kept.
  const project = (await updateProject(root, (existing) => mergeAdoption(existing, key, input, now)))!;
  const { flows } = project;
  for (const f of flows) {
    await mkdir(flowDir(root, f), { recursive: true });
    await writeIfMissing(path.join(flowDir(root, f), 'flow.json'), { n: f.n, slug: f.slug, name: f.name, entry: f.entry, ...(f.baseline ? { baseline: f.baseline } : {}) });
  }
  let tagError: string | null = null;
  try {
    await tagProject(root, key, project, deps);
  } catch (err) {
    tagError = (err as Error).message;
  }
  return { project: (await readProject(root)) ?? project, tagError };
}

/** Every node the project knows, with the tag it should carry. */
export function tagList(p: Project): Array<[id: string, tag: Tag]> {
  const out: Array<[string, Tag]> = [];
  for (const it of p.iterations) {
    if (it.node) out.push([it.node, { kind: 'iteration', iteration: it.id }]);
    for (const [slug, f] of Object.entries(it.flows ?? {})) {
      if (f.node) out.push([f.node, { kind: 'flow', iteration: it.id, flow: slug }]);
      if (f.states) out.push([f.states, { kind: 'states', iteration: it.id, flow: slug }]);
    }
  }
  if (p.parked?.node) out.push([p.parked.node, { kind: 'parked' }]);
  return out;
}

/** The Plugin API script that writes the tags. Sets plugin data only: no moves, no renames, nothing inside sections. */
export function tagScript(key: string, list: Array<[string, Tag]>, madeAt = new Date().toISOString()): string {
  const rows = list.map(([id, t]) => [id, t.kind, t.iteration ?? '', t.flow ?? '']);
  return `const list = ${JSON.stringify(rows)};
let tagged = 0;
const missing = [];
for (const [id, kind, iteration, flow] of list) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'SECTION') { missing.push(id); continue; }
  node.setSharedPluginData(${JSON.stringify(TAG_NS)}, 'kind', kind);
  node.setSharedPluginData(${JSON.stringify(TAG_NS)}, 'iteration', iteration);
  node.setSharedPluginData(${JSON.stringify(TAG_NS)}, 'flow', flow);
  node.setSharedPluginData(${JSON.stringify(TAG_NS)}, 'project', ${JSON.stringify(key)});
  node.setSharedPluginData(${JSON.stringify(TAG_NS)}, 'madeAt', ${JSON.stringify(madeAt)});
  tagged++;
}
return { tagged, missing };`;
}

/** Writes the tags on every known node, under the file's write lock, and records when. */
export async function tagProject(dir: string, key: string, project: Project, deps: ReadDeps = {}) {
  const root = projectRoot(dir);
  const list = tagList(project);
  if (!list.length) return { tagged: 0, missing: [] as string[] };
  const r = await withWrite(key, () => pluginScript<{ tagged: number; missing: string[] }>(key, tagScript(key, list), 'Tag the iteration sections for Design Studio (writes plugin data only)', { ...deps, dir: root }));
  await updateProject(root, (p) => (p ? ({ ...p, taggedAt: Date.now() } as Project) : p));
  return r.value ?? { tagged: 0, missing: [] };
}

// ---------- Iterations (folders only in Phase 1; the Figma section is made in Phase 2) ----------

export type NewIterationInput = { id: string; topic: string; date?: string; flows?: string[] };

/** Adds a working iteration to project.json and makes the folders for the chosen flows. Nothing in Figma yet. */
export async function createIteration(dir: string, input: NewIterationInput, now = Date.now()): Promise<Iteration> {
  const root = projectRoot(dir);
  const id = cleanId(String(input.id ?? ''));
  if (!id) throw new Error('Use major.minor, like 1.19');
  const topic = String(input.topic ?? '').trim().slice(0, 80);
  if (!topic) throw new Error('Give the iteration a topic');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? '')) ? String(input.date) : todayIso(new Date(now));
  const next = await updateProject(root, (p) => {
    if (!p) throw new Error('This file has no flows yet. Adopt it first from the sidebar.');
    if (p.iterations.some((it) => it.id === id)) throw new Error(`Iteration ${id} already exists`);
    const it: Iteration = { id, topic, date, state: 'working', createdAt: now, flows: {} };
    return { ...p, iterations: [...p.iterations, it] };
  });
  const project = next!;
  const chosen = (input.flows ?? []).filter((s) => project.flows.some((f) => f.slug === s));
  for (const slug of chosen) await ensureIterationFolders(root, slug, id, now);
  return project.iterations.find((it) => it.id === id)!;
}

export async function setIterationState(dir: string, id: string, state: 'working' | 'frozen', now = Date.now()): Promise<Project> {
  const clean = cleanId(id);
  const next = await updateProject(dir, (p) => {
    if (!p) throw new Error('No project');
    if (!p.iterations.some((it) => it.id === clean)) throw new Error(`No iteration ${id}`);
    return { ...p, iterations: p.iterations.map((it) => (it.id === clean ? { ...it, state, ...(state === 'frozen' ? { frozenAt: now } : {}) } : it)) };
  });
  return next!;
}

/** The working iteration a new flow chat lands in, else null. */
export async function workingFor(dir: string) {
  const p = await readProject(dir);
  return p ? workingIteration(p) : null;
}

export { packTag };
