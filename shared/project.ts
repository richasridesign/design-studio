// Projects, flows and iterations: the model Design Studio keeps per Figma file (project.json), and the pure
// helpers around it. No Node imports: the web app and the server both use this file.
//
// From Richa's process: an iteration is one round of work, one page-level Figma section named
// "V1.19 · Readiness · Tue 20 Oct 2026". Inside it, each flow that changed has its own subsection
// "V1.19 · Flow 3 · Connectors". Old iterations stay frozen and untouched. Design Studio finds its nodes by shared
// plugin data (namespace "designstudio"), never by name, so renames in Figma break nothing.

export type IterationState = 'working' | 'frozen';

export type Flow = {
  /** Order on the page, 1-based. Also the number in "Flow 3 · Connectors". */
  n: number;
  slug: string;
  name: string;
  /** Node ids of the flow's entry screens (prototype starting points, else the left-most screen). */
  entry: string[];
  /** The flow's section in the adopted baseline (LATEST), when there is one. */
  baseline?: string;
};

export type IterationFlow = { node: string; states?: string };

export type Iteration = {
  /** "1", "1.19", "2.3". Never with the V. */
  id: string;
  /** The page-level section, when known. */
  node?: string;
  /** The section's name in Figma, when it differs from the convention (adopted sections keep their names). */
  name?: string;
  topic?: string;
  /** yyyy-mm-dd */
  date?: string;
  state: IterationState;
  adopted?: boolean;
  /** Flow subsections in this iteration, by flow slug. Adopted V1.x sections have none ("flows: unknown"). */
  flows?: Record<string, IterationFlow>;
  createdAt?: number;
  frozenAt?: number;
  /** Set when the last map read found neither the node id nor its tag. Nothing on disk is deleted. */
  missing?: boolean;
};

export type Project = {
  key: string;
  adoptedAt?: number;
  page?: { id: string; name: string };
  flows: Flow[];
  iterations: Iteration[];
  parked?: { node: string };
};

export const PROJECT_FILE = 'project.json';
/** Shared plugin data namespace on every node Design Studio makes or adopts. */
export const TAG_NS = 'designstudio';
export type TagKind = 'iteration' | 'flow' | 'states' | 'parked' | 'entry';
export type Tag = { kind: TagKind; iteration?: string; flow?: string };

export const SEP = ' · ';

// ---------- Iteration ids ----------

export type IterationId = { major: number; minor: number };

/** "1", "1.19", "V1.19", " v2 " -> { major, minor }. Anything else -> null. */
export function parseIterationId(s: string): IterationId | null {
  const m = /^\s*[Vv]?(\d{1,4})(?:\.(\d{1,4}))?\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}

/** "1" for 1.0, "1.19" otherwise. */
export const formatId = (id: IterationId) => (id.minor ? `${id.major}.${id.minor}` : `${id.major}`);

/** Same id, written the standard way ("V1.0" -> "1"). Null when it is not an id. */
export function cleanId(s: string): string | null {
  const id = parseIterationId(s);
  return id ? formatId(id) : null;
}

/** Numeric per part: 0.2 < 1 < 1.1 < 1.10. Unparsable ids sort first, by text. */
export function compareIds(a: string, b: string): number {
  const x = parseIterationId(a);
  const y = parseIterationId(b);
  if (!x && !y) return a.localeCompare(b);
  if (!x) return -1;
  if (!y) return 1;
  return x.major - y.major || x.minor - y.minor;
}

export const sortIds = (ids: string[]) => [...ids].sort(compareIds);

/** The next minor in the highest major: ["1", "1.18"] -> "1.19". No ids -> "0.1". */
export function nextMinor(ids: string[]): string {
  const parsed = ids.map(parseIterationId).filter((x): x is IterationId => !!x);
  if (!parsed.length) return '0.1';
  const major = Math.max(...parsed.map((x) => x.major));
  const minor = Math.max(...parsed.filter((x) => x.major === major).map((x) => x.minor));
  return formatId({ major, minor: minor + 1 });
}

/** The next major: ["1.19"] -> "2". No ids -> "1". */
export function bumpMajor(ids: string[]): string {
  const parsed = ids.map(parseIterationId).filter((x): x is IterationId => !!x);
  return formatId({ major: parsed.length ? Math.max(...parsed.map((x) => x.major)) + 1 : 1, minor: 0 });
}

