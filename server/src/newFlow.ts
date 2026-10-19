import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { nextIterationId, slugify, todayIso, workingIteration, type Flow, type Iteration, type Project } from '../../shared/project.js';
import { ensureIterationFolders, flowDir, updateProject } from './project.js';
import { makeSectionsFor, type FigmaOutcome } from './iterations.js';
import { projectRoot } from './roots.js';
import { workflowEvent } from './workflow.js';

// New flow, from the project row menu: the start of From scratch. It adds the flow to project.json (n = last + 1),
// or makes project.json with this flow when the file has none yet (an empty file works too), and a working
// iteration when there is none. Then the flow's folders, and its subsection in Figma, best effort like a new
// iteration: on failure the flow is kept and the first chat on it makes the subsection.

export type NewFlowInput = { name?: unknown; topic?: unknown };
export type NewFlowResult = { flow: Flow; iteration: Iteration; cwd: string; figma: FigmaOutcome };
export type NewFlowDeps = { sections?: (root: string, key: string, id: string, slugs: string[]) => Promise<FigmaOutcome> };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The project.json after adding the flow. Pure, so the rules are tested without a disk. */
export function addFlow(p: Project | null, key: string | null, input: NewFlowInput, now = Date.now()): { project: Project; flow: Flow; iteration: Iteration } {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new Error('Give the flow a name');
  if (!p && !key) throw new Error('This folder has no Figma file');
  const base: Project = p ?? { key: key!, adoptedAt: now, flows: [], iterations: [] };
  const taken = base.flows.find((f) => same(f.name, name));
  if (taken) throw new Error(`A flow named ${taken.name} already exists`);
  let slug = slugify(name);
  for (let i = 2; base.flows.some((f) => f.slug === slug); i++) slug = `${slugify(name).slice(0, 36)}-${i}`;
  const flow: Flow = { n: Math.max(0, ...base.flows.map((f) => f.n)) + 1, slug, name, entry: [] };
  let iteration = workingIteration(base);
  let iterations = base.iterations;
  if (!iteration) {
    const topic = String(input.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!topic) throw new Error('Give the iteration a topic');
    iteration = { id: nextIterationId(base), topic, date: todayIso(new Date(now)), state: 'working', createdAt: now, flows: {} };
    iterations = [...iterations, iteration];
  }
  return { project: { ...base, flows: [...base.flows, flow], iterations }, flow, iteration };
}

export async function createFlow(dir: string, key: string | null, input: NewFlowInput, deps: NewFlowDeps = {}, now = Date.now()): Promise<NewFlowResult> {
  const root = projectRoot(dir);
  let made: { flow: Flow; iteration: Iteration } | null = null;
  await updateProject(root, (p) => {
    const r = addFlow(p, key, input, now);
    made = { flow: r.flow, iteration: r.iteration };
    return r.project;
  });
  const { flow, iteration } = made!;
  const fdir = flowDir(root, flow);
  await mkdir(fdir, { recursive: true });
  const meta = path.join(fdir, 'flow.json');
  if (!(await readFile(meta, 'utf8').then(() => true, () => false))) await writeFile(meta, JSON.stringify({ n: flow.n, slug: flow.slug, name: flow.name, entry: [] }, null, 2));
  const cwd = await ensureIterationFolders(root, flow.slug, iteration.id, now);
  // A new flow has no screens: its chats start From scratch at Explore, even before the file map is read.
  await workflowEvent(cwd, { type: 'switch', workflow: 'scratch', at: now }).catch((err: Error) => console.error(`workflow: ${err.message}`));
  const sections = deps.sections ?? ((r, k, id, slugs) => makeSectionsFor(r, k, id, slugs));
  const figma: FigmaOutcome = key ? await sections(root, key, iteration.id, [flow.slug]).catch((err: Error) => ({ ok: false as const, error: err.message })) : { ok: false, error: 'This folder has no Figma file' };
  return { flow, iteration, cwd, figma };
}
