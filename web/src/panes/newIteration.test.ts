import { describe, expect, it } from 'vitest';
import type { Iteration, Project } from '../../../shared/project';
import { busy, errors, initial, isValid, payload, reduce, sectionPreview, shown, startFrom, type Event, type State } from './newIteration';

const project: Project = {
  key: 'K',
  flows: [
    { n: 1, slug: 'discover', name: 'Discover', entry: ['1:22'] },
    { n: 2, slug: 'connectors', name: 'Connectors', entry: ['1:40'] },
    { n: 3, slug: 'agents', name: 'Agents', entry: [] },
  ],
  iterations: [
    { id: '1', state: 'frozen', name: 'LATEST', flows: { discover: { node: '1:21' }, connectors: { node: '1:30' } } },
    { id: '1.18', topic: 'Trust', state: 'frozen', flows: { discover: { node: '5:1' } } },
  ],
};
const now = new Date(2026, 9, 19);
const run = (events: Event[], s: State = initial(project, now)) => events.reduce((acc, e) => reduce(acc, e, project), s);
const it19: Iteration = { id: '1.19', topic: 'Readiness', state: 'working', flows: {} };

describe('New iteration dialog', () => {
  it('empty: id prefilled with the next minor, every flow ticked, no error shown, submit not valid yet', () => {
    const s = initial(project, now);
    expect(s.fields).toEqual({ id: '1.19', topic: '', date: '2026-10-19', flows: ['discover', 'connectors', 'agents'] });
    expect(isValid(s.fields, project)).toBe(false);
    expect(shown(s, project)).toEqual({ id: '', topic: '', flows: '', date: '' });
    expect(sectionPreview(s.fields)).toBe('V1.19 · Topic · Mon 19 Oct 2026');
  });

  it('typing then filled: valid once the topic is there, the preview follows', () => {
    const s = run([{ type: 'edit', field: 'topic', value: 'Read' }]);
    expect(isValid(s.fields, project)).toBe(true);
    expect(sectionPreview(run([{ type: 'edit', field: 'topic', value: ' Readiness ' }]).fields)).toBe('V1.19 · Readiness · Mon 19 Oct 2026');
  });

  it('invalid id shows while typing; an existing id and an empty one have their own text', () => {
    expect(shown(run([{ type: 'edit', field: 'id', value: '1.x' }]), project).id).toBe('Use major.minor, like 1.19');
    expect(shown(run([{ type: 'edit', field: 'id', value: '1.18' }]), project).id).toBe('Iteration 1.18 exists already');
    const empty = run([{ type: 'edit', field: 'id', value: '' }]);
    expect(shown(empty, project).id).toBe('');
    expect(shown(run([{ type: 'leave', field: 'id' }], empty), project).id).toBe('Give the iteration an id, like 1.19');
  });

  it('topic error only after leaving the field; flows error after unticking all', () => {
    expect(shown(run([{ type: 'leave', field: 'topic' }]), project).topic).toBe('Give the iteration a topic');
    const none = run([{ type: 'toggle', slug: 'discover' }, { type: 'toggle', slug: 'connectors' }, { type: 'toggle', slug: 'agents' }]);
    expect(shown(none, project).flows).toBe('Pick at least one flow');
    expect(errors(none.fields, project).flows).toBeTruthy();
  });

  it('Bump major sets the next major id', () => {
    expect(run([{ type: 'bump' }]).fields.id).toBe('2');
  });

  it('submit while invalid shows every error and stays in the form', () => {
    const s = run([{ type: 'submit' }]);
    expect(s.phase.kind).toBe('form');
    expect(shown(s, project).topic).toBeTruthy();
  });

  it('creating, then done with the Figma section; edits are ignored while busy', () => {
    const creating = run([{ type: 'edit', field: 'topic', value: 'Readiness' }, { type: 'submit' }]);
    expect(creating.phase.kind).toBe('creating');
    expect(busy(creating)).toBe(true);
    expect(payload(creating.fields)).toEqual({ id: '1.19', topic: 'Readiness', date: '2026-10-19', flows: ['discover', 'connectors', 'agents'] });
    expect(run([{ type: 'edit', field: 'topic', value: 'x' }], creating).fields.topic).toBe('Readiness');
    const done = run([{ type: 'created', it: it19, figma: { ok: true, node: '9:1', missing: [] } }], creating);
    expect(done.phase).toEqual({ kind: 'done', it: it19, missing: [] });
  });

  it('rejected: nothing saved, back to the form with the reason', () => {
    const s = run([{ type: 'edit', field: 'topic', value: 'Readiness' }, { type: 'submit' }, { type: 'rejected', error: 'Iteration 1.19 already exists' }]);
    expect(s.phase).toEqual({ kind: 'form', error: 'Iteration 1.19 already exists' });
  });

  it('failed in Figma: Retry runs the section step only, and can fail again or finish', () => {
    const failed = run([{ type: 'edit', field: 'topic', value: 'Readiness' }, { type: 'submit' }, { type: 'created', it: it19, figma: { ok: false, error: 'Figma is not open' } }]);
    expect(failed.phase).toEqual({ kind: 'failed', it: it19, error: 'Figma is not open' });
    const retrying = run([{ type: 'retry' }], failed);
    expect(retrying.phase.kind).toBe('retrying');
    expect(busy(retrying)).toBe(true);
    expect(run([{ type: 'retried', figma: { ok: false, error: 'Still closed' } }], retrying).phase).toEqual({ kind: 'failed', it: it19, error: 'Still closed' });
    expect(run([{ type: 'retried', figma: { ok: true, node: '9:1', missing: ['1:40'] } }], retrying).phase).toEqual({ kind: 'done', it: it19, missing: ['1:40'] });
  });

  it('Start from groups flows by the iteration they come from', () => {
    expect(startFrom(project, ['discover', 'connectors', 'agents'])).toBe('V1.18: Discover. V1: Connectors. No screens yet: Agents');
    expect(startFrom(project, ['connectors'])).toBe('V1: Connectors');
  });
});
