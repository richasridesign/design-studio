import { flowSectionName, iterationName, isLatestName, type Project, type Tag } from './project.js';

// Section names that drifted from the convention ("V1.19 · Readiness · Tue 20 Oct 2026", "V1.19 · Flow 3 ·
// Connectors"). Only the working iteration's own sections, never frozen or adopted ones: those are old versions and
// stay as Richa named them. Names come from the map, since project.json can be stale.

export type Rename = { node: string; now: string; want: string };

export function renamePlan(p: Pick<Project, 'flows' | 'iterations'>, tagged: Array<{ id: string; name: string; tag: Tag }>): Rename[] {
  const out: Rename[] = [];
  const nameOf = new Map(tagged.map((t) => [t.id, t.name]));
  const add = (node: string | undefined, want: string) => {
    const now = node ? nameOf.get(node) : undefined;
    if (node && now !== undefined && now.trim() !== want && !isLatestName(now)) out.push({ node, now, want });
  };
  for (const it of p.iterations) {
    if (it.state !== 'working' || it.adopted) continue;
    if (it.topic && it.date) add(it.node, iterationName(it.id, it.topic, it.date));
    for (const f of p.flows) add(it.flows?.[f.slug]?.node, flowSectionName(it.id, f));
  }
  return out;
}

/** "Rename 2 sections to the convention", for the project menu. */
export const renameLabel = (n: number) => `Rename ${n} section${n === 1 ? '' : 's'} to the convention`;

/** The duplicate tag warning: "2 sections share a tag" with the ids for the tooltip. */
export function doublesText(doubles: Array<{ tag: Tag; ids: string[] }>): { short: string; detail: string } {
  const extra = doubles.reduce((n, d) => n + d.ids.length - 1, 0);
  const what = (t: Tag) => (t.kind === 'iteration' ? `Iteration ${t.iteration}` : t.kind === 'parked' ? 'Parked' : `${t.iteration} · ${t.flow}${t.kind === 'states' ? ' states' : ''}`);
  return {
    short: `${extra} duplicate section${extra === 1 ? '' : 's'}`,
    detail: `Duplicated in Figma, so the newest copy is used: ${doubles.map((d) => `${what(d.tag)} (${d.ids.join(', ')})`).join('; ')}. Delete the copy you do not want in Figma.`,
  };
}
