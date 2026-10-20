import path from 'node:path';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { BOX_KINDS, FRAMES, type BrainstormContent, type BrainstormRound } from '../../shared/brainstorm.js';
import { FIGMA_WRITE } from './lean.js';
import { figmaEdits } from './touched.js';

// Brainstorm mode on the server: the round tool's input, the round files, the saved mode per chat, and the write lock.

/** Largest round, as JSON. Field caps keep each part short; this keeps the whole small enough to send on every change. */
export const ROUND_MAX = 12_000;

const line = (max: number) => z.string().trim().min(1).max(max);
const BOX = z.object({ kind: z.enum(BOX_KINDS), label: z.string().trim().max(48).optional() });
const SKETCH = z.object({
  frame: z.enum(FRAMES).optional().describe('phone, desktop or panel. Default desktop.'),
  rows: z.array(z.array(BOX).min(1).max(3)).min(1).max(10).describe('Top to bottom. Each row is 1 to 3 boxes side by side.'),
});

export const BRAINSTORM_INPUT = {
  problem: line(200).describe('The problem in one line.'),
  assumptions: z.array(line(160)).max(6).describe('What you assume, short lines she can correct.'),
  options: z.array(z.object({
    title: line(60),
    sketch: SKETCH,
    goodFor: line(140).describe('One line: when this option is the right one.'),
    watchOut: line(140).describe('One line: its main risk or cost.'),
  })).min(2).max(3),
  flow: z.array(z.object({
    label: line(60),
    branches: z.array(z.object({ when: line(60), to: line(60) })).max(2).optional(),
  })).max(10).describe('The steps the user takes, in order. Branches are side paths, kept to 2 per step.'),
  questions: z.array(z.object({ text: line(200), answers: z.array(line(80)).min(2).max(4) })).max(4),
};

const SCHEMA = z.object(BRAINSTORM_INPUT);

export const BRAINSTORM_TOOL = [
  'Brainstorm mode only: post this round of the brainstorm to the Brainstorm tab. Call it once per turn, after thinking with the designer, instead of a long chat reply.',
  'problem: one line. assumptions: up to 6 short lines. options: 2 or 3, each with a title, a sketch, goodFor and watchOut (one line each). flow: the user\'s steps as boxes, in order, with up to 2 branches per step ({when, to}). questions: up to 4, each with 2 to 4 suggested answers she can click.',
  `sketch: a grey-box wireframe, no styling. {frame: "phone" | "desktop" | "panel", rows: [[box], [box, box]]}: rows top to bottom, 1 to 3 boxes side by side per row, at most 10 rows. A box is {kind, label}: kind is one of ${BOX_KINDS.join(', ')}; label is a few words ("Search", "HRIS card").`,
  'Example sketch: {"frame":"desktop","rows":[[{"kind":"header","label":"Connectors"}],[{"kind":"input","label":"Search"},{"kind":"button","label":"Add"}],[{"kind":"card","label":"HRIS"},{"kind":"card","label":"Slack"}]]}',
  `The whole round must be under ${ROUND_MAX / 1000}k characters of JSON.`,
].join('\n');

export type Parsed = { ok: true; round: BrainstormContent } | { ok: false; error: string };

