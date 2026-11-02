import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cleanBoard, emptyBoard, type Board } from '../../../shared/canvas.js';
import { chatContext, flowDir } from '../project.js';
import { boardFile } from './paths.js';

// Which board a chat opens: a flow chat has its flow's board (flows/NN-slug/canvas.json, recorded by clicking through
// the app), any other chat the project's main board of every screen. Both follow the project's history.

export type BoardPlace = { file: string; flow: { n: number; name: string } | null };

export async function boardPlace(project: string, cwd: string): Promise<BoardPlace> {
  const ctx = await chatContext(cwd).catch(() => null);
  if (ctx?.scope === 'flow' && ctx.flow) return { file: path.join(flowDir(ctx.root ?? project, ctx.flow), 'canvas.json'), flow: { n: ctx.flow.n, name: ctx.flow.name ?? '' } };
  return { file: boardFile(project), flow: null };
}

export async function readBoard(place: BoardPlace): Promise<Board> {
  const raw = await readFile(place.file, 'utf8').catch(() => null);
  const fresh = place.flow ? { ...emptyBoard(), name: `Flow ${place.flow.n} · ${place.flow.name}` } : emptyBoard();
  if (!raw) return fresh;
  try {
    return cleanBoard(JSON.parse(raw));
  } catch {
    return fresh;
  }
}

export async function writeBoard(place: BoardPlace, board: unknown): Promise<Board> {
  const clean = cleanBoard(board);
  await mkdir(path.dirname(place.file), { recursive: true });
  const tmp = `${place.file}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n');
  await rename(tmp, place.file);
  return clean;
}
