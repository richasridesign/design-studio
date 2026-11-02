import path from 'node:path';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cleanBoard, emptyBoard, type Board } from '../../../shared/canvas.js';
import { compareIds, vId } from '../../../shared/project.js';
import { chatContext, flowDir, ITERATIONS_DIR, iterationDir } from '../project.js';
import { boardFile } from './paths.js';

// Which board a chat opens: a flow chat has its iteration's flow board (flows/NN-slug/iterations/<id>/canvas.json,
// recorded by clicking through the app), any other chat the project's main board of every screen. Like her Figma
// versions, a new iteration starts from a copy of the flow's latest earlier board, and a frozen one is read only.

export type BoardPlace = { file: string; flow: { n: number; name: string; iteration: string; frozen: boolean } | null; earlier: string[] };

export async function boardPlace(project: string, cwd: string): Promise<BoardPlace> {
  const ctx = await chatContext(cwd).catch(() => null);
  if (ctx?.scope !== 'flow' || !ctx.flow || !ctx.iteration) return { file: boardFile(project), flow: null, earlier: [] };
  const root = ctx.root ?? project;
  const flow = ctx.flow;
  const id = ctx.iteration.id;
  const ids = await readdir(path.join(flowDir(root, flow), ITERATIONS_DIR)).catch(() => [] as string[]);
  const earlier = ids.filter((x) => compareIds(x, id) < 0).sort(compareIds).reverse().map((x) => path.join(iterationDir(root, flow, x), 'canvas.json'));
  return {
    file: path.join(iterationDir(root, flow, id), 'canvas.json'),
    flow: { n: flow.n, name: flow.name ?? '', iteration: vId(id), frozen: ctx.iteration.state === 'frozen' },
    earlier,
  };
}

const parse = (raw: string | null) => {
  if (!raw) return null;
  try { return cleanBoard(JSON.parse(raw)); } catch { return null; }
};

export async function readBoard(place: BoardPlace): Promise<Board> {
  const own = parse(await readFile(place.file, 'utf8').catch(() => null));
  if (own) return own;
  if (!place.flow) return emptyBoard();
  const name = `Flow ${place.flow.n} · ${place.flow.name} · ${place.flow.iteration}`;
  // Not saved until she changes it, so opening a new iteration's canvas writes nothing.
  for (const file of place.earlier) {
    const prev = parse(await readFile(file, 'utf8').catch(() => null));
    if (prev?.frames.length) return { ...prev, name };
  }
  return { ...emptyBoard(), name };
}

export async function writeBoard(place: BoardPlace, board: unknown): Promise<Board> {
  if (place.flow?.frozen) throw new Error(`${place.flow.iteration} is frozen, so its board is read only`);
  const clean = cleanBoard(board);
  await mkdir(path.dirname(place.file), { recursive: true });
  const tmp = `${place.file}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n');
  await rename(tmp, place.file);
  return clean;
}
