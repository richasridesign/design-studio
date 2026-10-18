// Design system profiles: starters she can pick in one click, items found in a Figma file or a tokens file, and
// her rule files. Everything here is optional: designs and reviews work without a profile.

import { AREAS, type Area, type DesignSystem, type DsColor, type DsComponent, type DsFrom, type DsSource, type DsText } from './design.js';

export type StarterId = 'nordic' | 'code' | 'lofi';
export type Starter = { id: StarterId; name: string; detail: string };

export const STARTERS: Starter[] = [
  { id: 'nordic', name: 'Nordic calm B2B', detail: 'Neutral surfaces, one brand blue, 4px grid, type 12 to 24. Uses your rule files.' },
  { id: 'code', name: 'From your code', detail: 'Starts empty. Add a CSS or JSON tokens file and it fills in.' },
  { id: 'lofi', name: 'Lo-fi sketch', detail: 'Black, white and one grey. Reviews skip tokens and look at flow and copy.' },
];

export const SKILLS_DIR = '~/design-skills';

const TYPE_SCALE: DsText[] = [
  { name: 'Caption', size: 12, lineHeight: 16, weight: 400 },
  { name: 'Body', size: 14, lineHeight: 20, weight: 400 },
  { name: 'Body large', size: 16, lineHeight: 24, weight: 400 },
  { name: 'Title small', size: 18, lineHeight: 24, weight: 600 },
  { name: 'Title', size: 20, lineHeight: 28, weight: 600 },
  { name: 'Heading', size: 24, lineHeight: 32, weight: 600 },
];

const tag = <T extends object>(list: T[], from: DsFrom) => list.map((x) => ({ ...x, from }));

/** A new profile from a starter. Values are a starting point: she edits or drops any of them. */
export function starterProfile(id: StarterId, now = Date.now()): DesignSystem {
  const base = { builtAt: now, libraries: [], starter: id, dropped: [] as string[] };
  if (id === 'nordic') {
    return {
      ...base,
      name: 'Nordic calm B2B',
      note: 'Calm, plain and dense enough for work tools. Whitespace and hierarchy over boxes.',
      colors: tag<DsColor>([
        { name: 'text/primary', value: '#1F1F1F' },
        { name: 'text/secondary', value: '#5B5B5B' },
        { name: 'surface/default', value: '#FFFFFF' },
        { name: 'surface/subtle', value: '#F5F5F4' },
        { name: 'surface/selected', value: '#E8EEF9' },
        { name: 'border/subtle', value: '#E2E2E0' },
        { name: 'border/strong', value: '#8C8C8C' },
        { name: 'brand/primary', value: '#2257D6' },
        { name: 'status/error', value: '#C4321F' },
        { name: 'status/warning', value: '#8A5A00' },
        { name: 'status/success', value: '#1F7A3D' },
      ], 'starter'),
      text: tag(TYPE_SCALE, 'starter'),
      spacing: [4, 8, 12, 16, 24, 32, 40, 48],
      radius: [4, 8, 12],
      components: [],
      rules: [
        'One primary button per screen. Two actions side by side never share the same weight.',
        'Status is a shape plus a label, never colour alone. Red means error only.',
        'Subtle border at rest. Shadows only where they carry meaning.',
        'Padding, gaps, radii and sizes are multiples of 4. Type is 12, 14, 16, 18, 20 or 24.',
        'Controls in one toolbar share one height (36px).',
        'Labels read "Label: Value". No em dashes.',
        'Body text at least 4.5:1 contrast, icons and borders at least 3:1.',
      ],
      sources: [{ kind: 'skills', dir: SKILLS_DIR, off: [] }],
      tokens: true,
      areas: [...AREAS],
    };
  }
  if (id === 'lofi') {
    return {
      ...base,
      name: 'Lo-fi sketch',
      note: 'For early flows. Black and white boxes and real words, no brand.',
      colors: tag<DsColor>([
        { name: 'ink', value: '#000000' },
        { name: 'paper', value: '#FFFFFF' },
        { name: 'grey', value: '#8C8C8C' },
      ], 'starter'),
      text: tag<DsText>([
        { name: 'Body', size: 14, lineHeight: 20, weight: 400 },
        { name: 'Label', size: 16, lineHeight: 24, weight: 600 },
        { name: 'Title', size: 24, lineHeight: 32, weight: 600 },
      ], 'starter'),
      spacing: [8, 16, 24, 32],
      radius: [0, 4],
      components: [],
      rules: [
        'Black, white and one grey only. No brand colour, images or icons beyond simple shapes.',
        'Real copy, never lorem ipsum.',
        'Show every state the flow needs: empty, filled, error, waiting and done.',
      ],
      sources: [],
      tokens: false,
      areas: ['interaction', 'writing'],
    };
  }
  return { ...base, name: 'From your code', note: 'Tokens from a CSS or JSON file in your code.', colors: [], text: [], spacing: [], radius: [], components: [], rules: [], sources: [], tokens: true, areas: [...AREAS] };
}

