import path from 'node:path';
import { mkdir, rename, stat } from 'node:fs/promises';
import { renamePlan, type Rename } from '../../shared/projectNames.js';
import { projectRoot, roots } from './roots.js';
import { readProject, updateProject } from './project.js';
import { cachedMap, refreshMapSoon, taggedSections } from './fileMap.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { withWrite } from './figmaLock.js';

// Two project chores from the sidebar menu: Remove project (the folder moves to .trash, nothing is deleted) and
// Rename to convention (the working iteration's sections get their convention names in Figma, under the write lock).

export const TRASH = '.trash';

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export type RemoveDeps = {
  /** Stops every task on this project; returns how many were open. */
  stopTasks(root: string): Promise<number>;
  /** Closes every live chat whose folder is inside the project; returns how many. */
  closeChats(root: string): Promise<number> | number;
  now?: () => Date;
};

/**
 * Moves a project folder to <its root>/.trash/<name>-<stamp>. The trash sits in the same root, so the move is a
 * rename on one disk; if it is not (EXDEV), nothing is copied or deleted and the error says so. Figma is not touched.
 */
export async function removeProject(dir: string, deps: RemoveDeps): Promise<{ from: string; to: string; tasks: number; chats: number }> {
  const root = projectRoot(dir);
  const home = roots().find((r) => path.dirname(root) === r);
  if (!home) throw new Error('Only a project folder can be removed');
  if (!(await stat(path.join(root, 'figma.json')).then(() => true, () => false))) throw new Error('This folder has no Figma file');
  const tasks = await deps.stopTasks(root);
  const chats = await deps.closeChats(root);
  const trash = path.join(home, TRASH);
  await mkdir(trash, { recursive: true });
  const to = path.join(trash, `${path.basename(root)}-${stamp(deps.now?.() ?? new Date())}`);
  try {
    await rename(root, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') throw new Error(`The trash folder is on another disk, so nothing moved. Move ${root} by hand if you want it gone.`);
    if (code === 'EEXIST' || code === 'ENOTEMPTY') throw new Error('A folder with that name is in the trash already. Try again in a second.');
    throw err;
  }
  return { from: root, to, tasks, chats };
}

/** The renames the project needs now, from the saved map. Empty when the map is not read yet. */
export async function pendingRenames(dir: string, key: string): Promise<Rename[]> {
  const root = projectRoot(dir);
  const [p, map] = await Promise.all([readProject(root), cachedMap(root, key)]);
  if (!p || !map) return [];
  return renamePlan(p, taggedSections(map));
}

export function renameScript(list: Rename[]): string {
  return `const list = ${JSON.stringify(list.map((r) => [r.node, r.want]))};
let renamed = 0;
const missing = [];
for (const [id, name] of list) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'SECTION') { missing.push(id); continue; }
  node.name = name;
  renamed++;
}
return { renamed, missing };`;
}

/** Renames the working iteration's sections in Figma, one script under the file's write lock, then rereads the map. */
export async function renameToConvention(dir: string, key: string, deps: ReadDeps & { refresh?: (root: string, key: string) => void } = {}) {
  const root = projectRoot(dir);
  const list = await pendingRenames(root, key);
  if (!list.length) return { renamed: 0, missing: [] as string[] };
  const r = await withWrite(key, () => pluginScript<{ renamed: number; missing: string[] }>(key, renameScript(list), 'Rename the working iteration sections to the naming convention', { ...deps, dir: root }));
  const done = new Map(list.filter((x) => !(r.value?.missing ?? []).includes(x.node)).map((x) => [x.node, x.want]));
  await updateProject(root, (p) => (p ? { ...p, iterations: p.iterations.map((it) => (it.node && done.has(it.node) ? { ...it, name: done.get(it.node) } : it)) } : p));
  (deps.refresh ?? ((d, k) => refreshMapSoon(d, k, deps)))(root, key);
  return r.value ?? { renamed: 0, missing: [] };
}
