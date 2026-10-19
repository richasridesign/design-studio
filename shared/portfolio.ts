// Update portfolio: Richa's site richadesign.in, built in Framer. Design Studio reads her finished work (frozen
// iterations: the Decision stickies copied into each flow's history.md, and the screens), suggests portfolio updates
// in her voice, and she picks. Then a copy pack (no Framer key) or edits through the Framer Server API (with a key).
// Design Studio never publishes: that is her click in Framer.
//
// Pure helpers shared by the server and the web app. No Node imports.

import { stripMarkers } from './history.js';

export const SITE_DEFAULT = 'richadesign.in';
/** The folder under the projects root. It has no figma.json, so the project list skips it. */
export const PORTFOLIO_FOLDER = 'portfolio-richadesign-in';
export const MAX_SUGGESTIONS = 8;
/** Longest line in a draft, in characters. */
export const DRAFT_LINE_MAX = 160;
/** A sentence over this many words gets a gentle flag: her voice is short sentences. */
export const LONG_WORDS = 25;

/** Public pages of the site, read for structure (plain GET, no login). The Resume link is external and never read. */
export const SITE_PAGES: Array<{ path: string; title: string }> = [
  { path: '/', title: 'Home' },
  { path: '/creative', title: 'Creative' },
  { path: '/agentic-configuration-and-act', title: 'Agentic configuration' },
  { path: '/track.bill.focus', title: 'Track. Bill. Focus.' },
  { path: '/automate-league', title: 'Automate league' },
  { path: '/helpdesk-dashboard', title: 'Helpdesk dashboard' },
  { path: '/design-system', title: 'Design system' },
  { path: '/game-shop', title: 'Game shop' },
];

export type Clearance = 'ask' | 'cleared' | 'never';
export const CLEARANCE_LABEL: Record<Clearance, string> = { ask: 'Ask each time', cleared: 'Cleared, hide names', never: 'Never' };

/**
 * chrome: Claude edits the Framer editor in her signed-in Chrome (how every past edit was made). copy: a copy pack she
 * pastes. api: the Framer Server API, on hold until the Phase 0 spike adopts it.
 */
export type FramerMode = 'chrome' | 'api' | 'copy';
/** framer.json. Never holds the key: hasKey only says one is in the Keychain for this project. */
export type FramerConfig = { site: string; project: string; mode: FramerMode; hasKey?: boolean };

export type UseRecord = { frozenAt: number; run: string; state: 'edited' | 'published' };
export type SkipRecord = { frozenAt: number; run: string; why?: string };

export type PortfolioFile = {
  lastUpdate?: { at: number; run: string };
  /** yyyy-mm-dd. Work frozen before it is not offered. Unset: each project's adoption date. */
  since?: string;
  clearance: Record<string, Clearance>;
  used: Record<string, UseRecord>;
  skipped: Record<string, SkipRecord>;
  /** Read the adopted iterations (no history file) straight from Figma too. Off by default. */
  includeAdopted?: boolean;
};

export const emptyPortfolio = (): PortfolioFile => ({ clearance: {}, used: {}, skipped: {} });

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Keeps only known fields, so a hand edit never breaks the gather. */
export function cleanPortfolio(input: unknown): PortfolioFile {
  const o = isObj(input) ? input : {};
  const out = emptyPortfolio();
  if (isObj(o.lastUpdate) && typeof o.lastUpdate.run === 'string') out.lastUpdate = { at: num(o.lastUpdate.at), run: o.lastUpdate.run };
  if (typeof o.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.since)) out.since = o.since;
  for (const [k, v] of Object.entries(isObj(o.clearance) ? o.clearance : {})) if (v === 'ask' || v === 'cleared' || v === 'never') out.clearance[k] = v;
  for (const [k, v] of Object.entries(isObj(o.used) ? o.used : {})) if (isObj(v)) out.used[k] = { frozenAt: num(v.frozenAt), run: String(v.run ?? ''), state: v.state === 'published' ? 'published' : 'edited' };
  for (const [k, v] of Object.entries(isObj(o.skipped) ? o.skipped : {})) if (isObj(v)) out.skipped[k] = { frozenAt: num(v.frozenAt), run: String(v.run ?? ''), ...(typeof v.why === 'string' && v.why ? { why: v.why.slice(0, 160) } : {}) };
  if (o.includeAdopted === true) out.includeAdopted = true;
  return out;
}

