import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { AREAS, DEFAULT_SETTINGS, PRESETS, type Settings } from '../../shared/design.js';

export const HOME = path.join(os.homedir(), '.designstudio');
export const CHATS_ROOT = process.env.DESIGN_STUDIO_ROOT ?? path.join(os.homedir(), 'DesignStudio');
const FILE = path.join(HOME, 'settings.json');

let cached: Settings | null = null;

export async function settings(): Promise<Settings> {
  if (cached) return cached;
  const raw = await readFile(FILE, 'utf8').then(JSON.parse).catch(() => ({}));
  cached = clean({ ...DEFAULT_SETTINGS, ...raw });
  if (!cached.figmaToken && process.env.FIGMA_TOKEN) cached.figmaToken = process.env.FIGMA_TOKEN;
  return cached;
}

export function clean(s: Settings): Settings {
  return {
    figmaToken: String(s.figmaToken ?? '').trim(),
    teamId: String(s.teamId ?? '').replace(/\D/g, ''),
    stopAfterSketch: Boolean(s.stopAfterSketch),
    preset: PRESETS.includes(s.preset) ? s.preset : DEFAULT_SETTINGS.preset,
    areas: Array.isArray(s.areas) ? AREAS.filter((a) => s.areas.includes(a)) : DEFAULT_SETTINGS.areas,
    askBeforeEdit: Boolean(s.askBeforeEdit),
    followClaude: s.followClaude !== false,
    autoCheck: s.autoCheck !== false,
    devTools: Boolean(s.devTools),
    dailyBudgetUsd: Math.max(0, Number(s.dailyBudgetUsd) || 0),
  };
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await settings();
  const next = clean({ ...current, ...patch, figmaToken: patch.figmaToken === undefined || patch.figmaToken === masked(current.figmaToken) ? current.figmaToken : patch.figmaToken });
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

export const masked = (token: string) => (token ? `${token.slice(0, 6)}…${token.slice(-4)}` : '');

export const publicSettings = (s: Settings): Settings => ({ ...s, figmaToken: masked(s.figmaToken) });
