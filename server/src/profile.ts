import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { MODELS, type DesignSystem, type FigmaFile } from '../../shared/design.js';
import { fileOutline } from './figmaCache.js';
import { figmaMcp, lean } from './lean.js';

export const PROFILE_FILE = 'design-system.json';
/** Written when she removes the profile, so a design run does not build a new one. Any saved profile deletes it. */
export const PROFILE_OFF_FILE = 'design-system.off';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['libraries', 'colors', 'text', 'spacing', 'radius', 'components', 'rules'],
  properties: {
    libraries: { type: 'array', items: { type: 'string' } },
    colors: { type: 'array', maxItems: 120, items: { type: 'object', additionalProperties: false, required: ['name', 'value'], properties: { name: { type: 'string' }, value: { type: 'string', description: 'hex like #1a2b3c' }, variable: { type: 'string' } } } },
    text: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, family: { type: 'string' }, size: { type: 'number' }, weight: { type: ['number', 'string'] }, lineHeight: { type: ['number', 'string'] } } } },
    spacing: { type: 'array', items: { type: 'number' } },
    radius: { type: 'array', items: { type: 'number' } },
    components: { type: 'array', maxItems: 150, items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, key: { type: 'string' }, variants: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } } } },
    rules: { type: 'array', maxItems: 25, items: { type: 'string' } },
  },
};

export async function readProfile(dir: string): Promise<DesignSystem | null> {
  return readFile(path.join(dir, PROFILE_FILE), 'utf8').then(JSON.parse).catch(() => null);
}

/** True when she removed the profile on purpose and has not added one since. */
export async function profileOff(dir: string): Promise<boolean> {
  return access(path.join(dir, PROFILE_OFF_FILE)).then(() => true, () => false);
}

export function profileMarkdown(ds: DesignSystem) {
  return [
    '# Design system profile',
    '',
    `Libraries: ${ds.libraries.join(', ') || 'none found'}`,
    '',
    '## Colors',
    ...ds.colors.map((c) => `- ${c.name}: ${c.value}${c.variable ? ` (variable ${c.variable})` : ''}`),
    '',
    '## Text styles',
    ...ds.text.map((t) => `- ${t.name}: ${[t.family, t.size && `${t.size}px`, t.weight, t.lineHeight && `line ${t.lineHeight}`].filter(Boolean).join(' ')}`),
    '',
    `## Spacing\n${ds.spacing.join(', ')}`,
    '',
    `## Radius\n${ds.radius.join(', ')}`,
    '',
    '## Components',
    ...ds.components.map((c) => `- ${c.name}${c.key ? ` (key ${c.key})` : ''}${c.variants?.length ? `: ${c.variants.join(', ')}` : ''}`),
    '',
    '## Rules',
    ...ds.rules.map((r) => `- ${r}`),
    '',
  ].join('\n');
}

/**
 * Reads the file's variables, styles and components through the plugin first (about half a cent, names and values
 * only) and keeps what she already has: starter values, code tokens, dropped items, rule files. Only when the plugin
 * read fails or finds nothing does a model search the library through the Figma tools.
 */
export async function buildProfile(dir: string, figma: FigmaFile, signal?: AbortSignal) {
  try {
    const { readFigmaKit, writeProfile } = await import('./dsSources.js');
    const { blankProfile, mergeFound, withSource } = await import('../../shared/dsProfiles.js');
    const r = await readFigmaKit(dir, figma.key, { signal });
    if (r.found.colors.length + r.found.text.length + r.found.components.length > 0) {
      const now = Date.now();
      const base = (await readProfile(dir)) ?? blankProfile(now);
      const ds = await writeProfile(dir, withSource(mergeFound(base, r.found, 'figma', now), { kind: 'figma', key: figma.key, name: figma.name, at: now }));
      return { ds, tokens: 0, costUsd: r.costUsd };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error('profile plugin read:', (err as Error).message);
  }
  return buildProfileWithModel(dir, figma, signal);
}

async function buildProfileWithModel(dir: string, figma: FigmaFile, signal?: AbortSignal) {
  const { servers, plugins, name } = await figmaMcp();
  const frames = await fileOutline(dir, figma.key, { signal }).then((o) => o.pages.flatMap((p) => p.frames).slice(0, 6).map((f) => `${f.id} ${f.name} (${f.page})`)).catch(() => [] as string[]);
  const prompt = [
    `Build a design system profile for the Figma file ${figma.name} (${figma.url}, file key ${figma.key}).`,
    'Use the Figma tools: list the libraries the file uses, search the design system for common components (button, input, select, checkbox, card, list item, navigation, tab, dialog, icon, avatar, badge) and for color and text styles, and read the variables used by a few frames.',
    frames.length ? `Frames you can read variables from:\n${frames.join('\n')}` : 'The file outline is not available; search the design system instead.',
    'Return colors as hex with their variable or style name, text styles with size, weight and line height, the spacing and radius scales in pixels, components with their keys and main variants, and up to 25 short rules a designer must follow (for example "Primary button only once per screen").',
    'Leave a list empty when you find nothing for it. Do not invent values.',
  ].join('\n\n');
  const r = await lean<Omit<DesignSystem, 'builtAt'>>(prompt, {
    cwd: dir,
    model: MODELS.work,
    system: 'You collect facts about a Figma design system through the Figma MCP tools and return them as structured data.',
    schema: SCHEMA,
    tools: [],
    mcp: servers,
    plugins,
    allowed: [`mcp__${name}`],
    maxTurns: 30,
    signal,
  });
  if (!r.data) throw new Error(`Could not build the design system profile: ${r.error ?? 'no result'}`);
  // Merged like the plugin read, so starter values, code tokens, dropped items and rule files stay.
  const { writeProfile } = await import('./dsSources.js');
  const { blankProfile, mergeFound, withSource } = await import('../../shared/dsProfiles.js');
  const now = Date.now();
  const base = (await readProfile(dir)) ?? blankProfile(now);
  const merged = mergeFound(base, r.data, 'figma', now);
  const ds: DesignSystem = await writeProfile(dir, withSource({ ...merged, rules: base.rules.length ? base.rules : r.data.rules }, { kind: 'figma', key: figma.key, name: figma.name, at: now }));
  return { ds, tokens: r.tokens, costUsd: r.costUsd };
}
