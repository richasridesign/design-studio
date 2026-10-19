import type { ChatContext, Project, Tag } from '../../shared/project.js';
import { tagOf, type FileMap } from './fileMap.js';

// The scope guard: a flow chat edits only its own flow subsection in its own iteration. It runs in beforeFigma on
// every use_figma script that edits, before the write lock, on the ids the script names. Reads are never guarded.
//
// Decided by tag (iteration id and flow slug), from the map rows, with project.json's node ids as a fallback for a
// file whose tagging failed. Allowed: the chat's own subsection and states, its own flow in a frozen iteration
// (cloning from the baseline is normal work), anything outside the tagged sections (the Comp page, loose frames),
// ids the map does not know (new nodes, layers inside a screen), and the iteration section while the flow has no
// subsection yet (the chat makes it). Denied: other flows, other working iterations, frozen ones of other flows,
// the iteration section itself (Design Studio keeps its layout) and Parked.
// A project chat (fan-out parent, Components chat) may edit every working iteration but no frozen one.

export type Verdict = { allow: true } | { allow: false; id: string; reason: string };

/**
 * A flow chat on a frozen iteration only reads Figma: every edit script and Figma write tool is denied, wherever it
 * points (its own subsection, new nodes, the Comp page) and whatever "Allow edits anywhere" says. `project` is read
 * fresh for each call, so freezing takes effect at once in open chats and reopening lifts it. Null when allowed.
 */
export function frozenChat(ctx: ChatContext | null, project: Project | null): string | null {
  if (ctx?.scope !== 'flow' || !ctx.iteration) return null;
  const id = ctx.iteration.id;
  const state = (project ?? ctx.project).iterations.find((it) => it.id === id)?.state ?? ctx.iteration.state;
  if (state !== 'frozen') return null;
  return `This chat is on ${id}, which is frozen, so it only reads Figma and cannot change it. Reopen ${id} from the sidebar to edit it, or start a chat on the working iteration.`;
}

type Where = { page: string; tags: Array<{ id: string; tag: Tag }> };

const ALLOW: Verdict = { allow: true };

/** id -> where it sits: its page and the tagged sections around it, outermost first, itself included. A walk of the
 * map per edit call (a few thousand rows at most), so a new project.json is always the one used. */
function whereAll(map: FileMap, project: Project): Map<string, Where> {
  const byNode = projectTags(project);
  const out = new Map<string, Where>();
  for (const [, pageName, top] of map.raw.pages) {
    const walk = (n: (typeof top)[number], trail: Where['tags']) => {
      const tag = n[0] === 'S' ? tagOf(n) ?? byNode.get(n[1]) ?? null : null;
      const here = tag ? [...trail, { id: n[1], tag }] : trail;
      out.set(n[1], { page: pageName, tags: here });
      for (const k of n[7] ?? []) walk(k, here);
    };
    for (const n of top) walk(n, []);
  }
  return out;
}

/** The tags project.json implies, for sections the map has without a tag. */
function projectTags(p: Project): Map<string, Tag> {
  const m = new Map<string, Tag>();
  for (const it of p.iterations) {
    if (it.node) m.set(it.node, { kind: 'iteration', iteration: it.id });
    for (const [flow, f] of Object.entries(it.flows ?? {})) {
      if (f.node) m.set(f.node, { kind: 'flow', iteration: it.id, flow });
      if (f.states) m.set(f.states, { kind: 'states', iteration: it.id, flow });
    }
  }
  if (p.parked?.node) m.set(p.parked.node, { kind: 'parked' });
  return m;
}

const flowLabel = (p: Project, slug: string) => {
  const f = p.flows.find((x) => x.slug === slug);
  return f ? `Flow ${f.n}` : slug;
};

const SWITCH = ' If this edit is on purpose, Richa can turn on "Allow edits anywhere" in this chat\'s header.';

/**
 * Checks the ids an edit script names. `project` is read fresh for each call, so freezing an iteration takes effect at
 * once. Null map or no project: allowed (nothing to decide by).
 */
export function checkScope(map: FileMap | null, ctx: ChatContext | null, project: Project | null, ids: string[]): Verdict {
  if (!map || !ctx || !project) return ALLOW;
  const where = whereAll(map, project);
  const stateOf = (id: string) => project.iterations.find((it) => it.id === id)?.state ?? 'working';
  const own = ctx.scope === 'flow' ? { it: ctx.iteration?.id, flow: ctx.flow?.slug } : null;
  for (const id of ids) {
    const w = where.get(id);
    if (!w || !w.tags.length) continue;
    const reason = verdict(id, w, own, project, stateOf);
    if (reason) return { allow: false, id, reason: reason + SWITCH };
  }
  return ALLOW;
}

function verdict(id: string, w: Where, own: { it?: string; flow?: string } | null, p: Project, stateOf: (id: string) => string): string | null {
  if (w.tags.some((t) => t.tag.kind === 'parked')) return `${id} is in the Parked section. Restoring or changing a parked feature is a project task, not a flow chat's.`;
  const itTag = w.tags.find((t) => t.tag.iteration)?.tag;
  if (!itTag?.iteration) return null;
  const itId = itTag.iteration;
  const flow = w.tags.find((t) => t.tag.flow)?.tag.flow;
  const self = w.tags.at(-1)!;
  const frozen = stateOf(itId) === 'frozen';
  // A project chat: every working iteration, never a frozen one.
  if (!own) return frozen ? `${id} is in iteration ${itId}, which is frozen: chats only read it. Reopen ${itId} from the sidebar first.` : null;
  if (itId === own.it) {
    if (self.id === id && self.tag.kind === 'iteration') {
      // Its own flow has no subsection yet: the chat makes it inside the iteration section.
      if (own.flow && !p.iterations.find((it) => it.id === itId)?.flows?.[own.flow]?.node) return null;
      return `${id} is the section of iteration ${itId}. Design Studio keeps its layout (800px between flows), so edit inside your own flow subsection instead.`;
    }
    if (!flow || flow === own.flow) return null;
    return `${id} is in ${flowLabel(p, flow)} · ${itId}, which belongs to the ${flowLabel(p, flow)} chat. Ask there, or run this as a project task.`;
  }
  if (frozen) {
    if (flow && flow === own.flow && !(self.id === id && self.tag.kind === 'iteration')) return null;
    return `${id} is in ${flow ? `${flowLabel(p, flow)} · ${itId}` : `iteration ${itId}`}, which is frozen: chats only read it.${flow && flow !== own.flow ? ` It belongs to ${flowLabel(p, flow)}.` : ''}`;
  }
  return `${id} is in ${flow ? `${flowLabel(p, flow)} · ${itId}` : `iteration ${itId}`}, another working iteration${flow ? `, which belongs to the ${flowLabel(p, flow)} chat in ${itId}` : ''}. Ask there, or run this as a project task.`;
}
