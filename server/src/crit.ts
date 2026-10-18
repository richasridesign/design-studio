import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MODELS, PERSONAS, TONES, type CopyItem, type CopyRun, type CritRun, type Tone } from '../../shared/design.js';
import { readRules, rulesBlock } from './rules.js';
import { download, images, nodes } from './figma.js';
import { lean } from './lean.js';
import { outline } from './review.js';

export const CRIT_FILE = 'crit.json';
export const COPY_FILE = 'copy.json';
const MAX_ITEMS = 40;
const MAX_TEXT = 600;

type Loaded = { id: string; document: any; components: Record<string, any> };

async function loadFrames(fileKey: string, frames: string[]): Promise<Loaded[]> {
  const docs: Loaded[] = [];
  for (let i = 0; i < frames.length; i += 20) {
    const r = await nodes(fileKey, frames.slice(i, i + 20));
    for (const [id, n] of Object.entries(r.nodes)) if (n) docs.push({ id, document: n.document, components: n.components ?? {} });
  }
  return docs;
}

async function takeShots(dir: string, fileKey: string, ids: string[]) {
  const shots: string[] = [];
  await mkdir(path.join(dir, 'review', 'shots'), { recursive: true });
  const urls = await images(fileKey, ids, 1).catch(() => ({}) as Record<string, string | null>);
  for (const id of ids) {
    const url = urls[id];
    if (!url) continue;
    const file = path.join('review', 'shots', `${id.replace(/[:;]/g, '-')}.png`);
    await download(url, path.join(dir, file)).then(() => shots.push(file)).catch(() => {});
  }
  return shots;
}

export function textNodes(doc: any): Array<{ id: string; name: string; characters: string }> {
  const out: Array<{ id: string; name: string; characters: string }> = [];
  const visit = (n: any) => {
    if (!n || n.visible === false) return;
    if (n.type === 'TEXT' && String(n.characters ?? '').trim()) out.push({ id: n.id, name: n.name, characters: String(n.characters).slice(0, MAX_TEXT) });
    for (const c of n.children ?? []) visit(c);
  };
  visit(doc);
  return out;
}

export const parseTone = (arg: string): Tone => {
  const m = /\btone:\s*(\w+)/i.exec(arg)?.[1]?.toLowerCase();
  return (TONES as readonly string[]).includes(m ?? '') ? (m as Tone) : 'friendly';
};

export function copyApplyPrompt(items: Array<{ nodeId: string; before: string; after: string }>) {
  const q = (s: string) => JSON.stringify(s);
  return ['Apply these copy changes in Figma with use_figma, only to these text nodes, keeping their text styles:', ...items.map((i) => `- ${i.nodeId}: ${q(i.before)} -> ${q(i.after)}`)].join('\n');
}

async function readList<T>(dir: string, file: string): Promise<T[]> {
  return readFile(path.join(dir, file), 'utf8').then((t) => JSON.parse(t).runs as T[]).catch(() => []);
}

async function saveRun<T extends { id: string }>(dir: string, file: string, run: T) {
  const runs = (await readList<T>(dir, file)).filter((r) => r.id !== run.id);
  await writeFile(path.join(dir, file), JSON.stringify({ runs: [...runs, run].slice(-30) }, null, 2));
}

export const readCrit = (dir: string) => readList<CritRun>(dir, CRIT_FILE);
export const readCopy = (dir: string) => readList<CopyRun>(dir, COPY_FILE);

const CRIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['personas', 'summary'],
  properties: {
    summary: { type: 'string', description: 'Two sentences on the strongest and weakest parts of the design' },
    personas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'points'],
        properties: {
          id: { type: 'string', enum: [...PERSONAS] },
          verdict: { type: 'string', description: 'One sentence' },
          points: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'text'],
              properties: {
                kind: { type: 'string', enum: ['like', 'concern', 'idea'] },
                text: { type: 'string' },
                nodeId: { type: 'string', description: 'Figma node id like 12:34 from the outline, when the point is about one element' },
              },
            },
          },
        },
      },
    },
  },
};

const CRIT_SYSTEM = 'You give design critique on UI frames from Figma. You get screenshots to look at with the Read tool and an outline with node ids. Cover exactly four viewpoints: new-user (first-time user: clarity, onboarding, next step), power-user (speed, density, shortcuts, efficiency), accessibility (contrast, target size, labels, color-only meaning, reading order), product (goal fit, scope, metrics). Give a one-sentence verdict and at most five points per viewpoint, mixing likes, concerns and ideas. Be specific and use node ids from the outline.';

