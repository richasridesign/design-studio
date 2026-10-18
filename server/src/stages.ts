import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { approve, cleanApprovals, reopen, stages, STAGE_IDS, type Stage, type StageApprovals, type StageEvidence, type StageId } from '../../shared/stages.js';

export const STAGES_FILE = 'stages.json';

export const readApprovals = (dir: string): Promise<StageApprovals> =>
  readFile(path.join(dir, STAGES_FILE), 'utf8').then((t) => cleanApprovals(JSON.parse(t))).catch(() => ({}));

export async function changeStage(dir: string, input: { action?: unknown; id?: unknown; note?: unknown }, now = Date.now()): Promise<StageApprovals> {
  const id = STAGE_IDS.find((s) => s === input.id) as StageId | undefined;
  if (!id || (input.action !== 'approve' && input.action !== 'reopen')) throw new Error('Pick a stage to approve or reopen');
  const current = await readApprovals(dir);
  const next = input.action === 'approve' ? approve(current, id, now, typeof input.note === 'string' ? input.note : undefined) : reopen(current, id);
  await writeFile(path.join(dir, STAGES_FILE), JSON.stringify(next, null, 2));
  return next;
}

export async function readStages(dir: string, evidence: StageEvidence): Promise<Stage[]> {
  return stages(evidence, await readApprovals(dir));
}
