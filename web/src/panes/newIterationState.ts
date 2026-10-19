import { bumpMajor, cleanId, isLatestName, iterationName, latestOf, nextIterationId, todayIso, type Iteration, type Project } from '../../../shared/project';

// The New iteration dialog as a pure state machine, so every state is tested without a browser:
// form (empty, typing, filled, invalid), creating, done, and failed (the iteration is saved but its Figma section
// is not, so Retry runs only the section step).

export type FigmaOutcome = { ok: true; node: string; missing: string[] } | { ok: false; error: string };

export type Fields = { id: string; topic: string; date: string; flows: string[] };
/** Which fields the designer has left at least once: their errors show from then on, never while still empty. */
export type Seen = { id: boolean; topic: boolean; flows: boolean };

export type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'creating' }
  | { kind: 'done'; it: Iteration; missing: string[] }
  | { kind: 'failed'; it: Iteration; error: string }
  | { kind: 'retrying'; it: Iteration };

export type State = { fields: Fields; seen: Seen; phase: Phase };

export type Event =
  | { type: 'edit'; field: 'id' | 'topic' | 'date'; value: string }
  | { type: 'toggle'; slug: string }
  | { type: 'leave'; field: keyof Seen }
  | { type: 'bump' }
  | { type: 'submit' }
  | { type: 'created'; it: Iteration; figma: FigmaOutcome }
  | { type: 'rejected'; error: string }
  | { type: 'retry' }
  | { type: 'retried'; figma: FigmaOutcome };

export function initial(project: Project, now = new Date()): State {
  return {
    fields: { id: nextIterationId(project), topic: '', date: todayIso(now), flows: project.flows.map((f) => f.slug) },
    seen: { id: false, topic: false, flows: false },
    phase: { kind: 'form' },
  };
}

export type Errors = { id: string; topic: string; flows: string; date: string };

export function errors(f: Fields, project: Project): Errors {
  const clean = cleanId(f.id);
  return {
    id: !f.id.trim() ? 'Give the iteration an id, like 1.19' : !clean ? 'Use major.minor, like 1.19' : project.iterations.some((it) => it.id === clean) ? `Iteration ${clean} exists already` : '',
    topic: f.topic.trim() ? '' : 'Give the iteration a topic',
    flows: f.flows.length ? '' : 'Pick at least one flow',
    date: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? '' : 'Pick a date',
  };
}

export const isValid = (f: Fields, project: Project) => Object.values(errors(f, project)).every((e) => !e);

/** The error to show next to a field: only once the field was left, or a value is there that is wrong. */
export function shown(s: State, project: Project): Errors {
  const e = errors(s.fields, project);
  return {
    id: s.seen.id || s.fields.id.trim() ? e.id : '',
    topic: s.seen.topic ? e.topic : '',
    flows: s.seen.flows ? e.flows : '',
    date: e.date,
  };
}

export const busy = (s: State) => s.phase.kind === 'creating' || s.phase.kind === 'retrying';

export function reduce(s: State, e: Event, project: Project): State {
  const form = s.phase.kind === 'form';
  switch (e.type) {
    case 'edit':
      if (!form) return s;
      return { ...s, fields: { ...s.fields, [e.field]: e.value }, phase: { kind: 'form' } };
    case 'toggle': {
      if (!form) return s;
      const flows = s.fields.flows.includes(e.slug) ? s.fields.flows.filter((x) => x !== e.slug) : [...s.fields.flows, e.slug];
      return { ...s, fields: { ...s.fields, flows }, seen: { ...s.seen, flows: true }, phase: { kind: 'form' } };
    }
    case 'leave':
      return s.seen[e.field] ? s : { ...s, seen: { ...s.seen, [e.field]: true } };
    case 'bump':
      if (!form) return s;
      return { ...s, fields: { ...s.fields, id: bumpMajor(project.iterations.map((it) => it.id)) }, phase: { kind: 'form' } };
    case 'submit':
      if (!form) return s;
      if (!isValid(s.fields, project)) return { ...s, seen: { id: true, topic: true, flows: true } };
      return { ...s, phase: { kind: 'creating' } };
    case 'created':
      if (s.phase.kind !== 'creating') return s;
      return { ...s, phase: e.figma.ok ? { kind: 'done', it: e.it, missing: e.figma.missing } : { kind: 'failed', it: e.it, error: e.figma.error } };
    case 'rejected':
      // Nothing was saved (the id exists, or the project is not adopted): back to the form with the reason.
      if (s.phase.kind !== 'creating') return s;
      return { ...s, phase: { kind: 'form', error: e.error } };
    case 'retry':
      if (s.phase.kind !== 'failed') return s;
      return { ...s, phase: { kind: 'retrying', it: s.phase.it } };
    case 'retried':
      if (s.phase.kind !== 'retrying') return s;
      return { ...s, phase: e.figma.ok ? { kind: 'done', it: s.phase.it, missing: e.figma.missing } : { kind: 'failed', it: s.phase.it, error: e.figma.error } };
  }
}

/** What the POST sends. Only called when the fields are valid. */
export const payload = (f: Fields) => ({ id: cleanId(f.id), topic: f.topic.trim(), date: f.date, flows: f.flows });

/** "V1.19 · Readiness · Mon 19 Oct 2026", with placeholders while the fields are empty. */
export const sectionPreview = (f: Fields) => iterationName(cleanId(f.id) ?? (f.id.trim() || '1.19'), f.topic.trim() || 'Topic', f.date);

/**
 * Where each ticked flow starts from: the newest iteration that has it, else the adopted baseline. Grouped by
 * source so the line stays short: "V1.18: Discover, Connectors. Baseline: Agents".
 */
export function startFrom(project: Project, slugs: string[]): string {
  const groups = new Map<string, string[]>();
  for (const f of project.flows) {
    if (!slugs.includes(f.slug)) continue;
    const it = latestOf(project, f.slug);
    // The adopted LATEST container is the baseline, like a flow with entry screens and no iteration yet.
    const from = it && !isLatestName(it.name ?? '') ? `V${it.id}` : it || f.entry.length ? 'Baseline' : 'No screens yet';
    groups.set(from, [...(groups.get(from) ?? []), f.name]);
  }
  return [...groups].map(([from, names]) => `${from}: ${names.join(', ')}`).join('. ');
}
