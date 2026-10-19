import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { commitProject, runGit, type GitRun } from './projectGit.js';

// Real git in a temp projects root, with its own identity file, so her global config and repos are never used.
const base = mkdtempSync(path.join(os.tmpdir(), 'ds-git-'));
const root = path.join(base, 'design-projects');
process.env.GIT_CONFIG_GLOBAL = path.join(base, 'gitconfig');
await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Test\n\temail = test@example.com\n');

describe('project git', () => {
  it('commits in order one at a time, skips a clean folder, never pushes, and stays inside the projects root', async () => {
    const dir = path.join(root, 'payroll');
    await mkdir(path.join(dir, 'flows', '01-a', 'iterations', '0.1'), { recursive: true });
    await mkdir(path.join(dir, '.figma-cache'), { recursive: true });
    await writeFile(path.join(dir, 'project.json'), '{"name":"Payroll"}');
    await writeFile(path.join(dir, '.figma-cache', 'map.json'), '{}');
    await writeFile(path.join(dir, 'shot.png'), 'png');
    const args: string[][] = [];
    let busy = 0;
    let most = 0;
    const git: GitRun = async (a, cwd) => {
      args.push(a);
      most = Math.max(most, ++busy);
      try {
        return await runGit(a, cwd);
      } finally {
        busy--;
      }
    };
    const opts = { root, git };
    // Three at once: they run one after another, so the second and third find nothing left to commit.
    const all = await Promise.all([commitProject(dir, 'Create project Payroll', opts), commitProject(dir, 'Same moment', opts), commitProject(dir, 'Same again', opts)]);
    expect(all).toEqual(['committed', 'clean', 'clean']);
    expect(most).toBe(1);
    // A chat in a flow's iteration folder commits its project.
    await writeFile(path.join(dir, 'flows', '01-a', 'flow.json'), '{}');
    expect(await commitProject(path.join(dir, 'flows', '01-a', 'iterations', '0.1'), 'Create flow 1 A', opts)).toBe('committed');

    const log = (await runGit(['log', '--format=%s'], dir)).trim().split('\n');
    expect(log).toEqual(['Create flow 1 A', 'Create project Payroll']);
    const files = (await runGit(['ls-files'], dir)).trim().split('\n').sort();
    expect(files).toEqual(['.gitignore', 'flows/01-a/flow.json', 'project.json']);
    expect((await runGit(['remote'], dir)).trim()).toBe('');
    expect(args.some((a) => a.includes('push') || a.includes('remote'))).toBe(false);

    // Outside the root, the root itself, a folder that is not a project: git is never run.
    const before = args.length;
    const loose = path.join(root, 'loose');
    await mkdir(loose);
    for (const d of [base, root, loose, os.tmpdir(), path.resolve('.')]) expect(await commitProject(d, 'No', opts)).toBe('skipped');
    expect(args.length).toBe(before);
  });
});
