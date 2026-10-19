import type { ReviewRun } from '../../shared/design.js';
import { iterationLabel, sortedIterations, workingIteration, type Flow, type IterationState, type MapRow, type Project } from '../../shared/project.js';
import type { FileMap } from './fileMap.js';
import { iterationDir } from './project.js';
import { readReview } from './review.js';

// What the center tabs show when a project, flow or iteration row is selected in the sidebar with no chat for it:
// the screens from the cached map, grouped, and the review runs of every flow chat folder in an iteration.

export type Selected = { flow?: string; iteration?: string };
export type ViewItem = { id: string; name: string };
export type ViewGroup = { key: string; title: string; state: IterationState; node: string | null; items: ViewItem[] };

function index(map: FileMap | null) {
  const rows = new Map<string, MapRow>();
  for (const [, , top] of map?.raw.pages ?? []) {
    const walk = (n: MapRow) => {
      rows.set(n[1], n);
      for (const k of n[7] ?? []) walk(k);
    };
    for (const n of top) walk(n);
  }
  return rows;
}

const framesIn = (row: MapRow | undefined): ViewItem[] => (row?.[7] ?? []).filter((k) => k[0] !== 'S').map((k) => ({ id: k[1], name: k[2] }));
const flowTitle = (f: Pick<Flow, 'n' | 'name'>) => `Flow ${f.n} · ${f.name}`;

/**
 * Groups for the Figma tab. An iteration: one group per flow in flow order, its screens and then its states. A flow:
 * its subsection in every iteration, newest first. A project: every iteration, newest first, listing its flow
 * subsections. Screens come from the cached map, so a node made this turn shows after the next map read.
 */
export function selectionView(project: Project, map: FileMap | null, sel: Selected): ViewGroup[] {
  const rows = index(map);
  const newest = sortedIterations(project).reverse();
  if (sel.iteration) {
    const it = project.iterations.find((x) => x.id === sel.iteration);
    if (!it) return [];
    return project.flows
      .filter((f) => it.flows?.[f.slug] && (!sel.flow || f.slug === sel.flow))
      .map((f) => {
        const own = it.flows![f.slug];
        return { key: f.slug, title: flowTitle(f), state: it.state, node: own.node || null, items: [...framesIn(rows.get(own.node)), ...(own.states ? framesIn(rows.get(own.states)) : [])] };
      });
  }
  if (sel.flow) {
    const f = project.flows.find((x) => x.slug === sel.flow);
    if (!f) return [];
    return newest.filter((it) => it.flows?.[f.slug]).map((it) => {
      const own = it.flows![f.slug];
      return { key: it.id, title: `Iteration: ${iterationLabel(it)}`, state: it.state, node: own.node || null, items: [...framesIn(rows.get(own.node)), ...(own.states ? framesIn(rows.get(own.states)) : [])] };
    });
  }
  return newest.map((it) => ({
    key: it.id,
    title: `Iteration: ${iterationLabel(it)}`,
    state: it.state,
    node: it.node ?? null,
    items: project.flows.filter((f) => it.flows?.[f.slug]?.node).map((f) => ({ id: it.flows![f.slug].node, name: rows.get(it.flows![f.slug].node)?.[2] ?? flowTitle(f) })),
  }));
}

/** The node the Figma tab focuses for a selection: the flow subsection, else the iteration section. */
export function selectionNode(project: Project, sel: Selected): string | null {
  const it = sel.iteration ? project.iterations.find((x) => x.id === sel.iteration) : sel.flow ? workingIteration(project) ?? sortedIterations(project).filter((x) => sel.flow && x.flows?.[sel.flow]).at(-1) : workingIteration(project);
  if (!it) return null;
  return (sel.flow && it.flows?.[sel.flow]?.node) || it.node || null;
}

export type FlowReviews = { flow: { slug: string; n: number; name: string }; runs: ReviewRun[] };

/** Review runs of every flow chat folder in one iteration, one group per flow in flow order, newest run first. */
export async function iterationReviews(root: string, project: Project, id: string): Promise<FlowReviews[]> {
  const it = project.iterations.find((x) => x.id === id);
  if (!it) return [];
  const flows = project.flows.filter((f) => it.flows?.[f.slug]);
  return Promise.all(flows.map(async (f) => ({
    flow: { slug: f.slug, n: f.n, name: f.name },
    runs: (await readReview(iterationDir(root, f, id))).runs.sort((a, b) => b.at - a.at),
  })));
}