/** An empty profile, for sources added before any starter. */
export const blankProfile = (now = Date.now()): DesignSystem => ({ builtAt: now, libraries: [], colors: [], text: [], spacing: [], radius: [], components: [], rules: [], sources: [], dropped: [] });

export type DsKind = 'color' | 'text' | 'component';
export const dropKey = (kind: DsKind, name: string) => `${kind}:${name}`;

/** What a source found, before merging into a profile. */
export type Found = { colors: DsColor[]; text: DsText[]; components: DsComponent[]; spacing: number[]; radius: number[]; libraries?: string[] };

const uniqSorted = (list: number[]) => [...new Set(list.filter((n) => Number.isFinite(n) && n >= 0 && n <= 400))].sort((a, b) => a - b);

/**
 * Puts what a source found into the profile. Items from the same source kind are replaced (a refresh), items from
 * other sources and items added by hand stay, and anything she dropped stays dropped.
 */
export function mergeFound(ds: DesignSystem, found: Found, from: DsFrom, now = Date.now()): DesignSystem {
  const dropped = new Set(ds.dropped ?? []);
  const keep = <T extends { name: string; from?: DsFrom }>(old: T[], add: T[], kind: DsKind) => {
    const rest = old.filter((x) => x.from !== from);
    const names = new Set(rest.map((x) => x.name));
    return [...rest, ...add.filter((x) => !names.has(x.name) && !dropped.has(dropKey(kind, x.name))).map((x) => ({ ...x, from }))];
  };
  return {
    ...ds,
    builtAt: now,
    libraries: [...new Set([...ds.libraries, ...(found.libraries ?? [])])],
    colors: keep(ds.colors, found.colors, 'color'),
    text: keep(ds.text, found.text, 'text'),
    components: keep(ds.components, found.components, 'component'),
    spacing: found.spacing.length ? uniqSorted([...ds.spacing, ...found.spacing]) : ds.spacing,
    radius: found.radius.length ? uniqSorted([...ds.radius, ...found.radius]) : ds.radius,
  };
}

/** Drops one item. Its name is remembered so a refresh does not bring it back. */
export function dropItem(ds: DesignSystem, kind: DsKind, name: string): DesignSystem {
  const list = kind === 'color' ? 'colors' : kind === 'text' ? 'text' : 'components';
  const item = (ds[list] as Array<{ name: string }>).find((x) => x.name === name);
  if (!item) return ds;
  return { ...ds, [list]: (ds[list] as Array<{ name: string }>).filter((x) => x.name !== name), dropped: [...new Set([...(ds.dropped ?? []), dropKey(kind, name)])] };
}

/** Lets a dropped item come back on the next refresh of its source. */
export const restoreItem = (ds: DesignSystem, key: string): DesignSystem => ({ ...ds, dropped: (ds.dropped ?? []).filter((k) => k !== key) });

/** Adds or replaces a source of the same kind and target. */
export function withSource(ds: DesignSystem, src: DsSource): DesignSystem {
  const same = (s: DsSource) => s.kind === src.kind && (s.kind !== 'code' || (src.kind === 'code' && s.path === src.path));
  return { ...ds, sources: [...(ds.sources ?? []).filter((s) => !same(s)), src] };
}