// ---------- Dates ----------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd -> "Tue 20 Oct 2026". An invalid date comes back as given. */
export function weekdayDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return date ?? '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return date;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mon 19 Oct 2026" or "19 Oct 2026" -> "2026-10-19". Null when there is no date in the text. */
export function parseSectionDate(text: string): string | null {
  const m = /(?:\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+)?\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})\b/i.exec(text ?? '');
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Today as yyyy-mm-dd in the local time zone. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ---------- Names ----------

export const slugify = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'flow';

/** "V1.19 · Readiness · Tue 20 Oct 2026". The V stays in Figma for continuity with the existing V1.18 sections. */
export function iterationName(id: string, topic: string, date: string): string {
  return [`V${id}`, topic.trim(), weekdayDate(date)].filter(Boolean).join(SEP);
}

/** "V1.19 · Flow 3 · Connectors" */
export const flowSectionName = (id: string, flow: Pick<Flow, 'n' | 'name'>) => `V${id}${SEP}Flow ${flow.n}${SEP}${flow.name}`;

/** "V1.19 · Flow 3 · States" (or "Before setup", "Branch: no reply") */
export const statesSectionName = (id: string, flow: Pick<Flow, 'n'>, what = 'States') => `V${id}${SEP}Flow ${flow.n}${SEP}${what}`;

/** The header note text layer at the top of an iteration section. */
export const decisionsNoteName = (id: string) => `V${id}${SEP}Decisions`;

/** "03-connectors": the flow's folder name under <project>/flows. */
export const flowDirName = (flow: Pick<Flow, 'n' | 'slug'>) => `${String(flow.n).padStart(2, '0')}-${flow.slug}`;

/** What the sidebar shows for an iteration: "1.19 · Readiness", or "1 · baseline" for the adopted LATEST. */
export function iterationLabel(it: Pick<Iteration, 'id' | 'topic' | 'name'>): string {
  if (it.topic) return `${it.id}${SEP}${it.topic}`;
  if (it.name && /^latest$/i.test(it.name.trim())) return `${it.id}${SEP}baseline`;
  return it.id;
}

export type ParsedSectionName = { id: string; topic: string; date: string | null };

/** "V1.18 · Trust and safety · Mon 19 Oct 2026" -> { id: "1.18", topic, date }. Null when the name is not an iteration. */
export function parseSectionName(name: string): ParsedSectionName | null {
  const m = /^\s*[Vv]?(\d{1,4}(?:\.\d{1,4})?)\s*(?:[·•|-]\s*(.*))?$/.exec(String(name ?? ''));
  if (!m) return null;
  const id = cleanId(m[1]);
  if (!id) return null;
  const parts = (m[2] ?? '').split(/\s*[·•|]\s*/).map((p) => p.trim()).filter(Boolean);
  let date: string | null = null;
  const topic: string[] = [];
  for (const p of parts) {
    const d = parseSectionDate(p);
    if (d && !date && /^\s*(?:\w+\s+)?\d{1,2}\s+\w+\s+\d{4}\s*$/.test(p)) date = d;
    else topic.push(p);
  }
  return { id, topic: topic.join(SEP), date };
}

// ---------- Tags ----------

/** The tag as one string on a map row: "kind;iteration;flow". Empty parts are allowed. */
export const packTag = (t: Tag) => [t.kind, t.iteration ?? '', t.flow ?? ''].join(';');

export function unpackTag(s: unknown): Tag | null {
  if (typeof s !== 'string' || !s) return null;
  const [kind, iteration, flow] = s.split(';');
  if (!['iteration', 'flow', 'states', 'parked', 'entry'].includes(kind)) return null;
  return { kind: kind as TagKind, ...(iteration ? { iteration } : {}), ...(flow ? { flow } : {}) };
}

// ---------- Derived views ----------

/** Iterations sorted by id, oldest first. */
export const sortedIterations = (p: Pick<Project, 'iterations'>) => [...p.iterations].sort((a, b) => compareIds(a.id, b.id));

/** The newest iteration that has a subsection for the flow, else null. */
export function latestOf(p: Pick<Project, 'iterations'>, slug: string): Iteration | null {
  return sortedIterations(p).filter((it) => it.flows?.[slug]).at(-1) ?? null;
}

/** The newest working iteration, else null. */
export const workingIteration = (p: Pick<Project, 'iterations'>) => sortedIterations(p).filter((it) => it.state === 'working').at(-1) ?? null;

