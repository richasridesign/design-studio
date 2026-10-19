import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_FIX_ROUNDS, DEFAULT_SETTINGS, PRESETS, tickedAreas, type Settings } from '../../shared/design.js';
import { parallelChats } from '../../shared/tasks.js';

export const HOME = path.join(os.homedir(), '.designstudio');
export const CHATS_ROOT = process.env.DESIGN_STUDIO_ROOT ?? path.join(os.homedir(), 'DesignStudio');
/** Where new projects (one folder per Figma file) are made unless Settings says otherwise. */
export const PROJECTS_ROOT_DEFAULT = process.env.DESIGN_STUDIO_PROJECTS ?? path.join(os.homedir(), 'workspace', 'design-projects');
const FILE = path.join(HOME, 'settings.json');

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** The projects root: the Settings value when set, else DESIGN_STUDIO_PROJECTS, else ~/workspace/design-projects. */
export const projectsRoot = () => {
  const v = (cached ?? DEFAULT_SETTINGS).projectsRoot;
  return path.resolve(v ? expandHome(v) : PROJECTS_ROOT_DEFAULT);
};

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
    // Old files hold the old default of three of the six old areas, which no screen let her change: they get all five.
    areas: tickedAreas(s.areas),
    askBeforeEdit: Boolean(s.askBeforeEdit),
    followClaude: s.followClaude !== false,
    autoCheck: s.autoCheck !== false,
    devTools: Boolean(s.devTools),
    dailyBudgetUsd: Math.max(0, Number(s.dailyBudgetUsd) || 0),
    fixRounds: Math.min(4, Math.max(1, Math.round(Number(s.fixRounds)) || DEFAULT_FIX_ROUNDS)),
    projectsRoot: typeof s.projectsRoot === 'string' ? s.projectsRoot.trim().slice(0, 500) : '',
    parallelChats: parallelChats(s.parallelChats),
  };
}

/** The settings already loaded, for code that cannot wait. The session loads them when it starts. */
export const loadedSettings = (): Settings => cached ?? DEFAULT_SETTINGS;

export async function saveSettings(patch: Partial<Settings>) {
  const current = await settings();
  const next = clean({ ...current, ...patch });
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

export const publicSettings = (s: Settings): Settings => ({ ...s });
