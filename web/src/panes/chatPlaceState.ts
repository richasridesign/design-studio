import { useEffect, useState } from 'react';
import { getJson, postJson, send, useStore } from '../store';
import { compareIds, flowDirName, latestOf, vId, type Flow, type Iteration, type Project, type ProjectSummary } from '../../../shared/project';
import type { SavedSession } from '../../../shared/protocol';
import { PROJECTS_CHANGED } from './ProjectDialogs';
import { locateChat } from './projectTree';

// Where a chat sits (a project, or a flow in an iteration) and how a new chat starts there. Shared by the sidebar,
// the new chat picker on the project row and the chip above the chat, so all three take the same path.

/** "1.19" -> "V1.19", the way Figma names the iteration. */
export { vId };

/** The chip and picker text for a flow in an iteration: "2 · Activate · V1.18". */
export const placeLabel = (flow: Pick<Flow, 'n' | 'name'>, it: Pick<Iteration, 'id'>) => `${flow.n} · ${flow.name} · ${vId(it.id)}`;

/**
 * The iterations a new chat on this flow can go to, newest first: every working one, and frozen ones that hold the
 * flow (or whose flows are unknown, as adopted sections are). A frozen iteration without the flow has nothing to read.
 */
export function iterationsFor(project: Project, slug: string): Iteration[] {
  return [...project.iterations]
    .filter((it) => it.state === 'working' || !it.flows || Boolean(it.flows[slug]))
    .sort((a, b) => compareIds(b.id, a.id));
}

/** The default: the newest working iteration, else the newest one. */
export const defaultIteration = (list: Iteration[]) => list.find((it) => it.state === 'working') ?? list[0] ?? null;

/** A working iteration without this flow first gets its subsection, with the entry screens copied. */
export const needsCopy = (it: Iteration, slug: string) => it.state === 'working' && !it.flows?.[slug];

/**
 * Starts a chat on a flow in an iteration. A frozen iteration starts at once (read only, nothing to copy); a working one
 * without the flow first copies its entry screens into a new subsection, about 20 seconds. Resolves with a warning
 * when the chat started but its Figma subsection was not made; throws when the flow was not added.
 */
export async function startFlowChat(cwd: string, flow: Pick<Flow, 'slug' | 'name'>, it: Iteration): Promise<string | null> {
  if (!needsCopy(it, flow.slug)) {
    send({ type: 'new_session', cwd, flow: flow.slug, iteration: it.id });
    return null;
  }
  const r = await postJson<{ figma: { ok: boolean; error?: string } }>(`/api/projects/iteration/flow?cwd=${encodeURIComponent(cwd)}`, { id: it.id, slug: flow.slug });
  window.dispatchEvent(new Event(PROJECTS_CHANGED));
  send({ type: 'new_session', cwd, flow: flow.slug, iteration: it.id });
  return r.figma.ok ? null : `${flow.name} is in ${vId(it.id)}, but its Figma subsection was not made: ${r.figma.error ?? 'unknown error'}. The chat makes it.`;
}

export type Place = { summary: ProjectSummary; flow?: Flow; iteration?: Iteration; startedIn?: Iteration };

/** The project a chat folder belongs to, and its flow and iteration when it is a flow chat. Null outside every project. */
export function placeOf(cwd: string, projects: ProjectSummary[]): Place | null {
  // Longest root first, so a project inside another folder's path never claims its chats.
  const summary = [...projects].sort((a, b) => b.cwd.length - a.cwd.length).find((p) => cwd === p.cwd || cwd.startsWith(`${p.cwd}/`));
  if (!summary) return null;
  const where = locateChat(cwd, summary.cwd);
  if (!where || where === 'root' || !summary.project) return { summary };
  const flow = summary.project.flows.find((f) => flowDirName(f) === where.flowDir);
  const iteration = summary.project.iterations.find((it) => it.id === where.iteration);
  if (!flow || !iteration) return { summary };
  // A chat on a frozen iteration whose flow has newer working work edits that work (the server's scope guard carries it).
  const latest = latestOf(summary.project, flow.slug);
  if (iteration.state === 'frozen' && latest?.state === 'working' && compareIds(latest.id, iteration.id) > 0) return { summary, flow, iteration: latest, startedIn: iteration };
  return { summary, flow, iteration };
}

/** The projects and saved chats, reloaded when a project changes and when chats open or close. */
export function useProjects() {
  const live = useStore((s) => s.live.length);
  const current = useStore((s) => s.session.sessionId);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saved, setSaved] = useState<SavedSession[]>([]);
  useEffect(() => {
    const load = () => void getJson<{ projects: ProjectSummary[] }>('/api/projects').then((r) => setProjects(r.projects)).catch(() => {});
    load();
    window.addEventListener(PROJECTS_CHANGED, load);
    window.addEventListener('designstudio:stages', load);
    return () => {
      window.removeEventListener(PROJECTS_CHANGED, load);
      window.removeEventListener('designstudio:stages', load);
    };
  }, [live, current]);
  useEffect(() => { getJson<SavedSession[]>('/api/sessions').then(setSaved).catch(() => {}); }, [live, current]);
  return { projects, saved };
}