export const frozenIds = (p: Pick<Project, 'iterations'>) => sortedIterations(p).filter((it) => it.state === 'frozen').map((it) => it.id);

/** The id a new iteration would get: next minor after every id the project has. */
export const nextIterationId = (p: Pick<Project, 'iterations'>) => nextMinor(p.iterations.map((it) => it.id));

// ---------- Adoption from the file map ----------

/** Map rows as fileMap.ts writes them: [letter, id, name, x, y, w, h, children?, other?, tag?]. */
export type MapRow = [string, string, string, number, number, number, number, MapRow[]?, number?, (string | null)?];
export type MapPages = Array<[string, string, MapRow[], Array<[string, string]>?]>;

export type AdoptProposal = {
  page: { id: string; name: string } | null;
  flows: Flow[];
  iterations: Array<Iteration & { screens: number }>;
  parked: { node: string; name: string } | null;
  /** Page-level sections the matcher could not place, so Richa can see what was skipped. */
  skipped: Array<{ node: string; name: string }>;
};

export const isLatestName = (name: string) => /^\s*latest\s*$/i.test(name ?? '');
export const isParkedName = (name: string) => /^\s*parked\b/i.test(name ?? '');

const idsIn = (row: MapRow, out: Set<string>) => {
  out.add(row[1]);
  for (const k of row[7] ?? []) idsIn(k, out);
  return out;
};

export function screenCount(row: MapRow): number {
  let n = 0;
  for (const k of row[7] ?? []) n += k[0] === 'S' ? screenCount(k) : 1;
  return n;
}

const byPosition = (a: MapRow, b: MapRow) => a[4] - b[4] || a[3] - b[3];

/**
 * Reads Richa's existing page into flows and iterations. Page-level sections named like "V1.18 · ..." are frozen
 * iterations; LATEST is the baseline (id "1") and its child sections are the flows, top to bottom; Parked is the
 * parked section. Nothing is moved or renamed: this is a proposal she confirms before anything is tagged.
 */
export function adoptFromMap(pages: MapPages, opts: { baselineId?: string } = {}): AdoptProposal {
  const baselineId = opts.baselineId ?? '1';
  const score = (top: MapRow[]) => top.filter((n) => n[0] === 'S' && (parseSectionName(n[2]) || isLatestName(n[2]) || isParkedName(n[2]))).length;
  const page = [...pages].sort((a, b) => score(b[2]) - score(a[2]))[0];
  if (!page || score(page[2]) === 0) return { page: null, flows: [], iterations: [], parked: null, skipped: [] };
  const [pageId, pageName, top, starts = []] = page;
  const startIds = starts.map(([id]) => id);
  const flows: Flow[] = [];
  const iterations: AdoptProposal['iterations'] = [];
  const skipped: AdoptProposal['skipped'] = [];
  let parked: AdoptProposal['parked'] = null;
  for (const n of [...top].sort(byPosition)) {
    if (n[0] !== 'S') continue;
    if (isLatestName(n[2])) {
      const kids = (n[7] ?? []).filter((k) => k[0] === 'S').sort(byPosition);
      const flowsIn: Record<string, IterationFlow> = {};
      kids.forEach((k, i) => {
        const inside = idsIn(k, new Set<string>());
        const entry = startIds.filter((id) => inside.has(id));
        const screens = (k[7] ?? []).filter((s) => s[0] !== 'S').sort((a, b) => a[3] - b[3]);
        let slug = slugify(k[2]);
        while (flows.some((f) => f.slug === slug)) slug = `${slug}-${i + 1}`;
        flows.push({ n: i + 1, slug, name: k[2].trim().slice(0, 80), entry: entry.length ? entry : screens[0] ? [screens[0][1]] : [], baseline: k[1] });
        flowsIn[slug] = { node: k[1] };
      });
      iterations.push({ id: baselineId, node: n[1], name: n[2].trim(), state: 'frozen', adopted: true, flows: flowsIn, screens: screenCount(n) });
      continue;
    }
    if (isParkedName(n[2])) {
      if (!parked) parked = { node: n[1], name: n[2].trim() };
      else skipped.push({ node: n[1], name: n[2] });
      continue;
    }
    const parsed = parseSectionName(n[2]);
    if (!parsed) {
      skipped.push({ node: n[1], name: n[2] });
      continue;
    }
    if (iterations.some((it) => it.id === parsed.id)) {
      skipped.push({ node: n[1], name: n[2] });
      continue;
    }
    iterations.push({ id: parsed.id, node: n[1], name: n[2].trim(), topic: parsed.topic || undefined, date: parsed.date ?? undefined, state: 'frozen', adopted: true, screens: screenCount(n) });
  }
  iterations.sort((a, b) => compareIds(a.id, b.id));
  return { page: { id: pageId, name: pageName }, flows, iterations, parked, skipped };
}

