import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Area, DesignSystem, DsSource, FigmaFile } from '../../shared/design.js';
import {
  CODE_MAX_BYTES, SKILLS_DIR, blankProfile, dropItem, mergeFound, parseCodeTokens, parseFigmaKit, restoreItem, skillArea, skillFoldersFor,
  starterProfile, withSource, withoutSource, type DsKind, type FigmaKitRaw, type StarterId,
} from '../../shared/dsProfiles.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { PROFILE_FILE, PROFILE_OFF_FILE, profileMarkdown, readProfile } from './profile.js';
import { projectRoot } from './roots.js';

// Where a profile's items come from: a starter, the Figma file (read through the plugin), a tokens file in code,
// and her rule files. The rule files are only listed here; reviewers read them live.

/**
 * Plugin API code for the Figma source. It only reads: local variables (default mode, aliases followed once), paint
 * and text styles, and component sets and loose components on every page. Names and values only, no layers.
 */
export const FIGMA_KIT_BODY = `const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const colName = {}; const modeOf = {};
for (const c of cols) { colName[c.id] = c.name; modeOf[c.id] = c.defaultModeId; }
const variables = [];
for (const v of (await figma.variables.getLocalVariablesAsync()).slice(0, 600)) {
  let val = v.valuesByMode[modeOf[v.variableCollectionId]];
  if (val && val.type === 'VARIABLE_ALIAS') {
    const t = await figma.variables.getVariableByIdAsync(val.id);
    val = t ? t.valuesByMode[modeOf[t.variableCollectionId]] ?? Object.values(t.valuesByMode)[0] : null;
  }
  if (v.resolvedType === 'COLOR' && val && typeof val === 'object' && 'r' in val) variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: 'COLOR', value: hex(val) });
  else if (v.resolvedType === 'FLOAT' && typeof val === 'number') variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: 'FLOAT', value: val });
}
const paints = (await figma.getLocalPaintStylesAsync()).slice(0, 200).map((s) => {
  const p = s.paints[0];
  return { name: s.name, hex: p && p.type === 'SOLID' ? hex(p.color) : null };
});
const texts = (await figma.getLocalTextStylesAsync()).slice(0, 120).map((s) => ({
  name: s.name, family: s.fontName.family, style: s.fontName.style, size: s.fontSize,
  lineHeight: s.lineHeight.unit === 'PIXELS' ? s.lineHeight.value : s.lineHeight.unit === 'PERCENT' ? Math.round(s.lineHeight.value) + '%' : 'auto',
}));
const components = [];
for (const page of figma.root.children) {
  if (components.length >= 200) break;
  try { await page.loadAsync(); } catch (e) { continue; }
  let found = [];
  try { found = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }); } catch (e) { found = []; }
  for (const n of found) {
    if (components.length >= 200) break;
    if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') continue;
    // A set with variant errors throws on its definitions; skip its variants, never the whole read.
    let variants = [];
    if (n.type === 'COMPONENT_SET') {
      try { variants = Object.entries(n.componentPropertyDefinitions).filter(([, d]) => d.type === 'VARIANT').map(([k, d]) => k + ': ' + (d.variantOptions || []).join(' / ')); } catch (e) { variants = []; }
    }
    try { components.push({ name: n.name, key: n.key, variants, description: n.description || '' }); } catch (e) { components.push({ name: n.name, key: '', variants, description: '' }); }
  }
}
return { file: figma.root.name, variables, paints, texts, components };`;

/** Reads the Figma file's variables, styles and components through the plugin. About half a cent. */
export async function readFigmaKit(dir: string, fileKey: string, opts: { signal?: AbortSignal } & ReadDeps = {}) {
  const r = await pluginScript<FigmaKitRaw>(fileKey, FIGMA_KIT_BODY, 'Read variables, styles and components for the design system profile (read only)', { dir, key: 'ds-kit', ...opts });
  return { found: parseFigmaKit(r.value ?? {}), costUsd: r.costUsd };
}

