import type { Area, DesignSystem, Finding, Severity } from '../../shared/design.js';
import { CONTROL } from './controls.js';
import { screenFindings } from './flowRules.js';

export { CONTROL };

export const DEFAULT_SPACING = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];
const HAND_BUILT = /\b(button|btn|input|text ?field|checkbox|radio|toggle|switch|chip|avatar|badge)\b/i;
const MAX = 200;

type Rgba = { r: number; g: number; b: number; a: number };
/** Smallest click target, from WCAG 2.2 target size (2.5.8). */
export const MIN_TARGET = 24;
/** tokens false (a lo-fi profile): designs need not use variables, styles or library components. */
type Ctx = { components: Record<string, any>; spacing: Set<number>; radius: Set<number> | null; type: Set<number> | null; tokens: boolean; out: Finding[] };

const RULE_AREA: Record<string, Area> = {
  'color-unbound': 'system',
  'text-unstyled': 'system',
  'local-component': 'system',
  'hand-built': 'system',
  'text-too-small': 'accessibility',
  contrast: 'accessibility',
  'target-size': 'accessibility',
  'spacing-off-scale': 'visual',
  'radius-off-scale': 'visual',
  'no-auto-layout': 'visual',
  'type-off-scale': 'visual',
  'em-dash': 'writing',
  // Prototype rules shared with the Flow check (flowRules.ts).
  'no-click': 'interaction',
  'no-hover': 'interaction',
  'wrong-hover': 'interaction',
  'no-close': 'interaction',
  'no-tooltip': 'interaction',
  toast: 'visual',
};

export function ruleArea(rule: string): Area {
  return RULE_AREA[rule.split(':')[0]] ?? 'system';
}

function add(ctx: Ctx, node: any, rule: string, severity: Severity, text: string, fix: string) {
  if (ctx.out.length >= MAX) return;
  if (!ctx.tokens && ruleArea(rule) === 'system') return;
  ctx.out.push({ id: `check:${rule}:${node.id}`, area: ruleArea(rule), node: node.id, nodeName: node.name, severity, rule: text, fix });
}

