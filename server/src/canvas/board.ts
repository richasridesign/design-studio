import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cleanBoard, emptyBoard, type Board } from '../../../shared/canvas.js';
import { boardFile } from './paths.js';

export async function readBoard(project: string): Promise<Board> {
  const raw = await readFile(boardFile(project), 'utf8').catch(() => null);
  if (!raw) return emptyBoard();
  try {
    return cleanBoard(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

export async function writeBoard(project: string, board: unknown): Promise<Board> {
  const clean = cleanBoard(board);
  const file = boardFile(project);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n');
  await rename(tmp, file);
  return clean;
}