// ---------- What the sidebar lists ----------

/** One project folder as /api/projects returns it: its file, its project.json when adopted, and the folder's stage. */
export type ProjectSummary = {
  cwd: string;
  key: string;
  name: string;
  url: string;
  stage: string | null;
  project: Project | null;
  /** Two sections carry one tag (a copy was left behind): the newest id is used, the rest listed here. */
  doubles?: Array<{ tag: Tag; ids: string[] }>;
};

// ---------- Node ids against the latest map ----------

export type TaggedNode = { id: string; tag: Tag };

/**
 * Checks the project's node ids against a map read: an id that is gone but whose tag sits on another section (Richa
 * cut and pasted, or Claude made the section itself) moves to that node; an id with no node and no tag is marked
 * missing. Two nodes with one tag: the newest id (largest first number) wins and the other is listed in `doubles`.
 * Nothing is removed from the project.
 */
export function reconcileNodes(p: Project, tagged: TaggedNode[], ids: Set<string>): { project: Project; doubles: Array<{ tag: Tag; ids: string[] }> } {
  const age = (id: string) => Number(id.split(':')[0]) || 0;
  const byTag = new Map<string, string[]>();
  for (const t of tagged) {
    const k = packTag(t.tag);
    byTag.set(k, [...(byTag.get(k) ?? []), t.id]);
  }
  const doubles: Array<{ tag: Tag; ids: string[] }> = [];
  for (const [k, list] of byTag) if (list.length > 1) doubles.push({ tag: unpackTag(k)!, ids: [...list].sort((a, b) => age(b) - age(a)) });
  const pick = (tag: Tag) => [...(byTag.get(packTag(tag)) ?? [])].sort((a, b) => age(b) - age(a))[0];
  const fix = (node: string | undefined, tag: Tag): { node?: string; missing?: boolean } => {
    if (node && ids.has(node)) return { node };
    const found = pick(tag);
    if (found) return { node: found };
    return node ? { node, missing: true } : {};
  };
  const iterations = p.iterations.map((it) => {
    const self = fix(it.node, { kind: 'iteration', iteration: it.id });
    let flows = it.flows
      ? Object.fromEntries(Object.entries(it.flows).map(([slug, f]) => {
          const main = fix(f.node, { kind: 'flow', iteration: it.id, flow: slug });
          const states = f.states ? fix(f.states, { kind: 'states', iteration: it.id, flow: slug }) : { node: pick({ kind: 'states', iteration: it.id, flow: slug }) };
          return [slug, { ...f, node: main.node ?? f.node, ...(states.node ? { states: states.node } : {}) }];
        }))
      : it.flows;
    // A flow subsection made in Figma after the iteration (by a chat, or by hand and tagged) joins the iteration.
    for (const f of p.flows) {
      if (flows?.[f.slug]) continue;
      const node = pick({ kind: 'flow', iteration: it.id, flow: f.slug });
      if (!node) continue;
      const states = pick({ kind: 'states', iteration: it.id, flow: f.slug });
      flows = { ...(flows ?? {}), [f.slug]: { node, ...(states ? { states } : {}) } };
    }
    const { missing: _drop, ...rest } = it;
    return { ...rest, ...(self.node ? { node: self.node } : {}), ...(self.missing ? { missing: true } : {}), ...(flows ? { flows } : {}) };
  });
  const parked = p.parked ? fix(p.parked.node, { kind: 'parked' }) : null;
  return { project: { ...p, iterations, ...(parked?.node ? { parked: { node: parked.node } } : {}) }, doubles };
}

// ---------- Chat context for the prompt ----------

export type ChatScope = 'flow' | 'project';

export type ChatContext = {
  scope: ChatScope;
  flow?: Flow;
  iteration?: Iteration;
  project: Project;
};

