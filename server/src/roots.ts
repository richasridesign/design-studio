import path from 'node:path';
import { existsSync } from 'node:fs';
import { CHATS_ROOT, projectsRoot } from './settings.js';

// Two roots hold Design Studio folders: CHATS_ROOT (~/DesignStudio: chats with no file, scratch, the sample, and
// older project folders) and the projects root (~/workspace/design-projects: new projects). Only these two folders
// are ever listed. Nothing above them is read: the workspace holds the designer's private documents.

/** The two roots, resolved. The same folder twice counts once. */
export const roots = () => [...new Set([path.resolve(CHATS_ROOT), path.resolve(projectsRoot())])];

const within = (dir: string, root: string) => dir.startsWith(root + path.sep);

/** True for any folder inside one of the roots, at any depth. */
export const insideRoots = (dir: string) => roots().some((r) => within(path.resolve(dir), r));

/**
 * The project root of a chat folder: the nearest folder, from `dir` upward, that holds figma.json or project.json. The walk stops
 * at the root that holds `dir` and never looks above it. A folder outside the roots, or with no figma.json on the
 * way up, is its own root (chats with no file, the sample, the scratch folder).
 */
export function projectRoot(dir: string): string {
  const abs = path.resolve(dir);
  const root = roots().find((r) => within(abs, r));
  if (!root) return abs;
  let cur = abs;
  while (within(cur, root)) {
    // figma.json marks a project with a file; project.json alone, one made with New project before its file.
    if (existsSync(path.join(cur, 'figma.json')) || existsSync(path.join(cur, 'project.json'))) return cur;
    cur = path.dirname(cur);
  }
  return abs;
}
