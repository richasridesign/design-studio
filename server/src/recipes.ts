import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOME } from './settings.js';
import type { CustomRecipe } from '../../shared/recipes.js';

const FILE = path.join(HOME, 'recipes.json');
const GROUPS = ['make', 'improve', 'ship'];
const MAX = { title: 60, blurb: 140, prompt: 4000, count: 50 };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function cleanRecipes(input: unknown): CustomRecipe[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: CustomRecipe[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = text(r.title, MAX.title);
    const prompt = text(r.prompt, MAX.prompt);
    if (!title || !prompt) continue;
    let id = text(r.id, 64) || `custom-${Date.now().toString(36)}-${out.length}`;
    if (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    const group = GROUPS.includes(r.group as string) ? (r.group as CustomRecipe['group']) : 'make';
    out.push({ id, title, blurb: text(r.blurb, MAX.blurb), prompt, group });
    if (out.length === MAX.count) break;
  }
  return out;
}

export async function readRecipes() {
  try {
    return cleanRecipes(JSON.parse(await readFile(FILE, 'utf8')));
  } catch {
    return [];
  }
}

export async function writeRecipes(input: unknown) {
  const list = cleanRecipes(input);
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, JSON.stringify(list, null, 2));
  return list;
}