export function cleanConfig(input: unknown): FramerConfig | null {
  const o = isObj(input) ? input : null;
  if (!o || typeof o.site !== 'string' || !o.site) return null;
  const hasKey = o.hasKey === true;
  // The API route only counts once a key passed its check; else Chrome stays the route.
  const mode: FramerMode = o.mode === 'copy' ? 'copy' : o.mode === 'api' && hasKey ? 'api' : 'chrome';
  return { site: o.site, project: typeof o.project === 'string' ? o.project : '', mode, ...(hasKey ? { hasKey } : {}) };
}

// ---------- Blocks of finished work ----------

/** One frozen iteration of one flow: "<figmaKey>/<iterationId>/<flowSlug>". */
export const blockKey = (figmaKey: string, iteration: string, flow: string) => `${figmaKey}/${iteration}/${flow}`;

/** Offered when never used or skipped, or frozen again after it was (reopened and frozen). */
export function isNew(file: PortfolioFile, key: string, frozenAt: number): boolean {
  const seen = file.used[key] ?? file.skipped[key];
  return !seen || frozenAt > seen.frozenAt;
}

/** yyyy-mm-dd at local midnight, as a time. */
export const dayStart = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0;
};

export type BlockRef = {
  key: string;
  project: { key: string; name: string; root: string };
  iteration: { id: string; title: string; frozenAt: number; adopted: boolean };
  flow: { n: number; slug: string; name: string };
  clearance: Clearance;
};

/** "Harisson · 1.19 · Flow 3 · Connectors" */
export const blockLabel = (b: Pick<BlockRef, 'project' | 'iteration' | 'flow'>) => `${b.project.name} · ${b.iteration.id} · Flow ${b.flow.n} · ${b.flow.name}`;

export type ScreenNote = { id?: string; name: string; link?: string; decisions: Array<{ decision: string; why?: string }> };

/**
 * The Decisions part of one iteration's block in a flow's history.md, by screen. Only the decisions: what was done
 * can quote typed chat text, so it is never read for the portfolio.
 */
export function decisionsOf(md: string, iteration: string): ScreenNote[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const marker = `<!-- ds:iteration ${iteration} -->`;
  const at = lines.findIndex((l) => l.trim() === marker);
  if (at < 0) return [];
  const open = lines.findIndex((l, i) => i > at && new RegExp(`^<!-- ds:decisions ${iteration.replace(/\./g, '\\.')}( [^>]*)? -->$`).test(l.trim()));
  const close = lines.findIndex((l, i) => i > open && l.trim() === `<!-- /ds:decisions ${iteration} -->`);
  if (open < 0 || close < 0) return [];
  // Another iteration's block between them means the markers belong to a hand-edited mix: read nothing.
  if (lines.slice(at + 1, open).some((l) => /^<!-- ds:iteration /.test(l.trim()))) return [];
  const out: ScreenNote[] = [];
  for (const raw of stripMarkers(lines.slice(open + 1, close).join('\n')).split('\n')) {
    const l = raw.trim();
    const head = /^####\s+(.*?)(?:\s+·\s+\[Open in Figma\]\(([^)]+)\))?\s*$/.exec(l);
    if (head) {
      const link = head[2];
      const id = link ? /node-id=([\d]+-[\d]+)/.exec(link)?.[1]?.replace('-', ':') : undefined;
      out.push({ name: head[1], ...(link ? { link } : {}), ...(id ? { id } : {}), decisions: [] });
      continue;
    }
    const item = /^-\s+\*\*(.+?)\*\*\s*(?:Why:\s*(.*))?$/.exec(l);
    if (item && out.length) out[out.length - 1].decisions.push({ decision: item[1].trim(), ...(item[2]?.trim() ? { why: item[2].trim() } : {}) });
  }
  return out.filter((s) => s.decisions.length);
}