const visible = (p: any) => p && p.visible !== false && (p.opacity ?? 1) > 0;
const solids = (paints: any[] | undefined) => (paints ?? []).filter((p) => visible(p) && p.type === 'SOLID');
const hex = (c: Rgba) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function luminance(c: Rgba) {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrast(fg: Rgba, bg: Rgba) {
  const a = fg.a;
  const mixed = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  const [l1, l2] = [luminance(mixed), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const paintColor = (p: any): Rgba => ({ r: p.color.r, g: p.color.g, b: p.color.b, a: (p.color.a ?? 1) * (p.opacity ?? 1) });

function bound(node: any, key: string) {
  return Boolean(node.boundVariables?.[key]) || Boolean(node.styles?.[key === 'fills' ? 'fill' : key === 'strokes' ? 'stroke' : key]);
}

function walk(node: any, ctx: Ctx, bg: Rgba, depth: number, inInstance: boolean) {
  if (!node || node.visible === false) return;
  const fills = solids(node.fills);
  const box = node.absoluteBoundingBox;

  if (!inInstance && node.type !== 'TEXT') {
    if (fills.length && !bound(node, 'fills')) add(ctx, node, 'color-unbound', 'major', `Fill ${hex(paintColor(fills[0]))} is not bound to a color variable or style`, 'Bind the fill to the matching color variable from the library');
    if (solids(node.strokes).length && !bound(node, 'strokes')) add(ctx, node, 'color-unbound', 'minor', `Stroke ${hex(paintColor(solids(node.strokes)[0]))} is not bound to a color variable`, 'Bind the stroke to a border color variable');
  }

  if (node.type === 'TEXT') {
    const size = node.style?.fontSize ?? 0;
    const bold = (node.style?.fontWeight ?? 400) >= 700;
    if (!inInstance && !node.styles?.text && !node.boundVariables?.fontSize && !node.boundVariables?.fontFamily) add(ctx, node, 'text-unstyled', 'major', `Text "${String(node.characters ?? '').slice(0, 40)}" has no text style (${size}px)`, 'Apply a library text style');
    if (size && size < 12) add(ctx, node, 'text-too-small', 'major', `Text is ${size}px, below the 12px minimum`, 'Use a text style of at least 12px');
    else if (size && ctx.type && !inInstance && !ctx.type.has(size)) add(ctx, node, 'type-off-scale', 'minor', `Text is ${size}px, off the type scale (${[...ctx.type].sort((a, b) => a - b).join('/')})`, 'Use a size from the type scale');
    if (String(node.characters ?? '').includes('\u2014')) add(ctx, node, 'em-dash', 'minor', `Text "${String(node.characters).slice(0, 40)}" uses an em dash`, 'Use a comma, colon, period or parentheses');
    if (fills.length && !inInstance) {
      const ratio = contrast(paintColor(fills[0]), bg);
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio < need) add(ctx, node, 'contrast', 'blocking', `Contrast ${ratio.toFixed(2)}:1 on ${hex(bg)}, needs ${need}:1`, 'Use a text or background color with enough contrast');
    }
  }

  if (box && depth > 0 && (CONTROL.test(node.name ?? '') || (node.reactions?.length ?? 0) > 0) && ['INSTANCE', 'FRAME', 'COMPONENT'].includes(node.type)) {
    if (box.width < MIN_TARGET || box.height < MIN_TARGET) add(ctx, node, 'target-size', 'major', `Click target ${Math.round(box.width)}x${Math.round(box.height)}px is under ${MIN_TARGET}px`, `Make the target at least ${MIN_TARGET}x${MIN_TARGET}px (32px in dense UI, 44px on touch), padding counts`);
  }

  if (node.type === 'INSTANCE' && !inInstance) {
    const comp = ctx.components[node.componentId];
    if (comp && comp.remote === false) add(ctx, node, 'local-component', 'minor', `"${comp.name}" is a local component, not from a library`, 'Swap it for the library component');
  }
  if (!inInstance && depth > 0 && ['FRAME', 'GROUP'].includes(node.type) && HAND_BUILT.test(node.name ?? '')) add(ctx, node, 'hand-built', 'major', `"${node.name}" looks like a ${HAND_BUILT.exec(node.name)![1]} built by hand`, 'Use the library component instead');

  if (!inInstance && ['FRAME', 'COMPONENT'].includes(node.type)) {
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      const off = (['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const)
        .filter((k) => typeof node[k] === 'number' && !node.boundVariables?.[k] && !ctx.spacing.has(Math.round(node[k])))
        .map((k) => `${k} ${node[k]}`);
      if (off.length) add(ctx, node, 'spacing-off-scale', 'minor', `Spacing off the scale: ${off.join(', ')}`, 'Use spacing variables or values from the spacing scale');
    } else if (depth > 0 && (node.children?.length ?? 0) >= 3) add(ctx, node, 'no-auto-layout', 'minor', `Frame with ${node.children.length} children has no auto layout`, 'Use auto layout so spacing follows the scale');
    if (ctx.radius && typeof node.cornerRadius === 'number' && node.cornerRadius > 0 && !node.boundVariables?.topLeftRadius && !ctx.radius.has(node.cornerRadius)) add(ctx, node, 'radius-off-scale', 'minor', `Corner radius ${node.cornerRadius} is off the scale`, 'Use a radius variable');
  }

  const nextBg = fills.length && paintColor(fills[0]).a >= 0.99 ? paintColor(fills[0]) : bg;
  for (const child of node.children ?? []) walk(child, ctx, nextBg, depth + 1, inInstance || node.type === 'INSTANCE');
}

const CLICK = new Set(['ON_CLICK', 'ON_PRESS', 'MOUSE_DOWN', 'MOUSE_UP']);

/** True when a node or anything in it has a click that leaves the component: a screen, an overlay, Back or Close. */
export function linksOut(node: any): boolean {
  if (!node || node.visible === false) return false;
  for (const r of node.reactions ?? []) {
    if (!CLICK.has(r?.trigger?.type)) continue;
    for (const a of r.actions ?? (r.action ? [r.action] : [])) if (a && (a.type !== 'NODE' || a.navigation !== 'CHANGE_TO')) return true;
  }
  return (node.children ?? []).some(linksOut);
}

/** The profile's text sizes, when it has at least three, so a file with one odd style does not flag everything. */
export function typeScale(ds: DesignSystem | null): Set<number> | null {
  const sizes = new Set((ds?.text ?? []).map((t) => Number(t.size)).filter((n) => n > 0));
  return sizes.size >= 3 ? sizes : null;
}

export function checkFrames(frames: Array<{ document: any; components?: Record<string, any> }>, ds: DesignSystem | null): Finding[] {
  const ctx: Ctx = {
    components: Object.assign({}, ...frames.map((f) => f.components ?? {})),
    spacing: new Set(ds?.spacing?.length ? ds.spacing : DEFAULT_SPACING),
    radius: ds?.radius?.length ? new Set(ds.radius) : null,
    type: typeScale(ds),
    tokens: ds?.tokens !== false,
    out: [],
  };
  const componentSets: Record<string, { name: string }> = {};
  for (const c of Object.values(ctx.components)) if (c?.componentSetId && c.setName) componentSets[c.componentSetId] = { name: c.setName };
  // Frames with no click-through link are not a prototype yet, so the prototype rules wait. Hovers alone do not
  // count: instances of interactive components carry their main component's hover everywhere.
  const prototyped = frames.some((f) => linksOut(f.document));
  for (const f of frames) {
    walk(f.document, ctx, { r: 1, g: 1, b: 1, a: 1 }, 0, false);
    if (!prototyped) continue;
    // Each reviewed frame is read as a screen: clicks, hovers, hover targets, close icons, tooltips and toasts.
    for (const x of screenFindings(f.document, { components: ctx.components, componentSets })) {
      if (ctx.out.length >= MAX) break;
      ctx.out.push({ id: `check:${x.id}`, area: ruleArea(x.rule), node: x.nodeId, nodeName: x.nodeName, severity: x.severity, rule: x.message, fix: x.fix });
    }
  }
  return ctx.out;
}

export function checkSummary(findings: Finding[]) {
  const by = new Map<string, number>();
  for (const f of findings) by.set(f.id.split(':')[1], (by.get(f.id.split(':')[1]) ?? 0) + 1);
  return [...by].map(([rule, n]) => `${n} ${rule}`).join(', ');
}
