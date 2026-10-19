import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

// From scratch on disk: the Design system card reads the file's profile, and set_status options and a pick move it.

const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { workflowEvent, workflowView } = await import('./workflow.js');
const { mapFiles } = await import('./fileMap.js');
const OPTS = { preset: 'full' as const, areas: [], reviewing: false };

let n = 0;
async function setup() {
  const root = path.join(ROOTS.projects, `s-${++n}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'File', url: 'https://www.figma.com/design/KEY' }));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({ key: 'KEY', flows: [{ n: 3, slug: 'connectors', name: 'Connectors', entry: [] }], iterations: [{ id: '1.19', state: 'working', topic: 'Readiness', flows: { connectors: { node: '50:2' } } }] }));
  const file = mapFiles(root, 'KEY').json;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ key: 'KEY', name: 'File', readAt: 1, raw: { pages: [['0:1', 'Flows', [['S', '50:2', 'V1.19 · Flow 3 · Connectors', 0, 0, 3000, 2000, [], 0, 'flow;1.19;connectors']]]] } }));
  const cwd = path.join(root, 'flows', '03-connectors', 'iterations', '1.19');
  await mkdir(cwd, { recursive: true });
  return { root, cwd };
}
const options = [{ id: 'A' as const, name: 'Cards', node: '60:1' }, { id: 'B' as const, name: 'Table', node: '60:2' }];

describe('From scratch on disk', () => {
  it('options make Pick current, the pick quotes in High fidelity, and Design system reads the profile', async () => {
    const { root, cwd } = await setup();
    await workflowEvent(cwd, { type: 'options', options, at: 10 });
    let v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect([v.state.step, v.card.pick]).toEqual(['pick', true]);
    await workflowEvent(cwd, { type: 'pick', id: 'B', why: 'Scans faster', at: 11 });
    await workflowEvent(cwd, { type: 'done', step: 'hifi', at: 12 });
    v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect(v.state).toMatchObject({ step: 'system', picked: { id: 'B', why: 'Scans faster' } });
    expect(v.card.button?.label).toBe('Make the design system');
    await writeFile(path.join(root, 'design-system.json'), JSON.stringify({ libraries: [], colors: [], text: [], spacing: [], radius: [], components: [{ name: 'Button' }, { name: 'Card' }], rules: [] }));
    v = await workflowView(cwd, OPTS);
    if (v.scope !== 'flow') throw new Error('flow chat expected');
    expect(v.card).toMatchObject({ line: 'This file has a design system (2 components). Adds only what the new screens need, as new variants.', button: { label: 'Extend the design system' }, link: { label: 'Skip', action: 'skip-system' } });
  });
});
