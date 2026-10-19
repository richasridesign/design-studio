import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { parseFigmaUrl, type FigmaFile } from '../../shared/design.js';
import { PROJECT_FILE, type Project } from '../../shared/project.js';
import { cleanProjectName, projectNameProblem, projectSlug, takenText } from '../../shared/newProject.js';
import { chatFolders, FigmaError, installSkills, nameFromUrl } from './figma.js';
import { projectRoot } from './roots.js';
import { readProject, updateProject } from './project.js';
import { projectsRoot } from './settings.js';
import { createFigmaFile } from './figmaCreate.js';
import type { ReadDeps } from './pluginRead.js';

// New project (the sidebar's Add project and ⌘O): a named folder in the projects root with project.json and no Figma
// file yet. A file is added later, from a link or made new in Figma, into this same folder (figma.json).

export class ProjectError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** The projects root as the popover shows it: ~ for the home folder. */
export const shownRoot = (root = projectsRoot()) => {
  const home = os.homedir();
  return root === home || root.startsWith(home + path.sep) ? `~${root.slice(home.length)}` : root;
};

/** The names already used by projects in both roots, lower case: project.json names and Figma file names. */
async function takenNames(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const f of await chatFolders()) {
    if (f.figma?.name) out.add(f.figma.name.toLowerCase());
    const p = await readProject(f.dir).catch(() => null);
    if (p?.name) out.add(p.name.toLowerCase());
  }
  return out;
}

/**
 * Makes <root>/<slug> with project.json and the skills. Refuses a bad name, a name another project has, a folder
 * that is there already, and anything that would land outside the root. Nothing is overwritten.
 */
export async function createProject(input: unknown, opts: { root?: string; now?: number } = {}): Promise<{ cwd: string; name: string; project: Project }> {
  const name = cleanProjectName(input);
  const problem = projectNameProblem(name);
  if (problem) throw new ProjectError(problem);
  const root = path.resolve(opts.root ?? projectsRoot());
  const dir = path.resolve(root, projectSlug(name));
  if (path.dirname(dir) !== root || path.basename(dir) !== projectSlug(name)) throw new ProjectError('That name cannot be a folder in the projects folder.');
  if ((await takenNames()).has(name.toLowerCase())) throw new ProjectError(takenText(name), 409);
  await mkdir(root, { recursive: true });
  // Not recursive: if the folder is there already (another project, or the same slug), this fails and nothing changes.
  await mkdir(dir).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'EEXIST' ? new ProjectError(takenText(name), 409) : err;
  });
  const project: Project = { key: '', name, createdAt: opts.now ?? Date.now(), flows: [], iterations: [] };
  // No key at all on disk: the file has no Figma file yet.
  const { key: _none, ...onDisk } = project;
  await writeFile(path.join(dir, PROJECT_FILE), JSON.stringify(onDisk, null, 2));
  await installSkills(dir);
  return { cwd: dir, name, project };
}

/**
 * Adds a Figma file to a project: figma.json in the project's own folder and the key in project.json. Refuses a
 * folder that has a file already and a file another project folder holds, so one file never has two folders.
 */
export async function linkFile(dir: string, file: { url: string; name?: string }): Promise<FigmaFile> {
  const root = projectRoot(dir);
  const parsed = parseFigmaUrl(String(file.url ?? '').trim());
  if (!parsed) throw new FigmaError('That is not a Figma file link. Copy the link from the Share button or the address bar.');
  if (!(await stat(path.join(root, PROJECT_FILE)).then(() => true, () => false))) throw new ProjectError('This folder is not a project made in Design Studio.');
  if (await readFile(path.join(root, 'figma.json'), 'utf8').then(() => true, () => false)) throw new ProjectError('This project has a Figma file already.', 409);
  const other = (await chatFolders()).find((f) => f.figma?.key === parsed.key && path.resolve(f.dir) !== root);
  if (other) throw new ProjectError(`That file is in another project already: ${other.figma!.name}.`, 409);
  // A file made by New project carries the project's name; a linked one keeps the name in its link.
  const fromLink = nameFromUrl(file.url, parsed.key);
  const name = file.name?.trim() || (fromLink !== 'Figma file' ? fromLink : (await readProject(root))?.name ?? fromLink);
  const figma: FigmaFile = { key: parsed.key, name, url: `https://www.figma.com/design/${parsed.key}` };
  await writeFile(path.join(root, 'figma.json'), JSON.stringify(figma, null, 2));
  await updateProject(root, (p) => (p ? { ...p, key: parsed.key } : p));
  return figma;
}

const making = new Set<string>();

/**
 * Makes a new Figma file named after the project (Drafts, or a Figma project when its id is given) and links it.
 * One at a time per project, and never for a project that has a file already, so a double click never makes two.
 */
export async function createFileFor(dir: string, input: { planKey: string; projectId?: string }, deps: ReadDeps = {}): Promise<FigmaFile> {
  const root = projectRoot(dir);
  const project = await readProject(root);
  if (!project) throw new ProjectError('This folder is not a project made in Design Studio.');
  if (project.key || (await stat(path.join(root, 'figma.json')).then(() => true, () => false))) throw new ProjectError('This project has a Figma file already.', 409);
  if (making.has(root)) throw new ProjectError('The file is being made in Figma already.', 409);
  making.add(root);
  try {
    const name = project.name ?? path.basename(root);
    const made = await createFigmaFile(root, { fileName: name, planKey: input.planKey, ...(input.projectId ? { projectId: input.projectId } : {}) }, deps);
    return await linkFile(root, { url: made.url, name });
  } finally {
    making.delete(root);
  }
}