export async function runCrit(input: { dir: string; fileKey: string; frames: string[]; signal?: AbortSignal; onProgress?: (t: string) => void }): Promise<CritRun> {
  const { dir, fileKey, frames } = input;
  input.onProgress?.('Reading the frames from Figma');
  const docs = await loadFrames(fileKey, frames);
  if (!docs.length) throw new Error('None of the frames could be read from Figma');
  input.onProgress?.('Taking screenshots');
  const shots = await takeShots(dir, fileKey, docs.map((d) => d.id));
  const plan = await readFile(path.join(dir, 'plan.md'), 'utf8').catch(() => '');
  const prompt = [
    plan ? `The brief:\n${plan.slice(0, 3000)}` : 'There is no written brief.',
    shots.length ? `Screenshots to look at with Read:\n${shots.join('\n')}` : 'No screenshots are available; use the outline.',
    `Outline of the frames:\n${docs.map((d) => outline(d.document, d.components)).join('\n\n')}`,
    rulesBlock(await readRules(dir)),
  ].join('\n\n');
  input.onProgress?.('Writing the crit');
  const r = await lean<Pick<CritRun, 'personas' | 'summary'>>(prompt, { cwd: dir, model: MODELS.work, system: CRIT_SYSTEM, schema: CRIT_SCHEMA, tools: ['Read'], maxTurns: 6, signal: input.signal });
  if (!r.data) throw new Error(r.error ?? 'No crit returned');
  const personas = PERSONAS.map((id) => r.data!.personas.find((p) => p.id === id)).filter((p) => !!p).map((p) => ({ ...p!, points: p!.points.slice(0, 5) }));
  const run: CritRun = { id: randomUUID(), at: Date.now(), frames, personas, summary: r.data.summary, tokens: r.tokens, costUsd: r.costUsd };
  await saveRun(dir, CRIT_FILE, run);
  return run;
}

const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tone', 'items'],
  properties: {
    tone: { type: 'string', enum: [...TONES] },
    items: {
      type: 'array',
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'before', 'after', 'reason'],
        properties: {
          nodeId: { type: 'string', description: 'The text node id exactly as given' },
          before: { type: 'string' },
          after: { type: 'string' },
          reason: { type: 'string', description: 'Short, a few words' },
        },
      },
    },
  },
};

const COPY_SYSTEM = 'You edit UI copy. You get every text string in some Figma frames with its node id. Return changes only for strings worth changing. Rules: sentence case, short buttons that start with a verb, one term for one thing everywhere, error messages that say what happened and how to fix it, empty states that say what to do next, no filler words. Keep placeholders, numbers and names unchanged. Match the requested tone.';

export async function runCopy(input: { dir: string; fileKey: string; frames: string[]; tone: Tone; signal?: AbortSignal; onProgress?: (t: string) => void }): Promise<CopyRun> {
  const { dir, fileKey, frames, tone } = input;
  input.onProgress?.('Reading the text from Figma');
  const docs = await loadFrames(fileKey, frames);
  const texts = docs.flatMap((d) => textNodes(d.document).map((t) => ({ ...t, frame: d.document.name as string })));
  if (!texts.length) throw new Error('The frames have no text layers');
  const prompt = [
    `Tone: ${tone}.`,
    `Text layers (${texts.length}), one per line as nodeId | frame | layer name | text:`,
    texts.slice(0, 400).map((t) => `${t.id} | ${t.frame} | ${t.name} | ${JSON.stringify(t.characters)}`).join('\n'),
    `Return at most ${MAX_ITEMS} changes.`,
  ].join('\n');
  input.onProgress?.('Rewriting the copy');
  const r = await lean<{ tone: Tone; items: CopyItem[] }>(prompt, { cwd: dir, model: MODELS.work, system: COPY_SYSTEM, schema: COPY_SCHEMA, tools: [], maxTurns: 2, signal: input.signal });
  if (!r.data) throw new Error(r.error ?? 'No copy changes returned');
  const byId = new Map(texts.map((t) => [t.id, t.characters]));
  const items = r.data.items.filter((i) => byId.has(i.nodeId) && i.after !== byId.get(i.nodeId)).slice(0, MAX_ITEMS).map((i) => ({ ...i, before: byId.get(i.nodeId)! }));
  const run: CopyRun = { id: randomUUID(), at: Date.now(), frames, tone, items, tokens: r.tokens, costUsd: r.costUsd };
  await saveRun(dir, COPY_FILE, run);
  return run;
}
