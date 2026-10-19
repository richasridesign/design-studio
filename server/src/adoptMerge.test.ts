import path from 'node:path';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';

// Both roots point at temp folders before settings.js loads, so nothing outside them is listed or written.
const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { confirmAdopt, readProject } = await import('./project.js');
const { createFlow } = await import('./newFlow.js');

// Figma is never reached: tagging fails and is reported, the subsection is left for the first chat.
const NO_FIGMA = { run: (async () => { throw new Error('Figma is not connected'); }) as any };
const NO_SECTIONS = { sections: async () => ({ ok: false as const, error: 'Figma is not connected' }) };

it('adopting again keeps a flow made with New flow, marks a flow gone from Figma missing and adds the new one', async () => {
  const dir = path.join(ROOTS.projects, 'atlas');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Atlas', url: 'https://www.figma.com/design/KEY' }));

  await confirmAdopt(dir, 'KEY', {
    page: { id: '0:1', name: 'Flows' },
    flows: [{ name: 'Onboarding', entry: ['1:1'], baseline: '10:1' }, { name: 'Connectors', entry: ['2:1'], baseline: '10:2' }],
    iterations: [{ id: '1', node: '9:1', name: 'LATEST', flows: { onboarding: { node: '10:1' }, connectors: { node: '10:2' } } }, { id: '1.18', node: '9:2', name: 'V1.18 · Trust', topic: 'Trust' }],
  }, NO_FIGMA, 1);
  const made = await createFlow(dir, 'KEY', { name: 'Payments', topic: 'Pay run' }, NO_SECTIONS, 2);
  await writeFile(path.join(made.cwd, 'plan.md'), 'Richa plan');

  // What the dialog sends the second time: only what Figma has now. Connectors is gone, Approvals is new.
  await confirmAdopt(dir, 'KEY', {
    page: { id: '0:1', name: 'Flows' },
    flows: [{ name: 'Onboarding', entry: ['1:5'], baseline: '10:1' }, { name: 'Approvals', entry: ['3:1'], baseline: '10:3' }],
    iterations: [{ id: '1', node: '9:1', name: 'LATEST', flows: { onboarding: { node: '10:1' }, approvals: { node: '10:3' } } }],
  }, NO_FIGMA, 3);

  const p = (await readProject(dir))!;
  expect(p.flows.map((f) => [f.n, f.slug, f.missing ?? false])).toEqual([[1, 'onboarding', false], [2, 'connectors', true], [3, 'payments', false], [4, 'approvals', false]]);
  expect(p.flows[0].entry).toEqual(['1:5']);
  // The hand-made flow, its working iteration and the chat folder inside it are untouched.
  expect(p.flows[2]).toEqual({ n: 3, slug: 'payments', name: 'Payments', entry: [] });
  const working = p.iterations.find((it) => it.id === made.iteration.id)!;
  expect(working.state).toBe('working');
  expect(working.flows).toEqual({});
  expect((await stat(path.join(made.cwd, 'plan.md'))).isFile()).toBe(true);
  expect(made.cwd.startsWith(path.join(dir, 'flows', '03-payments'))).toBe(true);
  // The iteration Figma no longer lists stays, marked missing, and LATEST keeps the subsection of the missing flow.
  expect(p.iterations.find((it) => it.id === '1.18')).toMatchObject({ node: '9:2', missing: true });
  expect(p.iterations.find((it) => it.id === '1')!.flows).toEqual({ onboarding: { node: '10:1' }, connectors: { node: '10:2' }, approvals: { node: '10:3' } });
  expect((await stat(path.join(dir, 'flows', '04-approvals', 'flow.json'))).isFile()).toBe(true);
});
