import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

// Both roots point at temp folders before settings.js loads, so nothing outside them is listed or written.
const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

const { addFlow, createFlow } = await import('./newFlow.js');
const { readProject } = await import('./project.js');
type Project = import('../../shared/project.js').Project;

const NOW = Date.UTC(2026, 9, 19, 12);
let n = 0;
async function folder(project?: Project) {
  const dir = path.join(ROOTS.projects, `p${++n}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'figma.json'), JSON.stringify({ key: 'KEY', name: 'Atlas', url: 'https://www.figma.com/design/KEY/Atlas' }));
  if (project) await writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  return dir;
}
const adopted = (working: boolean): Project => ({
  key: 'KEY', adoptedAt: 1, flows: [{ n: 1, slug: 'home', name: 'Home', entry: ['1:2'] }, { n: 3, slug: 'connectors', name: 'Connectors', entry: [] }],
  iterations: [{ id: '1', state: 'frozen', adopted: true }, { id: '1.19', topic: 'Readiness', state: working ? 'working' : 'frozen', flows: {} }],
});

describe('addFlow', () => {
  it('adds the flow after the last one and keeps the working iteration', () => {
    const r = addFlow(adopted(true), 'KEY', { name: '  Agent   setup ' }, NOW);
    expect(r.flow).toEqual({ n: 4, slug: 'agent-setup', name: 'Agent setup', entry: [] });
    expect(r.iteration.id).toBe('1.19');
    expect(r.project.iterations).toHaveLength(2);
  });

  it('asks for a topic and adds the next iteration when none is working', () => {
    expect(() => addFlow(adopted(false), 'KEY', { name: 'Agent setup' }, NOW)).toThrow('Give the iteration a topic');
    const r = addFlow(adopted(false), 'KEY', { name: 'Agent setup', topic: 'Agents' }, NOW);
    expect(r.iteration).toEqual({ id: '1.20', topic: 'Agents', date: '2026-10-19', state: 'working', createdAt: NOW, flows: {} });
  });

  it('makes project.json for a file with none, with iteration 0.1', () => {
    const r = addFlow(null, 'KEY', { name: 'Onboarding', topic: 'First ideas' }, NOW);
    expect(r.project).toEqual({ key: 'KEY', adoptedAt: NOW, flows: [{ n: 1, slug: 'onboarding', name: 'Onboarding', entry: [] }], iterations: [r.iteration] });
    expect(r.iteration.id).toBe('0.1');
  });

  it('refuses an empty name, a name that exists, and a folder with no file', () => {
    expect(() => addFlow(adopted(true), 'KEY', { name: ' ' })).toThrow('Give the flow a name');
    expect(() => addFlow(adopted(true), 'KEY', { name: 'connectors' })).toThrow('A flow named Connectors already exists');
    expect(() => addFlow(null, null, { name: 'A', topic: 'B' })).toThrow('This folder has no Figma file');
  });

  it('keeps slugs unique', () => {
    const p = adopted(true);
    p.flows.push({ n: 4, slug: 'agents', name: 'Agents old', entry: [] });
    expect(addFlow(p, 'KEY', { name: 'Agents!' }).flow.slug).toBe('agents-2');
  });
});

describe('createFlow', () => {
  it('writes project.json, the folders, and asks Figma for the subsection', async () => {
    const dir = await folder();
    const sections = vi.fn(async () => ({ ok: true as const, node: '9:1', missing: [] }));
    const r = await createFlow(dir, 'KEY', { name: 'Onboarding', topic: 'First ideas' }, { sections }, NOW);
    expect(r.cwd).toBe(path.join(dir, 'flows', '01-onboarding', 'iterations', '0.1'));
    expect(sections).toHaveBeenCalledWith(dir, 'KEY', '0.1', ['onboarding']);
    expect(r.figma.ok).toBe(true);
    const saved = await readProject(dir);
    expect(saved?.flows.map((f) => f.slug)).toEqual(['onboarding']);
    expect(JSON.parse(await readFile(path.join(dir, 'flows', '01-onboarding', 'flow.json'), 'utf8')).name).toBe('Onboarding');
    expect(JSON.parse(await readFile(path.join(r.cwd, 'workflow.json'), 'utf8'))).toMatchObject({ workflow: 'scratch', step: 'explore', round: 1 });
  });

  it('keeps the flow when Figma fails', async () => {
    const dir = await folder(adopted(true));
    const r = await createFlow(dir, 'KEY', { name: 'Agents' }, { sections: async () => { throw new Error('Figma is closed'); } }, NOW);
    expect(r.figma).toEqual({ ok: false, error: 'Figma is closed' });
    expect((await readProject(dir))?.flows.at(-1)?.name).toBe('Agents');
  });

  it('writes nothing when the name is taken', async () => {
    const dir = await folder(adopted(true));
    await expect(createFlow(dir, 'KEY', { name: 'Home' })).rejects.toThrow('A flow named Home already exists');
    expect((await readProject(dir))?.flows).toHaveLength(2);
  });
});