/** Removes a source and the items it brought in. Items added by hand and from other sources stay. */
export function withoutSource(ds: DesignSystem, index: number): DesignSystem {
  const src = ds.sources?.[index];
  if (!src) return ds;
  const sources = (ds.sources ?? []).filter((_, i) => i !== index);
  if (src.kind === 'skills') return { ...ds, sources };
  const from: DsFrom = src.kind;
  const stillThere = sources.some((s) => s.kind === src.kind);
  if (stillThere) return { ...ds, sources };
  return { ...ds, sources, colors: ds.colors.filter((c) => c.from !== from), text: ds.text.filter((t) => t.from !== from), components: ds.components.filter((c) => c.from !== from) };
}

// Code tokens: CSS custom properties, or a JSON tokens file (W3C design tokens, Style Dictionary or plain nesting).

export const CODE_MAX_BYTES = 512 * 1024;
const MAX_ITEMS = 200;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

/** A colour as #RRGGBB, or null when the value is not a plain colour. */
export function toHex(raw: string): string | null {
  const v = raw.trim();
  if (HEX.test(v)) {
    const h = v.slice(1);
    const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    return `#${full.slice(0, 6).toUpperCase()}`;
  }
  const m = RGB.exec(v);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return null;
}

const px = (raw: string): number | null => {
  const m = /^(-?[\d.]+)(px|rem)?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

type Token = { name: string; value: string; type?: string };

/** Sorts named values into colours, type sizes, spacing and radius, by value and by name. */
function sortTokens(tokens: Token[]): Found {
  const found: Found = { colors: [], text: [], components: [], spacing: [], radius: [] };
  for (const t of tokens.slice(0, MAX_ITEMS * 4)) {
    const name = t.name.replace(/^--/, '');
    const lower = name.toLowerCase();
    const hex = t.type === 'color' || !t.type ? toHex(t.value) : null;
    if (hex) {
      if (found.colors.length < MAX_ITEMS) found.colors.push({ name, value: hex, variable: t.name });
      continue;
    }
    const n = px(t.value);
    if (n === null) continue;
    if (/radius|rounded|corner/.test(lower) || t.type === 'borderRadius') found.radius.push(n);
    else if (/font-?size|text-?(xs|sm|md|lg|xl|\d)|type-|fontsize/.test(lower) || t.type === 'fontSize') {
      if (found.text.length < MAX_ITEMS) found.text.push({ name, size: n });
    } else if (/space|spacing|gap|gutter|pad|margin|size-\d/.test(lower) || t.type === 'spacing' || t.type === 'dimension') found.spacing.push(n);
  }
  found.spacing = uniqSorted(found.spacing);
  found.radius = uniqSorted(found.radius);
  return found;
}

/** Custom properties from a CSS file. A var() reference is followed one level when it points at a plain value. */
export function parseCssTokens(css: string): Found {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const raw = new Map<string, string>();
  for (const m of plain.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) if (!raw.has(m[1])) raw.set(m[1], m[2].trim());
  const resolve = (v: string) => {
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v);
    return ref ? raw.get(ref[1]) ?? v : v;
  };
  return sortTokens([...raw].map(([name, value]) => ({ name, value: resolve(value) })));
}

/** Tokens from a JSON file: leaves with $value or value, or plain string and number leaves, named by their path. */
export function parseJsonTokens(text: string): Found {
  const data = JSON.parse(text) as unknown;
  const out: Token[] = [];
  const walk = (node: unknown, trail: string[], type?: string) => {
    if (out.length > MAX_ITEMS * 4 || trail.length > 8) return;
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const o = node as Record<string, unknown>;
      const t = typeof o.$type === 'string' ? o.$type : typeof o.type === 'string' ? o.type : type;
      const v = '$value' in o ? o.$value : 'value' in o && (typeof o.value === 'string' || typeof o.value === 'number') ? o.value : undefined;
      if (v !== undefined) {
        if (typeof v === 'string' || typeof v === 'number') out.push({ name: trail.join('/'), value: typeof v === 'number' ? `${v}px` : v, type: t });
        return;
      }
      for (const [k, child] of Object.entries(o)) if (!k.startsWith('$')) walk(child, [...trail, k], t);
      return;
    }
    if (typeof node === 'string') out.push({ name: trail.join('/'), value: node, type });
    else if (typeof node === 'number') out.push({ name: trail.join('/'), value: `${node}px`, type });
  };
  walk(data, []);
  // References like {color.blue.500} stay unresolved and are skipped by sortTokens.
  return sortTokens(out);
}

