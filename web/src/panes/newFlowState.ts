import { nextIterationId, workingIteration, type Flow, type Iteration, type Project } from '../../../shared/project';

// The New flow dialog as a pure state machine, so every state is tested without a browser: form (empty, typing,
// filled, invalid), creating, and failed (the flow is saved but its Figma subsection is not, so Retry runs only the
// Figma step). Done closes the dialog and opens a chat on the flow.

export type FigmaOutcome = { ok: true; node: string; missing: string[] } | { ok: false; error: string };
export type Created = { flow: Flow; iteration: Iteration; cwd: string; figma: FigmaOutcome };

export type Fields = { name: string; topic: string };
export type Seen = { name: boolean; topic: boolean };
export type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'creating' }
  | { kind: 'failed'; made: Created; error: string }
  | { kind: 'retrying'; made: Created }
  | { kind: 'done'; made: Created };
export type State = { fields: Fields; seen: Seen; phase: Phase };

export type Event =
  | { type: 'edit'; field: keyof Fields; value: string }
  | { type: 'leave'; field: keyof Seen }
  | { type: 'submit' }
  | { type: 'created'; made: Created }
  | { type: 'rejected'; error: string }
  | { type: 'retry' }
  | { type: 'retried'; figma: FigmaOutcome };

/** A file with no working iteration (or no project.json yet) asks for the new iteration's topic in the same dialog. */
export const needsTopic = (project: Project | null) => !project || !workingIteration(project);

/** "1.19" for the working iteration, else the id the new one gets ("0.1" on an empty file). */
export const iterationFor = (project: Project | null) => (project ? workingIteration(project)?.id ?? nextIterationId(project) : '0.1');

export const initial = (): State => ({ fields: { name: '', topic: '' }, seen: { name: false, topic: false }, phase: { kind: 'form' } });

export type Errors = { name: string; topic: string };

export function errors(f: Fields, project: Project | null): Errors {
  const name = f.name.trim().toLowerCase();
  const taken = project?.flows.find((x) => x.name.trim().toLowerCase() === name);
  return {
    name: !name ? 'Give the flow a name' : taken ? `A flow named ${taken.name} already exists` : '',
    topic: needsTopic(project) && !f.topic.trim() ? 'Give the iteration a topic' : '',
  };
}

export const isValid = (f: Fields, project: Project | null) => Object.values(errors(f, project)).every((e) => !e);

/** A wrong value shows while typing (a name that exists); an empty field only once it was left or submitted. */
export function shown(s: State, project: Project | null): Errors {
  const e = errors(s.fields, project);
  return {
    name: s.seen.name || s.fields.name.trim() ? e.name : '',
    topic: s.seen.topic ? e.topic : '',
  };
}

export const busy = (s: State) => s.phase.kind === 'creating' || s.phase.kind === 'retrying';

export function reduce(s: State, e: Event, project: Project | null): State {
  const form = s.phase.kind === 'form';
  switch (e.type) {
    case 'edit':
      if (!form) return s;
      return { ...s, fields: { ...s.fields, [e.field]: e.value }, phase: { kind: 'form' } };
    case 'leave':
      return s.seen[e.field] ? s : { ...s, seen: { ...s.seen, [e.field]: true } };
    case 'submit':
      if (!form) return s;
      if (!isValid(s.fields, project)) return { ...s, seen: { name: true, topic: true } };
      return { ...s, phase: { kind: 'creating' } };
    case 'created':
      if (s.phase.kind !== 'creating') return s;
      return { ...s, phase: e.made.figma.ok ? { kind: 'done', made: e.made } : { kind: 'failed', made: e.made, error: e.made.figma.error } };
    case 'rejected':
      // Nothing was saved (the name exists, the folder has no file): back to the form with the reason.
      if (s.phase.kind !== 'creating') return s;
      return { ...s, phase: { kind: 'form', error: e.error } };
    case 'retry':
      if (s.phase.kind !== 'failed') return s;
      return { ...s, phase: { kind: 'retrying', made: s.phase.made } };
    case 'retried': {
      if (s.phase.kind !== 'retrying') return s;
      const made = { ...s.phase.made, figma: e.figma };
      return { ...s, phase: e.figma.ok ? { kind: 'done', made } : { kind: 'failed', made, error: e.figma.error } };
    }
  }
}

/** What the POST sends. The topic only when the dialog asks for it. */
export const payload = (f: Fields, project: Project | null) => ({ name: f.name.trim(), ...(needsTopic(project) ? { topic: f.topic.trim() } : {}) });
