// Tailwind classes as design tokens, for the canvas inspector: `px-4` is horizontal padding at step 4 of the 4px
// scale, `text-text-muted` is the text colour token text-muted. Only plain classes are read; anything with a variant
// (hover:, md:), an arbitrary value (w-[72px]) or an unknown name stays in the raw class field untouched.

export type Tokens = { colors: { name: string; value: string }[]; text: { name: string; value: string }[]; radius: { name: string; value: string }[] };
export type ClassKind = 'space' | 'radius' | 'size' | 'color';
export type StyleClass = { prefix: string; value: string; label: string; kind: ClassKind };

/** Tailwind's spacing steps a designer picks from; each step is 4px. */
export const SPACE = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'];
export const RADIUS: Record<string, string> = { none: '0', xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px', '3xl': '24px', full: '9999px' };
export const TEXT: Record<string, string> = { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px', '2xl': '24px', '3xl': '30px', '4xl': '36px' };

const SPACE_PREFIX: Record<string, string> = {
  p: 'Padding', px: 'Padding x', py: 'Padding y', pt: 'Padding top', pr: 'Padding right', pb: 'Padding bottom', pl: 'Padding left',
  m: 'Margin', mx: 'Margin x', my: 'Margin y', mt: 'Margin top', mr: 'Margin right', mb: 'Margin bottom', ml: 'Margin left',
  gap: 'Gap', 'gap-x': 'Gap x', 'gap-y': 'Gap y',
};
const COLOR_PREFIX: Record<string, string> = { text: 'Text colour', bg: 'Background', border: 'Border colour' };

/** Reads one class, or null when it is not a plain scale or token class. */
export function readClass(cls: string, tokens: Tokens): StyleClass | null {
  if (cls.includes(':') || cls.includes('[')) return null;
  const m = /^(gap-[xy]|[pm][xytrbl]?|gap|rounded|text|bg|border)-(.+)$/.exec(cls);
  if (!m) return null;
  const [, prefix, value] = m;
  if (SPACE_PREFIX[prefix]) return /^\d+(\.5)?$/.test(value) ? { prefix, value, label: SPACE_PREFIX[prefix], kind: 'space' } : null;
  if (prefix === 'rounded') return value in RADIUS || tokens.radius.some((t) => t.name === value) ? { prefix, value, label: 'Radius', kind: 'radius' } : null;
  if (prefix === 'text' && (value in TEXT || tokens.text.some((t) => t.name === value))) return { prefix, value, label: 'Text size', kind: 'size' };
  if (COLOR_PREFIX[prefix] && tokens.colors.some((t) => t.name === value)) return { prefix, value, label: COLOR_PREFIX[prefix], kind: 'color' };
  return null;
}

export function styleClasses(className: string, tokens: Tokens): StyleClass[] {
  return className.split(/\s+/).filter(Boolean).flatMap((c) => readClass(c, tokens) ?? []);
}

/**
 * className with the class for this prefix and kind set to value (null removes it). Only the first matching plain
 * class changes; spacing and order of the rest stay as written. `text` sizes and colours are told apart by kind.
 */
export function setClass(className: string, prefix: string, kind: ClassKind, value: string | null, tokens: Tokens): string {
  const parts = className.split(/(\s+)/);
  const i = parts.findIndex((p) => { const r = readClass(p, tokens); return r?.prefix === prefix && r.kind === kind; });
  if (i < 0) return value === null ? className : `${className.trimEnd()}${className.trim() ? ' ' : ''}${prefix}-${value}`;
  if (value !== null) { parts[i] = `${prefix}-${value}`; return parts.join(''); }
  // Removing: take the class out with the space before it (or after it, when it is first).
  if (i > 0) parts.splice(i - 1, 2); else parts.splice(0, 2);
  return parts.join('');
}

/** Pixel size of a scale step or token, for menu labels. */
export function pixels(c: Pick<StyleClass, 'kind'>, value: string, tokens: Tokens): string {
  if (c.kind === 'space') return `${Number(value) * 4}px`;
  if (c.kind === 'radius') return RADIUS[value] ?? tokens.radius.find((t) => t.name === value)?.value ?? '';
  if (c.kind === 'size') return TEXT[value] ?? tokens.text.find((t) => t.name === value)?.value ?? '';
  return tokens.colors.find((t) => t.name === value)?.value ?? '';
}

/** The tokens a theme file defines: `--color-x`, `--text-x` (not line heights), `--radius-x`. */
export function readTokens(css: string): Tokens {
  const out: Tokens = { colors: [], text: [], radius: [] };
  for (const m of css.matchAll(/--(color|text|radius)-([\w-]+)\s*:\s*([^;]+);/g)) {
    const [, group, name, value] = m;
    if (group === 'text' && name.includes('--')) continue;
    out[group === 'color' ? 'colors' : group === 'text' ? 'text' : 'radius'].push({ name, value: value.trim() });
  }
  return out;
}

/**
 * className with every plain class that `match` accepts taken out and `next` put where the first one was (or at the
 * end when there was none). null only takes them out.
 */
export function replaceClass(className: string, match: (cls: string) => boolean, next: string | null): string {
  let put = false;
  const out = className.split(/\s+/).filter(Boolean).flatMap((c) => {
    if (c.includes(':') || !match(c)) return [c];
    if (put || next === null) return [];
    put = true;
    return [next];
  });
  if (!put && next !== null) out.push(next);
  return out.join(' ');
}

/** Classes of which an element has one at most, shown as menus or segments. '' is "none of them". */
export const KEYWORDS = {
  align: { label: 'Align', options: { '': 'Default', 'items-start': 'Start', 'items-center': 'Centre', 'items-end': 'End', 'items-stretch': 'Stretch', 'items-baseline': 'Baseline' } },
  justify: { label: 'Justify', options: { '': 'Default', 'justify-start': 'Start', 'justify-center': 'Centre', 'justify-end': 'End', 'justify-between': 'Space between' } },
  wrap: { label: 'Wrap', options: { '': 'No wrap', 'flex-wrap': 'Wrap' } },
  weight: { label: 'Weight', options: { '': 'Inherit', 'font-normal': 'Regular', 'font-medium': 'Medium', 'font-semibold': 'Semibold', 'font-bold': 'Bold' } },
  textAlign: { label: 'Align', options: { '': 'Inherit', 'text-left': 'Left', 'text-center': 'Centre', 'text-right': 'Right' } },
  truncate: { label: 'Overflow', options: { '': 'Wrap', truncate: 'Truncate' } },
  border: { label: 'Border', options: { '': 'None', border: '1px', 'border-2': '2px' } },
  shadow: { label: 'Shadow', options: { '': 'None', 'shadow-xs': 'XS', 'shadow-sm': 'Small', shadow: 'Default', 'shadow-md': 'Medium', 'shadow-lg': 'Large' } },
} as const;
export type KeywordGroup = keyof typeof KEYWORDS;

const inGroup = (g: KeywordGroup) => (c: string) => c !== '' && c in KEYWORDS[g].options;
export const keyword = (className: string, g: KeywordGroup): string => className.split(/\s+/).find((c) => !c.includes(':') && inGroup(g)(c)) ?? '';
export const setKeyword = (className: string, g: KeywordGroup, value: string): string => replaceClass(className, inGroup(g), value || null);

/** How an element lays out its children, as the Block / Row / Column / Grid segments. */
export type Layout = 'block' | 'row' | 'column' | 'grid';
const DISPLAY = new Set(['block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block']);
const DIRECTION = new Set(['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse']);
export function layoutOf(className: string): Layout {
  const cs = className.split(/\s+/).filter((c) => !c.includes(':'));
  if (cs.some((c) => c === 'grid' || c === 'inline-grid')) return 'grid';
  if (cs.some((c) => c === 'flex' || c === 'inline-flex')) return cs.some((c) => c.startsWith('flex-col')) ? 'column' : 'row';
  return 'block';
}
export function setLayout(className: string, to: Layout): string {
  const display = to === 'block' ? null : to === 'grid' ? 'grid' : 'flex';
  const out = replaceClass(className, (c) => DISPLAY.has(c), display);
  return replaceClass(out, (c) => DIRECTION.has(c), to === 'column' ? 'flex-col' : null);
}

/** Width or height like Figma's resizing: Auto (no class), Fill (w-full), Hug (w-fit) or Fixed pixels. */
export type Dim = { mode: 'auto' | 'fill' | 'hug' | 'fixed'; px?: number };
const dimMatch = (axis: 'w' | 'h') => (c: string) => new RegExp(`^${axis}-(full|fit|auto|screen|\\d+(\\.5)?|\\[\\d+px\\])$`).test(c);
export function dimOf(className: string, axis: 'w' | 'h'): Dim {
  const c = className.split(/\s+/).find((x) => !x.includes(':') && dimMatch(axis)(x));
  const v = c?.slice(2);
  if (!v || v === 'auto') return { mode: 'auto' };
  if (v === 'full' || v === 'screen') return { mode: 'fill' };
  if (v === 'fit') return { mode: 'hug' };
  return { mode: 'fixed', px: v.startsWith('[') ? Number(v.slice(1, -3)) : Number(v) * 4 };
}
/** A fixed size on the 4px scale is written as a scale step (w-28), anything else in pixels (w-[113px]). */
export function setDim(className: string, axis: 'w' | 'h', d: Dim): string {
  const px = Math.max(0, Math.round(d.px ?? 0));
  const next = d.mode === 'auto' ? null : d.mode === 'fill' ? `${axis}-full` : d.mode === 'hug' ? `${axis}-fit` : px % 4 === 0 ? `${axis}-${px / 4}` : `${axis}-[${px}px]`;
  return replaceClass(className, dimMatch(axis), next);
}