export function parseCodeTokens(file: string, text: string): Found {
  if (/\.json$/i.test(file)) return parseJsonTokens(text);
  if (/\.css$/i.test(file)) return parseCssTokens(text);
  throw new Error('Pick a .css or .json file');
}

// Figma: the plugin script returns local variables, paint and text styles, and component sets. Only names and values.

export type FigmaKitRaw = {
  file?: string;
  variables?: Array<{ name: string; collection?: string; type: string; value: unknown }>;
  paints?: Array<{ name: string; hex: string | null }>;
  texts?: Array<{ name: string; family?: string; style?: string; size?: number; lineHeight?: number | string }>;
  components?: Array<{ name: string; key?: string; variants?: string[]; description?: string }>;
};

const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const weightOf = (style?: string) => (style ? WEIGHTS[style.toLowerCase().replace(/[\s-]/g, '').replace('italic', '') || 'regular'] : undefined);

export function parseFigmaKit(raw: FigmaKitRaw): Found {
  const found: Found = { colors: [], text: [], components: [], spacing: [], radius: [], libraries: raw.file ? [raw.file] : [] };
  const seen = new Set<string>();
  for (const v of raw.variables ?? []) {
    if (v.type === 'COLOR' && typeof v.value === 'string') {
      const hex = toHex(v.value);
      if (hex && !seen.has(v.name)) { seen.add(v.name); found.colors.push({ name: v.name, value: hex, variable: v.collection ? `${v.collection}/${v.name}` : v.name }); }
    } else if (v.type === 'FLOAT' && typeof v.value === 'number') {
      const lower = v.name.toLowerCase();
      if (/radius|corner/.test(lower)) found.radius.push(v.value);
      else if (/space|spacing|gap|padding|margin/.test(lower)) found.spacing.push(v.value);
    }
  }
  for (const p of raw.paints ?? []) {
    const hex = p.hex && toHex(p.hex);
    if (hex && !seen.has(p.name)) { seen.add(p.name); found.colors.push({ name: p.name, value: hex }); }
  }
  for (const t of raw.texts ?? []) found.text.push({ name: t.name, family: t.family, size: t.size, weight: weightOf(t.style) ?? t.style, lineHeight: t.lineHeight });
  for (const c of raw.components ?? []) found.components.push({ name: c.name, ...(c.key ? { key: c.key } : {}), ...(c.variants?.length ? { variants: c.variants.slice(0, 12) } : {}), ...(c.description ? { description: c.description.slice(0, 200) } : {}) });
  found.colors = found.colors.slice(0, MAX_ITEMS);
  found.text = found.text.slice(0, MAX_ITEMS);
  found.components = found.components.slice(0, MAX_ITEMS);
  found.spacing = uniqSorted(found.spacing);
  found.radius = uniqSorted(found.radius);
  return found;
}

// Rule files: one folder per area in ~/design-skills, each with a SKILL.md. Read at review time, never copied.

export const SKILL_AREAS: Record<string, Area> = {
  'design-system-review': 'system',
  'interaction-design-review': 'interaction',
  'visual-craft-review': 'visual',
  'ux-writing-review': 'writing',
  'accessibility-review': 'accessibility',
};

/** The area a rule folder feeds, by its name. Other folders (design-process) are listed but not given to reviewers. */
export function skillArea(folder: string): Area | null {
  if (SKILL_AREAS[folder]) return SKILL_AREAS[folder];
  const f = folder.toLowerCase();
  if (/access|a11y/.test(f)) return 'accessibility';
  if (/writing|copy|content/.test(f)) return 'writing';
  if (/interaction|prototype|flow/.test(f)) return 'interaction';
  if (/visual|craft/.test(f)) return 'visual';
  if (/system|component|token/.test(f)) return 'system';
  return null;
}

/** The rule folders a profile reads for one reviewer, turned-off folders left out. */
export function skillFoldersFor(ds: DesignSystem | null, areas: Area[], folders: string[]): string[] {
  const src = ds?.sources?.find((s): s is Extract<DsSource, { kind: 'skills' }> => s.kind === 'skills');
  if (!src) return [];
  return folders.filter((f) => !src.off.includes(f)).filter((f) => {
    const a = skillArea(f);
    return a !== null && areas.includes(a);
  });
}
