import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { MODELS, type DesignSystem, type FigmaFile } from '../../shared/design.js';
import { fileOutline } from './figma.js';
import { figmaMcp, lean } from './lean.js';

export const PROFILE_FILE = 'design-system.json';

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

export async function buildProfile(dir: string, figma: FigmaFile, signal?: AbortSignal) {
  const { servers } = await figmaMcp();
  const name = Object.keys(servers)[0];
  const frames = await fileOutline(figma.key).then((o) => o.pages.flatMap((p) => p.frames).slice(0, 6).map((f) => `${f.id} ${f.name} (${f.page})`)).catch(() => [] as string[]);
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
    allowed: [`mcp__${name}`],
    maxTurns: 30,
    signal,
  });
  if (!r.data) throw new Error(`Could not build the design system profile: ${r.error ?? 'no result'}`);
  const ds: DesignSystem = { builtAt: Date.now(), ...r.data };
  await writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(ds, null, 2));
  await writeFile(path.join(dir, 'design-system.md'), profileMarkdown(ds));
  return { ds, tokens: r.tokens, costUsd: r.costUsd };
}