export const expandHome = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** A tokens file in code: .css or .json, at most 512 KB. */
export async function readCodeTokens(file: string) {
  const full = path.resolve(expandHome(file.trim()));
  if (!/\.(css|json)$/i.test(full)) throw new Error('Pick a .css or .json file');
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new Error(`No file at ${file}`);
  if (info.size > CODE_MAX_BYTES) throw new Error('That file is over 512 KB. Pick the tokens file itself.');
  return { path: full, found: parseCodeTokens(full, await readFile(full, 'utf8')) };
}

export type SkillFile = { folder: string; area: Area | null; path: string; lines: number };

/** The rule folders in a skills directory that hold a SKILL.md. */
export async function listSkills(dir = SKILLS_DIR): Promise<SkillFile[]> {
  const root = expandHome(dir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: SkillFile[] = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const file = path.join(root, e.name, 'SKILL.md');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    out.push({ folder: e.name, area: skillArea(e.name), path: file, lines: text.split('\n').filter((l) => /^\s*[-*]\s/.test(l)).length });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

/** A single area's reviewer reads its whole file; the Quick reviewer reads the start of each. */
export const SKILL_CHARS = { one: 12000, each: 4000 } as const;

/** Her rules for one reviewer, read from disk now, so edits to the files apply to the next review. */
export async function skillRulesFor(ds: DesignSystem | null, areas: Area[]): Promise<string> {
  const src = ds?.sources?.find((s): s is Extract<DsSource, { kind: 'skills' }> => s.kind === 'skills');
  if (!src) return '';
  const files = await listSkills(src.dir);
  const folders = skillFoldersFor(ds, areas, files.map((f) => f.folder));
  const cap = areas.length > 1 ? SKILL_CHARS.each : SKILL_CHARS.one;
  const parts: string[] = [];
  for (const f of files.filter((x) => folders.includes(x.folder))) {
    const text = (await readFile(f.path, 'utf8').catch(() => '')).trim();
    if (!text) continue;
    parts.push(`From ${f.folder}/SKILL.md:\n${text.length > cap ? `${text.slice(0, cap)}\n(cut here)` : text}`);
  }
  return parts.join('\n\n');
}

/** Every saved profile goes through here, so adding one in any way lifts "removed on purpose". */
export async function writeProfile(chatDir: string, ds: DesignSystem) {
  const dir = projectRoot(chatDir);
  await writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(ds, null, 2));
  await writeFile(path.join(dir, 'design-system.md'), profileMarkdown(ds));
  await rm(path.join(dir, PROFILE_OFF_FILE), { force: true });
  return ds;
}

export type DsAction =
  | { action: 'starter'; id: StarterId }
  | { action: 'figma' }
  | { action: 'code'; path: string }
  | { action: 'skills'; dir?: string }
  | { action: 'skill-off'; folder: string; off: boolean }
  | { action: 'remove-source'; index: number }
  | { action: 'drop'; kind: DsKind; name: string }
  | { action: 'restore'; key: string }
  | { action: 'edit'; name?: string; note?: string; rules?: string[]; tokens?: boolean }
  | { action: 'clear' };

const STARTER_IDS: StarterId[] = ['nordic', 'code', 'lofi'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** GET for the editor: the profile and the rule folders it can read. */
export async function designSystemView(dir: string) {
  const ds = await readProfile(dir);
  const src = ds?.sources?.find((s): s is Extract<DsSource, { kind: 'skills' }> => s.kind === 'skills');
  return { ds, skills: await listSkills(src?.dir ?? SKILLS_DIR) };
}

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A new starter for a profile. Sources and items she found or added stay; the starter's own values replace the old
 * starter's. Her name, note and principles stay when she changed them (they differ from the old starter's), so a switch
 * never loses her writing. `kept` names what stayed hers.
 */
export function switchStarter(current: DesignSystem | null, id: StarterId, now = Date.now()): { ds: DesignSystem; kept: string[] } {
  const s = starterProfile(id, now);
  if (!current) return { ds: s, kept: [] };
  const old = STARTER_IDS.includes(current.starter as StarterId) ? starterProfile(current.starter as StarterId, now) : null;
  const hers = (k: 'name' | 'note') => !!current[k]?.trim() && current[k] !== old?.[k];
  const rules = current.rules ?? [];
  const hersRules = rules.length > 0 && !sameLines(rules, old?.rules ?? []);
  const kept = [...(hers('name') ? ['name'] : []), ...(hers('note') ? ['note'] : []), ...(hersRules ? ['principles'] : [])];
  const ds: DesignSystem = {
    ...s,
    ...(hers('name') ? { name: current.name } : {}),
    ...(hers('note') ? { note: current.note } : {}),
    ...(hersRules ? { rules } : {}),
    colors: [...s.colors, ...current.colors.filter((c) => c.from && c.from !== 'starter')],
    text: [...s.text, ...current.text.filter((t) => t.from && t.from !== 'starter')],
    components: current.components.filter((c) => c.from !== 'starter'),
    sources: [...(s.sources ?? []), ...(current.sources ?? []).filter((x) => !(s.sources ?? []).some((y) => y.kind === x.kind))],
    dropped: current.dropped ?? [],
  };
  return { ds, kept };
}

/** One change to the chat's profile. Figma and code sources read their source now; nothing else costs anything. */
export async function changeDesignSystem(chatDir: string, figma: FigmaFile | null, body: unknown, deps: ReadDeps = {}) {
  const dir = projectRoot(chatDir);
  const b = (body ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const current = await readProfile(dir);
  const base = current ?? blankProfile(now);
  let next: DesignSystem | null = base;
  let costUsd = 0;
  let kept: string[] = [];
  switch (b.action) {
    case 'starter': {
      if (!STARTER_IDS.includes(b.id as StarterId)) throw new Error('Unknown starter');
      const r = switchStarter(current, b.id as StarterId, now);
      next = r.ds;
      kept = r.kept;
      break;
    }
    case 'figma': {
      if (!figma) throw new Error('This chat has no Figma file');
      try {
        const r = await readFigmaKit(dir, figma.key, deps);
        costUsd = r.costUsd;
        next = withSource(mergeFound(base, r.found, 'figma', now), { kind: 'figma', key: figma.key, name: figma.name, at: now });
      } catch (err) {
        next = withSource(base, { kind: 'figma', key: figma.key, name: figma.name, at: now, error: (err as Error).message.slice(0, 300) });
      }
      break;
    }
    case 'code': {
      const file = text(b.path, 1000);
      if (!file) throw new Error('Type the path to a .css or .json file');
      const r = await readCodeTokens(file);
      next = withSource(mergeFound(base, r.found, 'code', now), { kind: 'code', path: r.path, at: now });
      break;
    }
    case 'skills':
      next = withSource(base, { kind: 'skills', dir: text(b.dir, 500) || SKILLS_DIR, off: [] });
      break;
    case 'skill-off': {
      const folder = text(b.folder, 200);
      next = { ...base, sources: (base.sources ?? []).map((s) => (s.kind === 'skills' ? { ...s, off: b.off ? [...new Set([...s.off, folder])] : s.off.filter((f) => f !== folder) } : s)) };
      break;
    }
    case 'remove-source':
      next = withoutSource(base, Number(b.index));
      break;
    case 'drop':
      if (!['color', 'text', 'component'].includes(b.kind as string)) throw new Error('Unknown item');
      next = dropItem(base, b.kind as DsKind, text(b.name, 300));
      break;
    case 'restore':
      next = restoreItem(base, text(b.key, 320));
      break;
    case 'edit':
      next = {
        ...base,
        ...(typeof b.name === 'string' ? { name: text(b.name, 80) } : {}),
        ...(typeof b.note === 'string' ? { note: text(b.note, 300) } : {}),
        ...(Array.isArray(b.rules) ? { rules: b.rules.map((r) => text(r, 300)).filter(Boolean).slice(0, 40) } : {}),
        ...(typeof b.tokens === 'boolean' ? { tokens: b.tokens } : {}),
      };
      break;
    case 'clear':
      next = null;
      break;
    default:
      throw new Error('Unknown change');
  }
  if (next === null) {
    await Promise.all([PROFILE_FILE, 'design-system.md'].map((f) => rm(path.join(dir, f), { force: true })));
    // Removed on purpose: design runs carry on without a profile until she adds one.
    await writeFile(path.join(dir, PROFILE_OFF_FILE), `Removed ${new Date(now).toISOString()}\n`);
    return { ds: null, costUsd, kept };
  }
  return { ds: await writeProfile(dir, next), costUsd, kept };
}
