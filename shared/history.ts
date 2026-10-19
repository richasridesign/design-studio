// The history file of one flow: flows/NN-slug/history.md beside flow.json. One block per iteration, newest first,
// with the decisions (copied one way from the Decision stickies in Figma) and what was done. Only Design Studio
// writes it, through these helpers. Each block's parts sit between marker comments, so lines the designer adds
// outside them are kept, and a block whose markers were edited away gets a new one instead of losing her text.
// No Node imports: the web app reads the same file through parseHistory.

import { compareIds } from './project.js';

export const HISTORY_FILE = 'history.md';
/** Longest line written into the file, in characters. */
export const LINE_MAX = 160;

export type HistoryFlow = { n: number; name: string };
export type HistoryIteration = { id: string; title: string; state: 'working' | 'frozen'; link?: string };
export type StickyText = { decision: string; why?: string };
export type ScreenDecisions = { id: string; name: string; link?: string; stickies: StickyText[] };

const NOTE = '<!-- Design Studio writes this file. Lines you add outside the marked blocks are kept. -->';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One line of plain text: no marker comments, no line breaks, at most `max` characters. */
export function oneLine(s: unknown, max = LINE_MAX): string {
  const t = String(s ?? '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const itMarker = (id: string) => `<!-- ds:iteration ${id} -->`;
const itRe = /^<!-- ds:iteration (\S+) -->$/;
const openRe = (part: string, id: string) => new RegExp(`^<!-- ds:${part} ${esc(id)}(?: ([^>]*?))? -->$`);
const closeLine = (part: string, id: string) => `<!-- /ds:${part} ${id} -->`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
/** "Tue 20 Oct 14:02", in local time. */
export const stamp = (d: Date) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;

export const historyHead = (flow: HistoryFlow) => `# Flow ${flow.n} · ${oneLine(flow.name, 80)}\n${NOTE}\n`;

const metaLine = (it: HistoryIteration) => `State: ${it.state === 'frozen' ? 'Frozen' : 'Working'}${it.link ? ` · [Open in Figma](${it.link})` : ''}`;

function iterationBlock(it: HistoryIteration): string[] {
  return [
    `## ${oneLine(it.title, 120)}`,
    itMarker(it.id),
    metaLine(it),
    '',
    '### Decisions',
    `<!-- ds:decisions ${it.id} -->`,
    'Not read from Figma yet.',
    closeLine('decisions', it.id),
    '',
    '### What was done',
    `<!-- ds:done ${it.id} -->`,
    closeLine('done', it.id),
    '',
  ];
}

type Found = { id: string; marker: number; start: number };

/** Every iteration block: its marker line and the line its heading starts on. */
function blocks(lines: string[]): Found[] {
  const out: Found[] = [];
  lines.forEach((l, i) => {
    const m = itRe.exec(l.trim());
    if (!m) return;
    const start = i > 0 && lines[i - 1].startsWith('## ') ? i - 1 : i;
    out.push({ id: m[1], marker: i, start });
  });
  return out;
}

/** The lines of one iteration's block: from its heading to the next iteration's heading (or the end). */
function range(lines: string[], id: string): { start: number; end: number; marker: number } | null {
  const all = blocks(lines);
  const i = all.findIndex((b) => b.id === id);
  if (i < 0) return null;
  return { start: all[i].start, marker: all[i].marker, end: all[i + 1]?.start ?? lines.length };
}

const split = (md: string) => md.replace(/\r\n/g, '\n').split('\n');
const join = (lines: string[]) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;

/**
 * Makes sure the file has its head and a block for this iteration, newest first, and keeps the block's state line
 * up to date. Text outside the marked parts stays as it is.
 */
export function ensureIteration(md: string, flow: HistoryFlow, it: HistoryIteration): string {
  let lines = md.trim() ? split(md) : split(historyHead(flow));
  const r = range(lines, it.id);
  if (r) {
    const next = lines[r.marker + 1] ?? '';
    if (/^State: /.test(next)) lines[r.marker + 1] = metaLine(it);
    else lines.splice(r.marker + 1, 0, metaLine(it));
    return join(lines);
  }
  const all = blocks(lines);
  const before = all.find((b) => compareIds(b.id, it.id) < 0);
  const at = before ? before.start : lines.length;
  const block = iterationBlock(it);
  if (!before && lines.length && lines[lines.length - 1].trim()) block.unshift('');
  lines = [...lines.slice(0, at), ...block, ...lines.slice(at)];
  return join(lines);
}

/** Puts `body` between the part's markers, or adds the part at the end of the block when they are gone. */
function setPart(md: string, id: string, part: 'decisions' | 'done', heading: string, attrs: string, edit: (body: string[]) => string[]): string {
  const lines = split(md);
  const r = range(lines, id);
  const from = r ? r.start : 0;
  const to = r ? r.end : lines.length;
  const open = openRe(part, id);
  const o = lines.findIndex((l, i) => i >= from && i < to && open.test(l.trim()));
  const c = o < 0 ? -1 : lines.findIndex((l, i) => i > o && i < to && l.trim() === closeLine(part, id));
  const marker = `<!-- ds:${part} ${id}${attrs ? ` ${attrs}` : ''} -->`;
  if (o >= 0 && c > o) {
    const body = edit(lines.slice(o + 1, c));
    return join([...lines.slice(0, o), marker, ...body, ...lines.slice(c)]);
  }
  // A hand edit removed a marker: add a fresh part, never remove her lines.
  let end = to;
  while (end > from && !lines[end - 1].trim()) end--;
  const added = ['', heading, marker, ...edit([]), closeLine(part, id), ''];
  return join([...lines.slice(0, end), ...added, ...lines.slice(end)]);
}

/** The attributes on a part's opening marker, like { synced: "2026-10-20T15:10:00.000Z" }. */
function attrsOf(md: string, id: string, part: 'decisions' | 'done'): Record<string, string> {
  const open = openRe(part, id);
  const line = split(md).find((l) => open.test(l.trim()));
  const raw = line ? open.exec(line.trim())?.[1] ?? '' : '';
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/(\w+) (\S+)/g)) out[m[1]] = m[2];
  return out;
}