/** Checks a round from Claude: the shape and its caps, then the total size. */
export function parseRound(input: unknown): Parsed {
  const r = SCHEMA.safeParse(input);
  if (!r.success) return { ok: false, error: `The round was not saved: ${r.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'round'}: ${i.message}`).join('; ')}` };
  const size = JSON.stringify(r.data).length;
  if (size > ROUND_MAX) return { ok: false, error: `The round was not saved: it is ${size} characters, the limit is ${ROUND_MAX}. Shorten the labels or drop a row.` };
  return { ok: true, round: r.data as BrainstormContent };
}

/** The folder rounds live in: the chat's own folder, which for a flow chat is its iteration folder. Never from input. */
export const brainstormDir = (cwd: string) => path.join(path.resolve(cwd), 'brainstorm');
const roundFile = (cwd: string, n: number) => {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('No such round');
  return path.join(brainstormDir(cwd), `round-${n}.json`);
};

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

async function roundNumbers(cwd: string) {
  const names = await readdir(brainstormDir(cwd)).catch(() => [] as string[]);
  return names.map((f) => /^round-(\d+)\.json$/.exec(f)).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => Number(m[1]));
}

/** Saves a round as the next number in the folder. */
export async function saveRound(cwd: string, chat: string, content: BrainstormContent, now = Date.now()): Promise<BrainstormRound> {
  const n = Math.max(0, ...(await roundNumbers(cwd))) + 1;
  const round: BrainstormRound = { n, at: now, chat, ...content };
  await writeJson(roundFile(cwd, n), round);
  return round;
}

/** This chat's rounds, oldest first. A file that does not parse is skipped. */
export async function listRounds(cwd: string, chat: string): Promise<BrainstormRound[]> {
  const out: BrainstormRound[] = [];
  for (const n of (await roundNumbers(cwd)).sort((a, b) => a - b)) {
    const r = await readFile(roundFile(cwd, n), 'utf8').then((t) => JSON.parse(t) as BrainstormRound).catch(() => null);
    if (r && r.chat === chat && Array.isArray(r.options)) out.push({ ...r, n });
  }
  return out;
}

/** Records the option she built. Throws for a round of another chat or an option that is not there. */
export async function chooseOption(cwd: string, chat: string, n: number, option: number, now = Date.now()): Promise<BrainstormRound> {
  const file = roundFile(cwd, n);
  const r = JSON.parse(await readFile(file, 'utf8')) as BrainstormRound;
  if (r.chat !== chat) throw new Error('That round belongs to another chat');
  if (!Number.isInteger(option) || option < 0 || option >= r.options.length) throw new Error('No such option');
  const next = { ...r, n, chosen: { option, at: now } };
  await writeJson(file, next);
  return next;
}

// ---------- The mode, saved per chat so a resumed chat keeps its lock ----------

const modesFile = (cwd: string) => path.join(brainstormDir(cwd), 'modes.json');
type Modes = Record<string, 'brainstorm'>;

export async function readMode(cwd: string, chat: string): Promise<boolean> {
  const m = await readFile(modesFile(cwd), 'utf8').then((t) => JSON.parse(t) as Modes).catch(() => ({}) as Modes);
  return m[chat] === 'brainstorm';
}

export async function saveMode(cwd: string, chat: string, on: boolean) {
  const m = await readFile(modesFile(cwd), 'utf8').then((t) => JSON.parse(t) as Modes).catch(() => ({}) as Modes);
  if (on === (m[chat] === 'brainstorm')) return;
  if (on) m[chat] = 'brainstorm';
  else delete m[chat];
  await writeJson(modesFile(cwd), m);
}

// ---------- The write lock ----------

export const BRAINSTORM_DENIED = 'This chat is brainstorming, so Figma is read only. Building starts when the designer clicks Build this on an option, or Start building. Keep discussing, and post the next round with mcp__designstudio__brainstorm_update.';

/**
 * While brainstorming: every Figma write tool is denied, and use_figma only when its script edits. Reads (screenshots,
 * metadata, design context, sessions, read-only scripts) stay allowed. Null when allowed.
 */
export function brainstormDeny(brainstorm: boolean, toolName: string, input: Record<string, unknown>): string | null {
  if (!brainstorm || !FIGMA_WRITE.test(toolName)) return null;
  if (/use_figma$/.test(toolName) && typeof input.code === 'string' && !figmaEdits(input.code)) return null;
  return BRAINSTORM_DENIED;
}

/** What Claude is told on every turn while the chat brainstorms. */
export const BRAINSTORM_NOTE = [
  'Brainstorm mode: the designer wants to talk this through before anything is built.',
  'Discuss, ask and sketch; do not build. You may read Figma (screenshots, metadata, the file map, read-only scripts), but every Figma write is blocked, and do not change Figma through the browser either.',
  'This comes before any workflow step or plan: wait until the designer clicks Build this or Start building.',
  'Each turn, post the round with mcp__designstudio__brainstorm_update (problem, assumptions, 2 or 3 options with a grey-box sketch, the flow, questions with suggested answers), then keep your chat reply to one or two lines.',
].join(' ');

export const BUILD_NOTE = 'Brainstorm mode is over: the designer chose to build, so Figma writes are allowed again. Follow the brief in this message.';
