// Scope: the flows a chat's design keeps, and the features parked out of it.
// From Richa's process: a parked feature is never deleted. It gets a dated note (what, why, how to restore),
// its entry points leave the in-scope flows, and every named flow survives a cut.

export type Parked = { name: string; why: string; restore: string; at: number };
export type Scope = { flows: string[]; parked: Parked[] };

export type ScopeChange =
  | { action: 'add'; name: string }
  | { action: 'remove'; name: string }
  | { action: 'park'; name: string; why: string; restore?: string }
  | { action: 'restore'; name: string };

export const EMPTY_SCOPE: Scope = { flows: [], parked: [] };

const MAX_ITEMS = 30;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function cleanScope(input: unknown): Scope {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const flows: string[] = [];
  for (const f of Array.isArray(o.flows) ? o.flows : []) {
    const name = text(f, 80);
    if (name && !flows.some((x) => same(x, name)) && flows.length < MAX_ITEMS) flows.push(name);
  }
  const parked: Parked[] = [];
  for (const p of Array.isArray(o.parked) ? o.parked : []) {
    const name = text(p?.name, 80);
    const at = Number(p?.at);
    if (!name || parked.some((x) => same(x.name, name)) || parked.length >= MAX_ITEMS || !Number.isFinite(at)) continue;
    parked.push({ name, why: text(p?.why, 200), restore: text(p?.restore, 200), at });
  }
  return { flows: flows.filter((f) => !parked.some((p) => same(p.name, f))), parked };
}

/** Parking a flow takes it out of scope; restoring puts it back. Names match without case. */
export function changeScope(s: Scope, c: ScopeChange, now: number): Scope {
  const name = text(c.name, 80);
  if (!name) throw new Error('Name the flow or feature');
  const flows = s.flows.filter((f) => !same(f, name));
  const parked = s.parked.filter((p) => !same(p.name, name));
  switch (c.action) {
    case 'add': return cleanScope({ flows: [...s.flows, name], parked });
    case 'remove': return { flows, parked: s.parked };
    case 'park': {
      const why = text(c.why, 200);
      if (!why) throw new Error('Say why it is parked');
      return cleanScope({ flows, parked: [...parked, { name, why, restore: text(c.restore, 200), at: now }] });
    }
    case 'restore': return cleanScope({ flows: [...flows, name], parked });
  }
}

const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** One house rule per parked feature, so every review checks it stays out. */
export const parkedRules = (s: Scope | undefined) =>
  (s?.parked ?? []).map((p) => `Parked: "${p.name}" stays out of the latest version, with no screens, entry points or links to it.`);

/** Scope for Claude's instructions. Empty when the designer has not set one. */
export function scopeBlock(s: Scope | undefined) {
  if (!s || (!s.flows.length && !s.parked.length)) return '';
  return [
    'Scope for this chat, from the designer:',
    ...(s.flows.length ? [`Flows in scope: ${s.flows.join(', ')}. Before cutting a flow down, check that each of these is still there.`] : []),
    ...(s.parked.length
      ? ['Parked, keep these out of the latest version (no screens, entry points or links). Never delete their old frames:', ...s.parked.map((p) => `- ${p.name} (parked ${day(p.at)}): ${p.why}${p.restore ? ` To restore: ${p.restore}` : ''}`)]
      : []),
  ].join('\n');
}

export function scopeSummary(s: Scope) {
  const flows = `${s.flows.length} ${s.flows.length === 1 ? 'flow' : 'flows'}`;
  return s.parked.length ? `${flows}, ${s.parked.length} parked` : flows;
}
