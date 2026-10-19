import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// Both roots point at temp folders before settings.js loads, so nothing is made in her real projects folder.
const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

import { vi } from 'vitest';
const { createProject, createFileFor, linkFile, renameProject } = await import('./newProject.js');

describe('New project', () => {
  it('makes a named folder with no file, refuses a taken name or a path outside the root, and links one file into that same folder', async () => {
    const root = ROOTS.projects;
    const made = await createProject('  Expense   reports ', { root, now: 7 });
    expect(made.cwd).toBe(path.join(root, 'expense-reports'));
    expect(JSON.parse(await readFile(path.join(made.cwd, 'project.json'), 'utf8'))).toEqual({ name: 'Expense reports', createdAt: 7, flows: [], iterations: [] });
    expect(existsSync(path.join(made.cwd, 'figma.json'))).toBe(false);

    // Taken: the same name in any case, and a name whose folder is there already (a Figma project's name too).
    await expect(createProject('expense REPORTS', { root })).rejects.toMatchObject({ status: 409, message: 'A project called expense REPORTS already exists. Pick another name.' });
    await mkdir(path.join(root, 'payroll'));
    await expect(createProject('Payroll', { root })).rejects.toMatchObject({ status: 409 });
    const old = path.join(ROOTS.chats, 'old-file');
    await mkdir(old);
    await writeFile(path.join(old, 'figma.json'), JSON.stringify({ key: 'OLDKEY12345', name: 'Checkout', url: 'https://www.figma.com/design/OLDKEY12345' }));
    await expect(createProject('Checkout', { root })).rejects.toMatchObject({ status: 409 });

    // Nothing can climb out of the root or hide in it.
    const before = await readdir(path.dirname(root));
    for (const bad of ['../evil', '/etc', '..', '.hidden', 'a/b', '']) await expect(createProject(bad, { root })).rejects.toThrow();
    expect(await readdir(path.dirname(root))).toEqual(before);
    expect((await readdir(root)).sort()).toEqual(['expense-reports', 'payroll']);

    // A link writes figma.json into this folder and the key into project.json. A second file, or a file another
    // project holds, is refused, and no second folder is made.
    await expect(linkFile(made.cwd, { url: 'https://www.figma.com/design/OLDKEY12345/Checkout' })).rejects.toMatchObject({ status: 409 });
    const f = await linkFile(path.join(made.cwd, 'flows'), { url: 'https://www.figma.com/design/NEWKEY67890/Expense-reports?node-id=1-2' });
    expect(f).toEqual({ key: 'NEWKEY67890', name: 'Expense reports', url: 'https://www.figma.com/design/NEWKEY67890' });
    expect(JSON.parse(await readFile(path.join(made.cwd, 'figma.json'), 'utf8')).key).toBe('NEWKEY67890');
    expect(JSON.parse(await readFile(path.join(made.cwd, 'project.json'), 'utf8')).key).toBe('NEWKEY67890');
    await expect(linkFile(made.cwd, { url: 'https://www.figma.com/design/THIRDKEY123/x' })).rejects.toMatchObject({ status: 409 });
    expect((await readdir(root)).sort()).toEqual(['expense-reports', 'payroll']);
  });

  it('renames only the project name: flows, key and folder stay, and a taken name is refused', async () => {
    const root = ROOTS.projects;
    const made = await createProject('Atlas', { root, now: 3 });
    await createProject('Onboarding', { root });
    const file = path.join(made.cwd, 'project.json');
    const before = { ...JSON.parse(await readFile(file, 'utf8')), key: 'KEY12345678', flows: [{ n: 1, slug: 'setup', name: 'Setup', entry: ['1:2'] }], iterations: [{ id: '1.18', state: 'working' }] };
    await writeFile(file, JSON.stringify(before));
    expect(await renameProject(path.join(made.cwd, 'flows'), '  Example   app ')).toEqual({ from: 'Atlas', name: 'Example app' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...before, name: 'Example app' });
    expect(existsSync(path.join(root, 'atlas'))).toBe(true);
    expect(existsSync(path.join(root, 'example-app'))).toBe(false);
    // Another project's name in any case, the same name, and a bad name change nothing.
    await expect(renameProject(made.cwd, 'onboarding')).rejects.toMatchObject({ status: 409 });
    await expect(renameProject(made.cwd, 'Example app')).rejects.toThrow();
    await expect(renameProject(made.cwd, '../x')).rejects.toThrow();
    // Its own old name in a new case is fine: the project's own names are not taken.
    expect((await renameProject(made.cwd, 'example app')).name).toBe('example app');
    expect(JSON.parse(await readFile(file, 'utf8')).flows).toEqual(before.flows);
  });

  it('makes the Figma file once with the pinned arguments, even when the model asks twice', async () => {
    const root = ROOTS.projects;
    const made = await createProject('Leave requests', { root });
    const calls: any[] = [];
    const run = (async (_prompt: string, o: any) => {
      const pre = (input: any) => o.hooks.PreToolUse[0].hooks[0]({ tool_name: 'mcp__plugin_figma_figma__create_new_file', tool_input: input });
      for (const asked of [{ fileName: 'Other', planKey: 'team::9' }, { fileName: 'Again' }]) {
        const r = await pre(asked);
        calls.push(r.hookSpecificOutput);
        if (r.hookSpecificOutput.permissionDecision === 'allow') await o.hooks.PostToolUse[0].hooks[0]({ tool_name: 'mcp__plugin_figma_figma__create_new_file', tool_response: [{ type: 'text', text: '{"file_key":"MADEKEY1234","file_url":"https://www.figma.com/design/MADEKEY1234/Leave-requests"}' }] });
      }
      return { data: { ok: true }, tokens: 1, costUsd: 0, text: '' };
    }) as any;
    const mcp = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };
    const f = await createFileFor(made.cwd, { planKey: 'team::123', projectId: '456' }, { run, mcp });
    expect(calls.map((c) => c.permissionDecision)).toEqual(['allow', 'deny']);
    expect(calls[0].updatedInput).toEqual({ fileName: 'Leave requests', planKey: 'team::123', editorType: 'design', projectId: '456' });
    expect(f).toEqual({ key: 'MADEKEY1234', name: 'Leave requests', url: 'https://www.figma.com/design/MADEKEY1234' });
    await expect(createFileFor(made.cwd, { planKey: 'team::123' }, { run, mcp })).rejects.toMatchObject({ status: 409 });
  });
});
