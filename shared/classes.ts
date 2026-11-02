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
