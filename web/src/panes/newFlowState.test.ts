import { describe, expect, it } from 'vitest';
import { busy, errors, initial, isValid, iterationFor, needsTopic, payload, reduce, shown, type Created, type State } from './newFlowState';
import type { Project } from '../../../shared/project';

const project = (working: boolean): Project => ({
  key: 'KEY', flows: [{ n: 1, slug: 'home', name: 'Home', entry: [] }, { n: 3, slug: 'connectors', name: 'Connectors', entry: [] }],
  iterations: [{ id: '1.19', state: working ? 'working' : 'frozen' }],
});
const made = (ok: boolean): Created => ({ flow: { n: 4, slug: 'agents', name: 'Agents', entry: [] }, iteration: { id: '1.19', state: 'working' }, cwd: '/x', figma: ok ? { ok: true, node: '9:1', missing: [] } : { ok: false, error: 'Figma is closed' } });
const run = (p: Project | null, ...events: Parameters<typeof reduce>[1][]) => events.reduce((s: State, e) => reduce(s, e, p), initial());

describe('New flow dialog', () => {
  it('asks for a topic only when no iteration is working, and names the iteration', () => {
    expect(needsTopic(project(true))).toBe(false);
    expect(needsTopic(project(false))).toBe(true);
    expect(needsTopic(null)).toBe(true);
    expect([iterationFor(project(true)), iterationFor(project(false)), iterationFor(null)]).toEqual(['1.19', '1.20', '0.1']);
  });

  it('empty: no error shows and Create flow stays off; typing a name that exists shows at once', () => {
    const p = project(true);
    const s = initial();
    expect(shown(s, p)).toEqual({ name: '', topic: '' });
    expect(isValid(s.fields, p)).toBe(false);
    const typed = run(p, { type: 'edit', field: 'name', value: 'connectors' });
    expect(shown(typed, p).name).toBe('A flow named Connectors already exists');
    const filled = run(p, { type: 'edit', field: 'name', value: 'Agents' });
    expect(isValid(filled.fields, p)).toBe(true);
    expect(payload(filled.fields, p)).toEqual({ name: 'Agents' });
  });

  it('leaving an empty field or submitting shows every error, and nothing is sent', () => {
    const p = project(false);
    const left = run(p, { type: 'leave', field: 'name' });
    expect(shown(left, p)).toEqual({ name: 'Give the flow a name', topic: '' });
    const sent = run(p, { type: 'edit', field: 'name', value: 'Agents' }, { type: 'submit' });
    expect(sent.phase.kind).toBe('form');
    expect(shown(sent, p).topic).toBe('Give the iteration a topic');
    expect(errors({ name: 'Agents', topic: 'Setup' }, p)).toEqual({ name: '', topic: '' });
  });

  it('submitting, done, and a rejection back to the form with the reason', () => {
    const p = project(true);
    const s = run(p, { type: 'edit', field: 'name', value: 'Agents' }, { type: 'submit' });
    expect(busy(s)).toBe(true);
    expect(reduce(s, { type: 'edit', field: 'name', value: 'x' }, p).fields.name).toBe('Agents');
    expect(reduce(s, { type: 'created', made: made(true) }, p).phase.kind).toBe('done');
    expect(reduce(s, { type: 'rejected', error: 'A flow named Agents already exists' }, p).phase).toEqual({ kind: 'form', error: 'A flow named Agents already exists' });
  });

  it('a Figma failure keeps the flow and Retry runs only the subsection', () => {
    const p = project(true);
    const failed = run(p, { type: 'edit', field: 'name', value: 'Agents' }, { type: 'submit' }, { type: 'created', made: made(false) });
    expect(failed.phase).toMatchObject({ kind: 'failed', error: 'Figma is closed' });
    const retrying = reduce(failed, { type: 'retry' }, p);
    expect(busy(retrying)).toBe(true);
    expect(reduce(retrying, { type: 'retried', figma: { ok: false, error: 'Still closed' } }, p).phase).toMatchObject({ kind: 'failed', error: 'Still closed' });
    expect(reduce(retrying, { type: 'retried', figma: { ok: true, node: '9:1', missing: [] } }, p).phase).toMatchObject({ kind: 'done', made: { figma: { ok: true } } });
  });
});
