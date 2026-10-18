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
  // Older files also hold a Figma token and team ID. clean() keeps only the fields below, so those are dropped on the next save.
  cached = clean({ ...DEFAULT_SETTINGS, ...raw });
  return cached;
}

export function clean(s: Settings): Settings {
  return {
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
  const next = clean({ ...current, ...patch });
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

export const publicSettings = (s: Settings): Settings => ({ ...s });
