import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gitFolder } from '../projectGit.js';

// Where the Canvas tab keeps things: the prototype app in <project>/app (its own git repo, ignored by the project's),
// the board in <project>/canvas/boards, and Design Studio's own template, plugin and engine.

export const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const TEMPLATE = path.join(REPO, 'canvas', 'template');
export const PLUGIN = path.join(REPO, 'canvas', 'plugin');
export const CORE_BIN = path.join(REPO, 'canvas-core', 'target', 'release', 'canvas-core');

export const exists = (p: string) => stat(p).then(() => true, () => false);

/** The project folder for a chat's folder: the project when the chat is in one, else the chat's own folder. */
export const projectOf = async (cwd: string) => (await gitFolder(cwd)) ?? cwd;
export const appOf = (project: string) => path.join(project, 'app');
export const boardFile = (project: string) => path.join(project, 'canvas', 'boards', 'main.json');