// ---------- Setup ----------

export const PROJECT_LINK = /^https:\/\/(www\.)?framer\.com\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*(\/|\?.*)?$/;

export function projectLinkError(url: string): string {
  const s = url.trim();
  if (!s) return 'Paste the link of your Framer project';
  return PROJECT_LINK.test(s) ? '' : 'This is not a Framer project link';
}

export function siteError(site: string): string {
  const s = site.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!s) return 'Type your site address';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) ? '' : 'Type the address without a path, like richadesign.in';
}

export const cleanSite = (site: string) => site.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();

/** Framer keys are plain tokens. Anything else is refused before it reaches the Keychain. */
export function keyError(key: string): string {
  const s = key.trim();
  if (!s) return 'Paste the API key';
  return /^[A-Za-z0-9._-]{8,200}$/.test(s) ? '' : 'This does not look like a Framer API key';
}

// ---------- Her voice ----------

const DASHES = /\s*[\u2014\u2013]\s*/g;

/** Em and en dashes become commas: her copy never has them. */
export const stripDashes = (s: string) => String(s ?? '').replace(DASHES, ', ').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '');

/** The error under a draft, or '' when it can be used. */
export function draftError(text: string): string {
  if (/[\u2014]/.test(text)) return 'Remove the em dash';
  if (text.split('\n').some((l) => l.length > DRAFT_LINE_MAX)) return `Keep each line under ${DRAFT_LINE_MAX} characters`;
  if (!text.trim()) return 'Write the copy, or skip this suggestion';
  return '';
}

/** Sentences over LONG_WORDS words, for a gentle note under the draft. */
export function longSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).filter(Boolean).length > LONG_WORDS);
}

// ---------- Confidential work ----------

export type FlagKind = 'client' | 'product' | 'person' | 'number' | 'data';
export type Flag = { kind: FlagKind; text: string };
const FLAG_LABEL: Record<FlagKind, string> = { client: 'Names a client', product: 'Names a product', person: 'Names a person', number: 'Shows real numbers', data: 'Shows real data' };

/** Percentages, money, multiples and counts of 10 and more (years are left alone). */
const NUMBER = /(?:[$€£₹]\s?\d[\d,.]*\s?[kmb]?)|(?:\b\d+(?:[.,]\d+)?\s?(?:%|x\b|k\b))|(?:\b(?!(?:19|20)\d{2}\b)\d{2,}(?:[.,]\d+)?\b)/gi;

/** Flags the server finds by itself: names it knows (projects, clients) and numbers. Claude adds more. */
export function findFlags(text: string, names: Array<{ name: string; kind: FlagKind }>): Flag[] {
  const out: Flag[] = [];
  const low = text.toLowerCase();
  for (const n of names) {
    const name = n.name.trim();
    if (name.length >= 3 && low.includes(name.toLowerCase()) && !out.some((f) => f.text.toLowerCase() === name.toLowerCase())) out.push({ kind: n.kind, text: name });
  }
  for (const m of text.matchAll(NUMBER)) {
    const t = m[0].trim();
    if (!out.some((f) => f.text === t)) out.push({ kind: 'number', text: t });
  }
  return out;
}

export function mergeFlags(a: Flag[], b: Flag[]): Flag[] {
  const out = [...a];
  for (const f of b) if (f.text.trim() && !out.some((x) => x.text.toLowerCase() === f.text.toLowerCase())) out.push(f);
  return out.slice(0, 12);
}

/** "Names a client: Leena AI. Shows real numbers: 40%, 3x." */
export function flagLine(flags: Flag[]): string {
  const by = new Map<FlagKind, string[]>();
  for (const f of flags) by.set(f.kind, [...(by.get(f.kind) ?? []), f.text]);
  return [...by.entries()].map(([k, v]) => `${FLAG_LABEL[k]}: ${v.join(', ')}.`).join(' ');
}

