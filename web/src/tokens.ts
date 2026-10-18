import type { DesignSystem } from '../../shared/design';

export type TokenFormat = 'css' | 'tailwind' | 'json';

type Entry = [string, string];
type Model = { color: Entry[]; space: Entry[]; radius: Entry[]; font: Entry[]; size: Entry[] };

const RADIUS_NAMES = ['sm', 'md', 'lg', 'xl', '2xl'];
const FONT_ROLES: [string, RegExp][] = [['heading', /head|title|display/i], ['mono', /code|mono/i], ['body', /body|text|paragraph|label/i]];

export const kebab = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const unique = (nums: number[] | undefined) => [...new Set((nums ?? []).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);

function entries(list: Entry[]): Entry[] {
  const seen = new Set<string>();
  return list.filter(([k]) => k && !seen.has(k) && seen.add(k));
}

function model(ds: Partial<DesignSystem>): Model {
  const color = entries((ds.colors ?? []).filter((c) => c.value).map((c) => [kebab(c.name), c.value]));
  const space = unique(ds.spacing).map((n): Entry => [String(n / 4).replace('.', '-'), `${n}px`]);
  const radii = unique(ds.radius);
  const radius = radii.map((n, i): Entry => [radii.length <= RADIUS_NAMES.length && n < 999 ? RADIUS_NAMES[i] : n >= 999 ? 'full' : String(n), n >= 999 ? '9999px' : `${n}px`]);
  const text = (ds.text ?? []).filter((t) => t.name);
  const font: Entry[] = [];
  for (const [role, re] of FONT_ROLES) {
    const t = text.find((x) => x.family && re.test(x.name));
    if (t?.family) font.push([role, t.family]);
  }
  const first = text.find((t) => t.family)?.family;
  if (first && !font.some(([r]) => r === 'body')) font.push(['body', first]);
  const size = entries(text.filter((t) => t.size).map((t) => [kebab(t.name), `${t.size}px`]));
  return { color, space, radius: entries(radius), font: entries(font), size };
}

const quote = (f: string) => (/^[\w-]+$/.test(f) ? f : `'${f.replace(/'/g, "\\'")}'`);
const fontStack = (family: string) => `${quote(family)}, ${family.toLowerCase().includes('mono') ? 'monospace' : 'sans-serif'}`;

export function toCss(ds: Partial<DesignSystem>): string {
  const m = model(ds);
  const lines = [
    ...m.color.map(([k, v]) => `--color-${k}: ${v};`),
    ...m.space.map(([k, v]) => `--space-${k}: ${v};`),
    ...m.radius.map(([k, v]) => `--radius-${k}: ${v};`),
    ...m.font.map(([k, v]) => `--font-${k}: ${fontStack(v)};`),
    ...m.size.map(([k, v]) => `--text-${k}: ${v};`),
  ];
  return `:root {\n${lines.map((l) => `  ${l}`).join('\n')}${lines.length ? '\n' : ''}}\n`;
}

const record = (list: Entry[], f: (v: string) => unknown = (v) => v) => Object.fromEntries(list.map(([k, v]) => [k, f(v)]));
const nonEmpty = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => Object.keys(v as object).length));

export function toTailwind(ds: Partial<DesignSystem>): string {
  const m = model(ds);
  const extend = nonEmpty({
    colors: record(m.color),
    spacing: record(m.space),
    borderRadius: record(m.radius),
    fontFamily: record(m.font, (v) => [fontStack(v)]),
    fontSize: record(m.size),
  });
  return `export default ${JSON.stringify({ theme: { extend } }, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:')};\n`;
}

export function toJson(ds: Partial<DesignSystem>): string {
  const m = model(ds);
  const group = (list: Entry[], $type: string, f: (v: string) => string = (v) => v) => record(list, (v) => ({ $value: f(v), $type }));
  const tokens = nonEmpty({
    color: group(m.color, 'color'),
    space: group(m.space, 'dimension'),
    radius: group(m.radius, 'dimension'),
    font: group(m.font, 'fontFamily'),
    fontSize: group(m.size, 'dimension'),
  });
  return `${JSON.stringify(tokens, null, 2)}\n`;
}

export const FORMATS: Record<TokenFormat, { label: string; file: string; type: string; build: (ds: Partial<DesignSystem>) => string }> = {
  css: { label: 'CSS', file: 'tokens.css', type: 'text/css', build: toCss },
  tailwind: { label: 'Tailwind', file: 'tailwind.tokens.js', type: 'text/javascript', build: toTailwind },
  json: { label: 'JSON', file: 'tokens.json', type: 'application/json', build: toJson },
};
