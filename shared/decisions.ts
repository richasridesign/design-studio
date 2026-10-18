// Decision stickies: two product decisions per Figma screen, each a bold line plus a "Why:" line.

export type Decision = { decision: string; why: string };
export type FrameDecisions = { name: string; items: [Decision, Decision] };
export type DecisionDoc = Record<string, FrameDecisions>;
export type Screen = { id: string; name: string };
export type Parsed = { n: 1 | 2; screen: string; id?: string; decision: string; why: string };

export const WARN_WORDS = 30;
const MAX = { text: 400, name: 200, frames: 1000 };

const blank = (): Decision => ({ decision: '', why: '' });
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nodeUrl = (key: string, id: string) => `https://www.figma.com/design/${key}?node-id=${id.replace(':', '-')}`;

export const wordCount = (...parts: string[]) => parts.join(' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export const isValidKey = (key: string) => /^[A-Za-z0-9]{6,64}$/.test(key);

export const slots = (doc: DecisionDoc, id: string): [Decision, Decision] => doc[id]?.items ?? [blank(), blank()];

export const filled = (d: Decision) => !!(d.decision.trim() || d.why.trim());

export function cleanDecisions(input: unknown): DecisionDoc {
  const out: DecisionDoc = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX.frames) break;
    if (!/^[\w:;-]{1,64}$/.test(id) || !raw || typeof raw !== 'object') continue;
    const r = raw as { name?: unknown; items?: unknown };
    const items = Array.isArray(r.items) ? r.items : [];
    const pick = (i: number): Decision => {
      const d = (items[i] ?? {}) as Record<string, unknown>;
      return { decision: text(d.decision, MAX.text), why: text(d.why, MAX.text) };
    };
    const pair: [Decision, Decision] = [pick(0), pick(1)];
    if (!pair.some(filled)) continue;
    out[id] = { name: text(r.name, MAX.name), items: pair };
  }
  return out;
}

// Applies parsed entries on top of the saved doc. Only non-empty fields overwrite.
export function mergeDecisions(base: DecisionDoc, entries: Array<Parsed & { id: string }>, names: Record<string, string> = {}): DecisionDoc {
  const out: DecisionDoc = { ...base };
  for (const e of entries) {
    const [a, b] = slots(out, e.id);
    const pair: [Decision, Decision] = [{ ...a }, { ...b }];
    const slot = pair[e.n - 1];
    if (e.decision) slot.decision = e.decision;
    if (e.why) slot.why = e.why;
    out[e.id] = { name: names[e.id] ?? out[e.id]?.name ?? e.screen, items: pair };
  }
  return cleanDecisions(out);
}

const strip = (s: string) => s.replace(/\*\*|__/g, '').replace(/^[\s>#*-]+/, '').trim();
const HEAD = /^decision\s+(\d+)\s*[·•:\-–]\s*(.+)$/i;

// Reads "Decision N · <screen name> (<node id>)" headers, each followed by a decision line and a "Why:" line.
export function parseDecisions(input: string): Parsed[] {
  const out: Parsed[] = [];
  let cur: Parsed | null = null;
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = strip(raw);
    if (!line || /^```/.test(line)) continue;
    const head = HEAD.exec(line);
    if (head) {
      cur = null;
      if (head[1] !== '1' && head[1] !== '2') continue;
      let screen = head[2].trim();
      let id: string | undefined;
      const m = /\s*\((\d+[:-]\d+)\)\s*$/.exec(screen);
      if (m) { id = m[1].replace('-', ':'); screen = screen.slice(0, m.index).trim(); }
      cur = { n: head[1] === '1' ? 1 : 2, screen, id, decision: '', why: '' };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const why = /^why\s*:\s*(.*)$/i.exec(line);
    if (why) cur.why = [cur.why, why[1].trim()].filter(Boolean).join(' ');
    else if (cur.why) cur.why = `${cur.why} ${line}`;
    else cur.decision = [cur.decision, line.replace(/^decision\s*:\s*/i, '')].filter(Boolean).join(' ');
  }
  return out.filter((p) => p.decision || p.why);
}

// Matches parsed entries to frames: node id first, then a case-insensitive name when that name is unique.
export function matchDecisions(parsed: Parsed[], screens: Screen[]) {
  const ids = new Set(screens.map((s) => s.id));
  const byName = new Map<string, string[]>();
  for (const s of screens) {
    const k = s.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }
  const matched: Array<Parsed & { id: string }> = [];
  const unmatched: string[] = [];
  for (const p of parsed) {
    const named = byName.get(p.screen.trim().toLowerCase());
    const id = p.id && ids.has(p.id) ? p.id : named?.length === 1 ? named[0] : undefined;
    if (id) matched.push({ ...p, id });
    else if (!unmatched.includes(p.screen)) unmatched.push(p.screen);
  }
  return { matched, unmatched };
}

const RULES = [
  'Each decision is about product direction: what information the screen shows and in what order, why the user takes this step, and what was chosen over the alternative.',
  'Never write about UI styling or accessibility details.',
  'Each decision is one bold decision line plus one "Why:" line, about 25 words in total.',
  'Plain short words. No em dashes.',
];

export function draftPrompt(key: string, screens: Screen[], doc: DecisionDoc): string {
  const todo = screens.filter((s) => !slots(doc, s.id).every(filled));
  const list = (todo.length ? todo : screens).map((s) => `- ${s.name} (${s.id}): ${nodeUrl(key, s.id)}`).join('\n');
  return [
    'Look at these Figma screens and propose the two most important product decisions for each one.',
    ...RULES.map((r) => `- ${r}`),
    'Do not change the Figma file. Reply with only this block, one entry per decision, keeping the node id in the header:',
    '',
    'Decision 1 · <screen name> (<node id>)',
    '<decision line>',
    'Why: <why line>',
    '',
    'Decision 2 · <screen name> (<node id>)',
    '<decision line>',
    'Why: <why line>',
    '',
    'Screens:',
    list,
  ].join('\n');
}

export function stickyPrompt(key: string, screen: Screen, items: [Decision, Decision]): string {
  const body = items.map((d, i) => `Decision ${i + 1} · ${screen.name}\n${d.decision}\nWhy: ${d.why}`).join('\n\n');
  return [
    `Place two Decision stickies under the screen "${screen.name}" (${nodeUrl(key, screen.id)}).`,
    '- Use the Decision sticky component if the file has one, otherwise a FigJam style sticky.',
    '- Put them 96px under the frame, side by side, with the same row spacing as other stickies in the file. Both share one height.',
    `- Name them "Decision 1 · ${screen.name}" and "Decision 2 · ${screen.name}". If stickies with those names exist, update them instead of adding new ones.`,
    '- Bold the decision line. Use this text exactly:',
    '',
    body,
  ].join('\n');
}