const attrText = (a: Record<string, string>) => Object.entries(a).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' ');

/** When the decisions were last read from Figma, and when the flow was last edited after that, as times. */
export function decisionTimes(md: string, id: string): { synced: number | null; edited: number | null } {
  const a = attrsOf(md, id, 'decisions');
  const t = (s?: string) => (s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);
  return { synced: t(a.synced), edited: t(a.edited) };
}

/** Lines for one sticky: the decision in bold, then its reason. */
export function stickyLine(s: StickyText): string {
  const d = oneLine(s.decision);
  const why = s.why ? oneLine(s.why) : '';
  return `- **${d.replace(/\*\*/g, '')}**${why ? ` Why: ${why}` : ''}`;
}

/** The Decisions part for one iteration, grouped by screen, in the order the screens sit. */
export function decisionsBody(screens: ScreenDecisions[]): string[] {
  if (!screens.length) return ['No screens in this flow subsection yet.'];
  const out: string[] = [];
  const bare: string[] = [];
  for (const s of screens) {
    if (!s.stickies.length) { bare.push(oneLine(s.name, 60)); continue; }
    out.push(`#### ${oneLine(s.name, 80)}${s.link ? ` · [Open in Figma](${s.link})` : ''}`);
    for (const st of s.stickies) out.push(stickyLine(st));
    out.push('');
  }
  if (bare.length) out.push(oneLine(`No stickies: ${bare.join(', ')}`, LINE_MAX * 2));
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** Replaces this iteration's decisions with the ones read from Figma. Only the part between its markers changes. */
export function replaceDecisions(md: string, id: string, screens: ScreenDecisions[], syncedAt: Date): string {
  const a = attrsOf(md, id, 'decisions');
  return setPart(md, id, 'decisions', '### Decisions', attrText({ synced: syncedAt.toISOString(), edited: a.edited ?? '' }), () => decisionsBody(screens));
}

/** Marks the decisions stale: the flow was edited after they were last read. */
export function markEdited(md: string, id: string, at: Date): string {
  const a = attrsOf(md, id, 'decisions');
  return setPart(md, id, 'decisions', '### Decisions', attrText({ synced: a.synced ?? '', edited: at.toISOString() }), (body) => (body.length ? body : ['Not read from Figma yet.']));
}

/** Adds one line to what was done in this iteration: "- Tue 20 Oct 14:02 · <text>". */
export function appendDone(md: string, id: string, text: string, at: Date): string {
  const head = `- ${stamp(at)} · `;
  const line = `${head}${oneLine(text, LINE_MAX - head.length)}`;
  return setPart(md, id, 'done', '### What was done', '', (body) => [...body.filter((l) => l.trim()), line]);
}

// ---------- Reading ----------

/** Sticky text as Figma has it (text properties or text layers, in order) -> the decision and its reason. */
export function parseSticky(parts: Array<{ key?: string; text: string }>): StickyText | null {
  let why = '';
  const rest: string[] = [];
  for (const p of parts) {
    const text = String(p.text ?? '');
    if (p.key && /why|reason/i.test(p.key)) { why = text.replace(/^\s*why\s*:\s*/i, ''); continue; }
    for (const line of text.split(/\n+/)) {
      const m = /^\s*why\s*:\s*(.*)$/i.exec(line);
      if (m && !why) why = m[1];
      else if (m) why += ` ${m[1]}`;
      else if (line.trim()) rest.push(line.trim());
    }
  }
  // "Decision 1" on its own is the sticky's label, not the decision.
  const decision = rest.filter((l) => !/^decision\s*\d*\s*$/i.test(l)).join(' ');
  if (!decision.trim() && !why.trim()) return null;
  return { decision: oneLine(decision || why), ...(decision && why.trim() ? { why: oneLine(why) } : {}) };
}

export type HistoryBlock = { id: string | null; heading: string; body: string; synced: number | null; edited: number | null };

/** Removes marker comments and the blank lines they leave. */
export const stripMarkers = (s: string) => s.split('\n').filter((l) => !/^\s*<!--.*-->\s*$/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/** The file as the History tab shows it: its title and one block per "## " heading, in file order (newest first). */
export function parseHistory(md: string): { title: string; blocks: HistoryBlock[] } {
  const lines = split(md);
  const title = (lines.find((l) => /^# /.test(l)) ?? '').replace(/^# /, '').trim();
  const out: HistoryBlock[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const raw = cur.lines.join('\n');
    const id = cur.lines.map((l) => itRe.exec(l.trim())?.[1]).find(Boolean) ?? null;
    const times = id ? decisionTimes(raw, id) : { synced: null, edited: null };
    out.push({ id, heading: cur.heading, body: stripMarkers(raw), ...times });
  };
  for (const l of lines) {
    if (l.startsWith('## ')) {
      flush();
      cur = { heading: l.slice(3).trim(), lines: [] };
    } else if (cur) cur.lines.push(l);
  }
  flush();
  return { title, blocks: out };
}