/** "Cleared, hide names": the client becomes the kind of company and numbers go, unless she types them back. */
export function hideNames(text: string, flags: Flag[], kindOfCompany = 'an HR SaaS company'): string {
  let t = text;
  for (const f of flags) {
    const re = new RegExp(f.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (f.kind === 'client') t = t.replace(re, kindOfCompany);
    else if (f.kind === 'product') t = t.replace(re, 'the product');
    else if (f.kind === 'person') t = t.replace(re, 'a teammate');
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

// ---------- Suggestions ----------

export type SuggestionKind = 'add' | 'change' | 'new-case-study' | 'new-image';
export const KIND_LABEL: Record<SuggestionKind, string> = { add: 'Add', change: 'Change', 'new-case-study': 'New case study', 'new-image': 'New image' };

export type Suggestion = {
  id: string;
  /** A site path ("/helpdesk-dashboard") or "new". */
  page: string;
  section: string;
  kind: SuggestionKind;
  what: string;
  why: string;
  /** Block keys it rests on, with the decisions it quotes. */
  sources: Array<{ block: string; quotes: string[] }>;
  draft: string;
  /** Screen node ids it wants to show. */
  images: string[];
  flags: Flag[];
};

export const pageTitle = (p: string) => (p === 'new' ? 'New page' : SITE_PAGES.find((x) => x.path === p)?.title ?? p.replace(/^\//, '').replace(/[-.]/g, ' '));

/** "Change · Helpdesk dashboard · Results" */
export const suggestionHead = (s: Pick<Suggestion, 'kind' | 'page' | 'section'>) => [KIND_LABEL[s.kind], pageTitle(s.page), s.section].filter(Boolean).join(' · ');

const str = (v: unknown, max: number) => stripDashes(String(v ?? '')).replace(/\s+$/g, '').slice(0, max);

/**
 * Claude's suggestions, checked: known blocks and screens only, dashes stripped, the server's own flags added to
 * Claude's, at most MAX_SUGGESTIONS, ids s1..sN in Claude's order (most useful first).
 */
export function cleanSuggestions(raw: unknown, blocks: Array<{ key: string; screens: string[] }>, names: Array<{ name: string; kind: FlagKind }>): Suggestion[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const known = new Map(blocks.map((b) => [b.key, new Set(b.screens)]));
  const out: Suggestion[] = [];
  for (const r of list) {
    if (!isObj(r) || out.length >= MAX_SUGGESTIONS) continue;
    const kind: SuggestionKind = ['add', 'change', 'new-case-study', 'new-image'].includes(r.kind) ? r.kind : 'add';
    const page = typeof r.page === 'string' && (r.page === 'new' || r.page.startsWith('/')) ? r.page.slice(0, 120) : kind === 'new-case-study' ? 'new' : '/';
    const sources = (Array.isArray(r.sources) ? r.sources : [])
      .filter((s: any) => isObj(s) && known.has(String(s.block)))
      .map((s: any) => ({ block: String(s.block), quotes: (Array.isArray(s.quotes) ? s.quotes : []).map((q: unknown) => str(q, 240)).filter(Boolean).slice(0, 5) }));
    if (!sources.length) continue;
    const screens = new Set(sources.flatMap((s: { block: string }) => [...(known.get(s.block) ?? [])]));
    const draft = String(r.draft ?? '').split('\n').map((l) => stripDashes(l)).join('\n').trim().slice(0, 4000);
    const claudeFlags: Flag[] = (Array.isArray(r.flags) ? r.flags : [])
      .filter((f: any) => isObj(f) && typeof f.text === 'string' && f.text.trim())
      .map((f: any) => ({ kind: (['client', 'product', 'person', 'number', 'data'].includes(f.kind) ? f.kind : 'data') as FlagKind, text: String(f.text).trim().slice(0, 80) }));
    out.push({
      id: `s${out.length + 1}`,
      page,
      section: str(r.section, 60),
      kind,
      what: str(r.what, 200),
      why: str(r.why, 240),
      sources,
      draft,
      images: (Array.isArray(r.images) ? r.images : []).map(String).filter((id: string) => screens.has(id)).slice(0, 6),
      flags: mergeFlags(claudeFlags, findFlags(draft, names)),
    });
  }
  return out;
}

// ---------- Picks ----------

export type Choice = 'use' | 'skip' | 'later';
export type PickEntry = { choice: Choice | null; draft: string; images: string[]; cleared: boolean };
export type Picks = Record<string, PickEntry>;

export const startPick = (s: Suggestion): PickEntry => ({ choice: null, draft: s.draft, images: [], cleared: false });
export const pickOf = (picks: Picks, s: Suggestion): PickEntry => picks[s.id] ?? startPick(s);

/** True when a picked suggestion still needs her tick: flags in the text, or any image (screens can hold real data). */
export const needsTick = (s: Suggestion, p: PickEntry) => s.flags.length > 0 || p.images.length > 0;

export type PickSummary = { picked: number; total: number; blocker: string | null; blockerId: string | null };

/** "3 of 6 picked", and the reason the edit button is off, naming the card that blocks it. */
export function pickSummary(list: Suggestion[], picks: Picks): PickSummary {
  const used = list.filter((s) => pickOf(picks, s).choice === 'use');
  const total = list.length;
  if (!used.length) return { picked: 0, total, blocker: 'Pick at least one suggestion to use', blockerId: null };
  for (const s of used) {
    const p = pickOf(picks, s);
    const err = draftError(p.draft);
    if (err) return { picked: used.length, total, blocker: `${suggestionHead(s)}: ${err}`, blockerId: s.id };
    if (needsTick(s, p) && !p.cleared) return { picked: used.length, total, blocker: `${suggestionHead(s)}: tick "I can show this" first`, blockerId: s.id };
  }
  return { picked: used.length, total, blocker: null, blockerId: null };
}

/** What each block ends as after a run: used (a suggestion from it was used), skipped (all skipped), or kept for later. */
export function blockOutcome(list: Suggestion[], picks: Picks, keys: string[]): Record<string, 'used' | 'skipped' | 'later'> {
  const out: Record<string, 'used' | 'skipped' | 'later'> = {};
  for (const key of keys) {
    const from = list.filter((s) => s.sources.some((x) => x.block === key));
    const choices = from.map((s) => pickOf(picks, s).choice);
    out[key] = choices.includes('use') ? 'used' : choices.some((c) => c === 'later' || c === null) ? 'later' : 'skipped';
  }
  return out;
}

// ---------- Copy pack ----------

export type CopyItem = { id: string; head: string; page: string; section: string; blocks: string[]; images: string[] };

/** The copy to paste, one card per used suggestion, split into paragraphs with a Copy button each. */
export function copyPack(list: Suggestion[], picks: Picks): CopyItem[] {
  return list
    .filter((s) => pickOf(picks, s).choice === 'use')
    .map((s) => {
      const p = pickOf(picks, s);
      return { id: s.id, head: suggestionHead(s), page: s.page, section: s.section, blocks: p.draft.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean), images: p.images };
    });
}

// ---------- Edits (Framer, with a key) ----------

export type EditPlanItem =
  | { id: string; suggestion: string; kind: 'text'; page: string; node: string; old: string; text: string }
  | { id: string; suggestion: string; kind: 'copy'; reason: string };

export type EditState = 'waiting' | 'done' | 'failed' | 'undone' | 'copy';

// ---------- Framer's Publish panel ----------

/**
 * One reading of the Publish panel in the Framer editor, before and after each run (publish-before.json,
 * publish-after.json). lastPublishedAt is the time of the last publish, so a reading an hour later still compares.
 */
export type PublishReading = { at: number; lastPublishedAt: number | null; changed: string[]; warnings: string[] };

export function cleanReading(input: unknown, at: number): PublishReading | null {
  const o = isObj(input) ? input : null;
  if (!o) return null;
  const paths = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((p) => p.startsWith('/')).slice(0, 50) : []);
  const t = Number(o.lastPublishedAt);
  return { at, lastPublishedAt: Number.isFinite(t) && t > 0 ? t : null, changed: paths(o.changed), warnings: (Array.isArray(o.warnings) ? o.warnings : []).map((w) => oneLineText(String(w), 160)).filter(Boolean).slice(0, 10) };
}

const oneLineText = (s: string, max: number) => stripDashes(s).replace(/\s+/g, ' ').trim().slice(0, max);

/** True when a publish happened between the two readings: one she did not make during a run. */
export const publishMoved = (before: PublishReading, after: PublishReading) => after.lastPublishedAt !== before.lastPublishedAt;

/** "Framer: Published Sat 17 Oct, 23:22. No unpublished changes." */
export function publishLine(r: PublishReading): string {
  const when = r.lastPublishedAt ? (() => { const d = new Date(r.lastPublishedAt); return `Published ${shortDate(r.lastPublishedAt)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })() : 'Never published';
  const changes = r.changed.length ? `Unpublished changes: ${r.changed.join(', ')}.` : 'No unpublished changes.';
  return `Framer: ${when}. ${changes}`;
}

/** Pages this run changed, and pages changed outside it (pending before the run, or not touched by an edit). */
export function changedPages(before: PublishReading, after: PublishReading, touched: string[]): { changed: string[]; outside: string[] } {
  const t = new Set(touched);
  return { changed: after.changed.filter((p) => t.has(p)), outside: [...new Set([...before.changed, ...after.changed])].filter((p) => !t.has(p)) };
}
export type EditRecord = EditPlanItem & { state: EditState; error?: string };

// ---------- Runs ----------

export type RunState =
  | 'gathering' | 'gather-failed'
  | 'suggesting' | 'suggest-failed'
  | 'picking'
  | 'planning' | 'plan' | 'plan-failed'
  | 'editing' | 'edited' | 'edit-failed'
  /** The Publish panel moved during the run: a publish she did not make. The run stops. */
  | 'publish-changed'
  | 'copy'
  | 'done' | 'stopped';

export type Run = {
  id: string;
  state: RunState;
  startedAt: number;
  blocks: string[];
  mode: FramerMode;
  error?: string;
  /** Shown while a step runs. */
  progress?: string;
  /** Screens the gather wants to export, for the running line. */
  screens?: number;
  /** The Figma part that did not work, kept as a note when the run went on without it. */
  note?: string;
  /** Paths the edits changed, and others Framer lists as unpublished. */
  changed?: string[];
  outside?: string[];
  published?: boolean;
  /** The Publish panel before and after the edits, as lines, and its warnings (nested links blocked a publish once). */
  publishBefore?: string;
  publishAfter?: string;
  warnings?: string[];
  doneAt?: number;
  used?: number;
  skipped?: number;
};

export type Step = 'gather' | 'pick' | 'edit' | 'publish';
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'gather', label: 'Gather' },
  { id: 'pick', label: 'Pick' },
  { id: 'edit', label: 'Edit' },
  { id: 'publish', label: 'Publish' },
];

export function stepOf(state: RunState | null): Step | 'done' {
  switch (state) {
    case null: case 'gathering': case 'gather-failed': case 'suggesting': case 'suggest-failed': case 'stopped': return 'gather';
    case 'picking': return 'pick';
    case 'planning': case 'plan': case 'plan-failed': case 'editing': case 'edit-failed': case 'publish-changed': case 'copy': return 'edit';
    case 'edited': return 'publish';
    case 'done': return 'done';
  }
}

/** Each step as done, current or to do, for the strip. Shape and text carry the state. */
export function strip(state: RunState | null): Array<{ id: Step; label: string; state: 'done' | 'current' | 'todo' }> {
  const at = stepOf(state);
  const i = at === 'done' ? STEPS.length : STEPS.findIndex((s) => s.id === at);
  return STEPS.map((s, n) => ({ ...s, state: n < i ? 'done' : n === i ? 'current' : 'todo' }));
}

export const RUNNING: RunState[] = ['gathering', 'suggesting', 'planning', 'editing'];
export const isRunning = (s: RunState) => RUNNING.includes(s);

/** The short state word in the sidebar and run list. */
export const RUN_LABEL: Record<RunState, string> = {
  gathering: 'Gathering', 'gather-failed': 'Could not gather',
  suggesting: 'Suggesting', 'suggest-failed': 'Could not suggest',
  picking: 'Waiting for your picks',
  planning: 'Planning', plan: 'Plan ready', 'plan-failed': 'Could not plan',
  editing: 'Editing', edited: 'Edited, not published', 'edit-failed': 'Edit stopped', 'publish-changed': 'Framer published',
  copy: 'Copy pack ready',
  done: 'Done', stopped: 'Stopped',
};

/** Shape for the state: ring for waiting on her, filled for done, spinner for running, cross for failed. */
export function runShape(s: RunState): 'running' | 'waiting' | 'done' | 'failed' {
  if (isRunning(s)) return 'running';
  if (s.endsWith('failed') || s === 'stopped' || s === 'publish-changed') return 'failed';
  if (s === 'done') return 'done';
  return 'waiting';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 20 Oct" */
export const shortDate = (t: number) => { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/** "20261020-140205": sortable, safe as a folder name. */
export function runId(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export const isRunId = (s: string) => /^\d{8}-\d{6}$/.test(s);

// ---------- History ----------

/** One block for the portfolio's own history.md, newest first. */
export function runBlock(run: Run, list: Suggestion[], picks: Picks, blocks: Array<{ key: string; label: string }>, edits: EditRecord[], at: Date): string {
  const used = list.filter((s) => pickOf(picks, s).choice === 'use');
  const skipped = list.filter((s) => pickOf(picks, s).choice === 'skip');
  const lines = [
    `## ${shortDate(at.getTime())} ${at.getFullYear()} · Run ${run.id}`,
    `<!-- ds:run ${run.id} -->`,
    `Picked: ${used.length} · Skipped: ${skipped.length} · Published: ${run.published ? 'yes' : 'Not published'}`,
    '',
    '### Edits',
    ...(used.length ? used.map((s) => `- ${suggestionHead(s)}: ${s.what}${edits.some((e) => e.suggestion === s.id && e.kind === 'copy') || run.mode === 'copy' ? ' (copy pack)' : ''}`) : ['- None']),
    '',
    '### From',
    ...blocks.map((b) => `- ${b.label}`),
    '',
  ];
  return lines.join('\n');
}

/** Adds or replaces a run's block at the top of the portfolio history. */
export function upsertRunBlock(md: string, id: string, block: string): string {
  const head = '# Portfolio · richadesign.in\n<!-- Design Studio writes this file. -->\n';
  const body = md.trim() ? md.replace(/\r\n/g, '\n') : head;
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim() === `<!-- ds:run ${id} -->`);
  if (at > 0) {
    const start = lines[at - 1].startsWith('## ') ? at - 1 : at;
    let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    if (end < 0) end = lines.length;
    return `${[...lines.slice(0, start), ...block.trimEnd().split('\n'), '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }
  const first = lines.findIndex((l) => l.startsWith('## '));
  const cut = first < 0 ? lines.length : first;
  return `${[...lines.slice(0, cut), ...(cut && lines[cut - 1].trim() ? [''] : []), ...block.trimEnd().split('\n'), '', ...lines.slice(cut)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The line in each source flow's history: "Used on the portfolio: /helpdesk-dashboard, Results". */
export function usedLine(list: Suggestion[]): string {
  const parts = [...new Set(list.map((s) => `${s.page === 'new' ? 'a new case study' : s.page}${s.section ? `, ${s.section}` : ''}`))];
  return `Used on the portfolio: ${parts.join('; ')}`;
}
