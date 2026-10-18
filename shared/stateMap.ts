// State map: the states the brief lists per screen, checked against the frames designed in Figma.
// Richa's rule: list every step the user takes as a state, and mark which exist and which are missing.

/** A frame as design.json stores it. Older chats only know the node id. */
export type StateFrame = { nodeId: string; screen?: string; state?: string; name?: string };
export type BriefScreen = { screen: string; states: string[] };
export type MappedState = { state: string; frame?: { nodeId: string; name: string } };
export type MappedScreen = { screen: string; states: MappedState[] };
/** named is false when no frame has a screen, state or name to match against. */
export type StateMap = { screens: MappedScreen[]; total: number; missing: number; named: boolean };

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
// "Cart: default" or "Cart - default", with an en or em dash too.
const SPLIT = /^(.+?)\s*(?::|\s[-\u2013\u2014]\s)\s*(.*)$/;

const clean = (t: string) =>
  t.replace(/\*\*|__|`/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '').trim();

const splitStates = (t: string) =>
  t.split(/[,;]/).map((s) => clean(s).replace(/^(?:and|or)\s+/i, '').trim()).filter((s) => s && !/^etc$/i.test(s));

/** Screens and their states from the brief's States section. Empty when there is none. */
export function parseStates(md: string): BriefScreen[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => { const h = HEADING.exec(l.trim()); return !!h && h[1].length <= 3 && /^(?:\*\*)?states?\b/i.test(h[2]); });
  if (start < 0) return [];
  const level = HEADING.exec(lines[start].trim())![1].length;
  const out = new Map<string, BriefScreen>();
  const add = (screen: string, states: string[]) => {
    const name = clean(screen);
    if (!name || !states.length) return;
    const key = norm(name);
    const entry = out.get(key) ?? { screen: name, states: [] };
    for (const s of states) if (!entry.states.some((x) => norm(x) === norm(s))) entry.states.push(s);
    out.set(key, entry);
  };
  let heading: string | null = null;
  let parent: string | null = null;
  for (const raw of lines.slice(start + 1)) {
    const h = HEADING.exec(raw.trim());
    if (h) {
      if (h[1].length <= level) break;
      heading = clean(h[2]);
      parent = null;
      continue;
    }
    if (!raw.trim()) continue;
    const b = BULLET.exec(raw);
    const indent = b ? b[1].replace(/\t/g, '  ').length : 0;
    const text = clean(b ? b[2] : raw);
    if (!text) continue;
    if (b && indent >= 2 && parent) { add(parent, splitStates(text)); continue; }
    // Under "### Cart" every line is a state of Cart, even "Error: payment failed".
    if (heading) { add(heading, splitStates(text)); continue; }
    const pair = SPLIT.exec(text);
    if (pair && pair[2].trim()) { add(pair[1], splitStates(pair[2])); parent = clean(pair[1]); }
    else if (b) parent = text;
  }
  return [...out.values()];
}

const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'for', 'to', 'with', 'and', 'or', 'is', 'state', 'states', 'screen', 'view', 'page']);
const DEFAULTS = new Set(['default', 'normal', 'base', 'idle', 'initial', 'rest', 'main']);
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s|e)$/, '') : w);

function tokens(t: string | undefined): string[] {
  if (!t) return [];
  const words = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  return [...new Set(words.map(stem))];
}

const norm = (t: string) => tokens(t).join(' ');
const within = (a: string[], b: string[]) => a.every((w) => b.includes(w));
const same = (a: string[], b: string[]) => a.length === b.length && within(a, b);
const isDefault = (t: string[]) => t.every((w) => DEFAULTS.has(w));

/** The listed screen a frame belongs to: its screen field, then the first part of its name, then the longest screen whose words it contains. */
function screenOf(f: StateFrame, screens: string[][]): number {
  const byField = screens.findIndex((s) => s.length && same(s, tokens(f.screen)));
  if (byField >= 0) return byField;
  const head = f.name?.split(/\s*[/|\u2013\u2014,]\s*|\s-\s/)[0];
  const byName = screens.findIndex((s) => s.length && same(s, tokens(head)));
  if (byName >= 0) return byName;
  const all = tokens([f.screen, f.state, f.name].filter(Boolean).join(' '));
  let best = -1;
  screens.forEach((s, i) => { if (s.length && within(s, all) && (best < 0 || s.length > screens[best].length)) best = i; });
  return best;
}

const frameName = (f: StateFrame) => f.name?.trim() || [f.screen, f.state].filter(Boolean).join(' / ') || f.nodeId;

/** Each listed state with the frame that designs it, or none when it is missing. */
export function stateMap(md: string, frames: StateFrame[]): StateMap {
  const listed = parseStates(md);
  const screenWords = listed.map((s) => tokens(s.screen));
  const named = frames.filter((f) => f.screen || f.state || f.name);
  const groups = listed.map(() => [] as Array<{ f: StateFrame; words: string[] }>);
  for (const f of named) {
    const i = screenOf(f, screenWords);
    if (i < 0) continue;
    const rest = tokens([f.state, f.name].filter(Boolean).join(' ')).filter((w) => !screenWords[i].includes(w));
    groups[i].push({ f, words: rest });
  }
  const screens = listed.map((s, i) => {
    const pool = groups[i];
    const used = new Set<number>();
    const wanted = s.states.map((label) => {
      const own = tokens(label).filter((w) => !screenWords[i].includes(w));
      return { label, words: own.length ? own : tokens(label), frame: undefined as StateFrame | undefined };
    });
    // Exact words first, then a frame that says more, then a frame that says less. A frame designs one state.
    const passes: Array<(want: string[], have: string[]) => boolean> = [
      (want, have) => same(want, have) || (isDefault(want) && isDefault(have)),
      (want, have) => want.length > 0 && within(want, have),
      (want, have) => have.length > 0 && within(have, want),
    ];
    for (const fits of passes) {
      for (const w of wanted) {
        if (w.frame) continue;
        const j = pool.findIndex((p, k) => !used.has(k) && fits(w.words, p.words));
        if (j >= 0) { used.add(j); w.frame = pool[j].f; }
      }
    }
    return { screen: s.screen, states: wanted.map((w) => (w.frame ? { state: w.label, frame: { nodeId: w.frame.nodeId, name: frameName(w.frame) } } : { state: w.label })) };
  });
  const total = screens.reduce((n, s) => n + s.states.length, 0);
  const missing = screens.reduce((n, s) => n + s.states.filter((x) => !x.frame).length, 0);
  return { screens, total, missing, named: named.length > 0 };
}

/** The message box text for one screen's missing states. Never sent on its own. */
export function missingPrompt(screen: MappedScreen): string {
  const gaps = screen.states.filter((s) => !s.frame).map((s) => s.state);
  if (!gaps.length) return '';
  const one = gaps.length === 1;
  return `Design the missing ${one ? 'state' : 'states'} for ${screen.screen}: ${gaps.join(', ')}. Name each frame "${screen.screen} / <State>" and add it to design.json. Plan ${one ? 'it' : 'them'} first and wait for my approval.`;
}
