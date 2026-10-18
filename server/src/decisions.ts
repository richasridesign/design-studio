import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOME } from './settings.js';
import { cleanDecisions, isValidKey, type DecisionDoc } from '../../shared/decisions.js';

const DIR = path.join(HOME, 'decisions');

export class DecisionError extends Error {
  status = 400;
}

const file = (key: string) => {
  if (!isValidKey(key)) throw new DecisionError('Not a Figma file key');
  return path.join(DIR, `${key}.json`);
};

export async function readDecisions(key: string): Promise<DecisionDoc> {
  const p = file(key);
  try {
    return cleanDecisions(JSON.parse(await readFile(p, 'utf8')));
  } catch {
    return {};
  }
}

export async function writeDecisions(key: string, input: unknown): Promise<DecisionDoc> {
  const p = file(key);
  const doc = cleanDecisions(input);
  await mkdir(DIR, { recursive: true });
  await writeFile(p, JSON.stringify(doc, null, 2));
  return doc;
}
