import type { LiveChat, SavedSession } from '../../../shared/protocol';
import { compareIds, flowDirName, iterationLabel, type Flow, type Iteration, type ProjectSummary } from '../../../shared/project';

// The chat list as a tree: Project > Flow > Iteration > chats. A project is one Figma file (its folder). Chats from
// before the file was adopted sit under "Before flows", chats at the project root after adoption are "Project
// tasks", and chats with no file at all share one "No file yet" group at the end.

export type ChatSet = { open: LiveChat[]; recent: SavedSession[] };
export type TreeIteration = ChatSet & { iteration: Iteration; label: string };
export type TreeFlow = { flow: Flow; iterations: TreeIteration[]; count: number };
export type TreeProject = {
  cwd: string;
  key: string;
  name: string;
  url: string;
  stage: string | null;
  adopted: boolean;
  working: Iteration | null;
  flows: TreeFlow[];
  before: ChatSet;
  tasks: ChatSet;
  /** Every chat in the project, for the folded count and the search. */
  count: number;
  last: number;
};
export type Tree = { projects: TreeProject[]; noFile: ChatSet };

const urgency = (c: LiveChat) => (c.pending ? 0 : c.running ? 1 : 2);
const byUrgency = (a: LiveChat, b: LiveChat) => urgency(a) - urgency(b) || b.lastActive - a.lastActive;
const byRecent = (a: SavedSession, b: SavedSession) => b.lastModified - a.lastModified;
const set = (): ChatSet => ({ open: [], recent: [] });
const size = (s: ChatSet) => s.open.length + s.recent.length;
const lastOf = (s: ChatSet) => Math.max(0, ...s.open.map((c) => c.lastActive), ...s.recent.map((r) => r.lastModified));

/** Where a chat folder sits in its project: at the root, or in a flow's iteration folder. */
export function locateChat(cwd: string, root: string): { flowDir: string; iteration: string } | 'root' | null {
  if (cwd === root) return 'root';
  if (!cwd.startsWith(root + '/')) return null;
  const parts = cwd.slice(root.length + 1).split('/');
  if (parts[0] === 'flows' && parts[2] === 'iterations' && parts[3] && parts.length === 4) return { flowDir: parts[1], iteration: parts[3] };
  return 'root';
}

export function buildTree(live: LiveChat[], saved: SavedSession[], projects: ProjectSummary[]): Tree {
  const openIds = new Set(live.map((c) => c.sessionId));
  const recent = saved.filter((s) => !openIds.has(s.sessionId));
  // Longest root first, so a project inside another folder's path never claims its chats.
  const roots = [...projects].sort((a, b) => b.cwd.length - a.cwd.length);
  const out: TreeProject[] = projects.map((p) => {
    const project = p.project;
    const flows: TreeFlow[] = (project?.flows ?? []).map((flow) => ({ flow, iterations: [], count: 0 }));
    const its = project ? [...project.iterations].sort((a, b) => compareIds(b.id, a.id)) : [];
    const working = its.find((it) => it.state === 'working') ?? null;
    const node: TreeProject = { cwd: p.cwd, key: p.key, name: p.name, url: p.url, stage: p.stage ?? null, adopted: Boolean(project), working, flows, before: set(), tasks: set(), count: 0, last: 0 };
    for (const f of flows) for (const it of its) f.iterations.push({ iteration: it, label: iterationLabel(it), open: [], recent: [] });
    return node;
  });
  const byCwd = new Map(out.map((p) => [p.cwd, p]));
  const place = (cwd: string, at: number, put: (s: ChatSet) => void): boolean => {
    const owner = roots.find((r) => cwd === r.cwd || cwd.startsWith(r.cwd + '/'));
    const node = owner && byCwd.get(owner.cwd);
    if (!node) return false;
    const where = locateChat(cwd, node.cwd);
    if (where === 'root' || where === null) {
      const adoptedAt = owner.project?.adoptedAt ?? 0;
      put(adoptedAt && at >= adoptedAt ? node.tasks : node.before);
      return true;
    }
    const flow = node.flows.find((f) => flowDirName(f.flow) === where.flowDir);
    const it = flow?.iterations.find((i) => i.iteration.id === where.iteration);
    put(it ?? node.before);
    return true;
  };
  const noFile = set();
  for (const c of live) if (!place(c.cwd, c.lastActive, (s) => s.open.push(c))) noFile.open.push(c);
  for (const s of recent) if (!place(s.cwd, s.lastModified, (x) => x.recent.push(s))) noFile.recent.push(s);
  const tidy = (s: ChatSet) => { s.open.sort(byUrgency); s.recent.sort(byRecent); };
  for (const p of out) {
    tidy(p.before);
    tidy(p.tasks);
    let last = Math.max(lastOf(p.before), lastOf(p.tasks));
    let count = size(p.before) + size(p.tasks);
    for (const f of p.flows) {
      // Under a flow: the working iteration always, frozen ones only when a chat ran there.
      f.iterations = f.iterations.filter((i) => i.iteration.state === 'working' || size(i));
      for (const i of f.iterations) { tidy(i); f.count += size(i); last = Math.max(last, lastOf(i)); }
      count += f.count;
    }
    p.count = count;
    p.last = last;
  }
  tidy(noFile);
  // A chat with no project folder but a recorded cwd outside the roots stays out of the list, as before.
  out.sort((a, b) => b.last - a.last);
  return { projects: out, noFile };
}

export function filterTree(tree: Tree, query: string): Tree {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const hit = (t: string) => t.toLowerCase().includes(q);
  const keep = (s: ChatSet): ChatSet => ({ open: s.open.filter((c) => hit(c.title)), recent: s.recent.filter((r) => hit(r.title)) });
  const projects = tree.projects
    .map((p) => {
      if (hit(p.name)) return p;
      const flows = p.flows
        .map((f) => (hit(f.flow.name) ? f : { ...f, iterations: f.iterations.map((i) => (hit(i.label) ? i : { ...i, ...keep(i) })).filter((i) => size(i)) }))
        .map((f) => ({ ...f, count: f.iterations.reduce((n, i) => n + size(i), 0) }))
        .filter((f) => f.count);
      const before = keep(p.before);
      const tasks = keep(p.tasks);
      return { ...p, flows, before, tasks, count: size(before) + size(tasks) + flows.reduce((n, f) => n + f.count, 0) };
    })
    .filter((p) => p.count);
  return { projects, noFile: keep(tree.noFile) };
}

export const chatCount = size;