/** The prompt block that scopes a chat to its flow and iteration. Replaces the "Design Studio page" rule. */
export function projectInstructions(ctx: ChatContext): string {
  const frozen = frozenIds(ctx.project);
  const working = sortedIterations(ctx.project).filter((it) => it.state === 'working');
  const never = `Never edit a frozen iteration${frozen.length ? ` (${frozen.join(', ')})` : ''}, the Parked section or the LATEST baseline: they are history. Components get new variants only; old variants stay as they are.`;
  if (ctx.scope === 'flow' && ctx.flow && ctx.iteration) {
    const it = ctx.iteration;
    const inIt = it.flows?.[ctx.flow.slug];
    const others = Object.entries(it.flows ?? {}).filter(([slug]) => slug !== ctx.flow!.slug).map(([slug, f]) => `${slug} ${f.node}`);
    const page = ctx.project.page ? `page "${ctx.project.page.name}" (${ctx.project.page.id})` : 'the flows page';
    const makeSection = it.node
      ? ''
      : `The iteration section is not in Figma yet. Make it first, in one call: a page-level section on ${page} named "${iterationName(it.id, it.topic ?? '', it.date ?? '')}", placed 800px above the topmost iteration section (never move the existing ones), with a text layer "${decisionsNoteName(it.id)}" at its top; inside it your flow subsection. Then set shared plugin data on both: node.setSharedPluginData("${TAG_NS}", "kind", "iteration") and ("${TAG_NS}", "iteration", "${it.id}") and ("${TAG_NS}", "project", "${ctx.project.key}") on the section; kind "flow", iteration "${it.id}", flow "${ctx.flow.slug}" and project on the subsection. Design Studio finds them by these tags after your turn.`;
    return [
      `This chat works on Flow ${ctx.flow.n}${SEP}${ctx.flow.name} in iteration ${iterationLabel(it)} (${it.state}) of this project. Iteration section: ${it.node ?? 'not in Figma yet'}${it.name ? ` "${it.name}"` : ''}.`,
      makeSection,
      inIt ? `Your flow subsection: ${inIt.node} "${flowSectionName(it.id, ctx.flow)}".${inIt.states ? ` Supporting states subsection: ${inIt.states}.` : ` Supporting states (voice, attach, error) go in a sibling subsection "${statesSectionName(it.id, ctx.flow)}" beside it, 400px below when they do not fit beside.`}` : it.node ? `This flow has no subsection in ${it.id} yet: create one named "${flowSectionName(it.id, ctx.flow)}" inside the iteration section ${it.node}, below the other flow subsections with 800px between, tag it (shared plugin data "${TAG_NS}": kind "flow", iteration "${it.id}", flow "${ctx.flow.slug}", project "${ctx.project.key}") and tell the designer its node id.` : '',
      ctx.flow.entry.length ? `Entry screens of this flow: ${ctx.flow.entry.join(', ')}. Copies of them in your subsection are named "<name> (Entry, unchanged)" and stay unchanged; wire links from them into your new screens.` : '',
      ctx.flow.baseline ? `The flow's baseline (frozen, read it for reference): section ${ctx.flow.baseline}.` : '',
      `Edit only inside your flow subsection${inIt?.states ? ' and its states subsection' : ''}: put every new or changed screen there and end each edit with DS.fit on your subsection. Never move or resize other subsections${others.length ? ` (${others.join(', ')})` : ''} or the iteration section itself; Design Studio restacks them. ${never}`,
      it.state === 'frozen' ? `Iteration ${it.id} is frozen. Do not edit it; ask the designer to reopen it or to create a new iteration from the sidebar.` : '',
      'Under each new screen put 3 to 5 Decision stickies right below it, and the flow notes as short bullets, as the designer\'s rules say.',
    ].filter(Boolean).join('\n');
  }
  return [
    `This chat is a project task on this file, not tied to one flow. Flows: ${ctx.project.flows.map((f) => `${f.n} ${f.name}`).join(', ') || 'none yet'}.`,
    working.length ? `Working iterations you may edit: ${working.map((it) => `${iterationLabel(it)} (section ${it.node ?? '?'})`).join('; ')}. Edit only inside flow subsections of those, and shared components (new variants only).` : 'There is no working iteration yet. Before editing flows, ask the designer to create one from the sidebar (New iteration).',
    never,
  ].join('\n');
}
