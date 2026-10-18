import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Spend, SpendPart } from '../../shared/protocol.js';
import { HOME } from './settings.js';

export type DaySpend = { day: string; costUsd: number; tokens: number };

export const emptySpend = (): Spend => ({ tokens: 0, costUsd: 0, byPhase: {}, byModel: {} });

const bump = (p: SpendPart | undefined, tokens: number, costUsd: number): SpendPart => ({ tokens: (p?.tokens ?? 0) + tokens, costUsd: (p?.costUsd ?? 0) + costUsd });

export function addSpend(total: Spend, phase: string, model: string, tokens: number, costUsd: number): Spend {
  return {
    tokens: total.tokens + tokens,
    costUsd: total.costUsd + costUsd,
    byPhase: { ...total.byPhase, [phase]: bump(total.byPhase[phase], tokens, costUsd) },
    byModel: { ...total.byModel, [model]: bump(total.byModel[model], tokens, costUsd) },
  };
}

export const rollDay = (state: DaySpend, today: string): DaySpend => (state.day === today ? state : { day: today, costUsd: 0, tokens: 0 });

export const modelTokens = (u: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }) =>
  u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;

const FILE = path.join(HOME, 'spend.json');
const dayOf = () => new Date().toLocaleDateString('en-CA');

let day: DaySpend | null = null;

async function current(): Promise<DaySpend> {
  if (!day) {
    const raw = await readFile(FILE, 'utf8').then(JSON.parse).catch(() => ({}));
    day = { day: String(raw.day ?? ''), costUsd: Number(raw.costUsd) || 0, tokens: Number(raw.tokens) || 0 };
  }
  return (day = rollDay(day, dayOf()));
}

export async function today() {
  const { costUsd, tokens } = await current();
  return { costUsd, tokens };
}

export async function addDaily(tokens: number, costUsd: number) {
  const d = await current();
  day = { ...d, tokens: d.tokens + tokens, costUsd: d.costUsd + costUsd };
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, JSON.stringify(day)).catch(() => {});
}

const chatFile = (cwd: string) => path.join(cwd, 'spend.json');

async function readChatSpends(cwd: string): Promise<Record<string, Spend>> {
  const raw = await readFile(chatFile(cwd), 'utf8').then(JSON.parse).catch(() => null);
  return raw && typeof raw === 'object' ? raw : {};
}

export async function loadChatSpend(cwd: string, sessionId: string): Promise<Spend> {
  const s = (await readChatSpends(cwd))[sessionId];
  return s ? { ...emptySpend(), ...s } : emptySpend();
}

export async function saveChatSpend(cwd: string, sessionId: string, spend: Spend) {
  const all = await readChatSpends(cwd);
  await writeFile(chatFile(cwd), JSON.stringify({ ...all, [sessionId]: spend }));
}
