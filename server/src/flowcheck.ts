import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { FLOW_RULES, type FlowCheckRun, type FlowFinding, type FlowRef, type FlowResult, type FlowRule } from '../../shared/flowcheck.js';
import { CONTROL } from './check.js';
import { figmaGet, nodes, SAMPLE_KEY } from './figma.js';

export const FLOWCHECK_FILE = 'flowcheck.json';
const MAX_PER_FLOW = 100;

// Prototype links come in three shapes. All three are read into one form here.
// 1. REST API (GET /v1/files/:key and /v1/files/:key/nodes): `interactions: Interaction[]` on TransitionSourceTrait
//    (frames, groups, components, instances, shapes). Interaction = { trigger: Trigger | null, actions?: Action[] },
//    Trigger = { type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' | 'MOUSE_ENTER' | ... },
//    NodeAction = { type: 'NODE', destinationId: string | null, navigation: 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SCROLL_TO' | 'CHANGE_TO' }.
//    Source: github.com/figma/rest-api-spec dist/api_types.ts and developers.figma.com/docs/rest-api/file-node-types.
//    The REST `Reaction` type is a comment emoji, not prototype data.
// 2. Plugin API (what use_figma and the Figma MCP return): `reactions: [{ trigger, actions }]`, or the older
//    `reactions: [{ trigger, action }]` with one action.
// 3. Legacy REST `transitionNodeID` on frames: one click that navigates to that node.

export type Act = { type: string; destinationId: string | null; navigation: string | null };
export type Reaction = { kind: 'click' | 'hover' | 'other'; actions: Act[] };

const CLICK = new Set(['ON_CLICK', 'ON_PRESS', 'MOUSE_DOWN', 'MOUSE_UP']);
const HOVER = new Set(['ON_HOVER', 'MOUSE_ENTER']);

function flat(actions: any[]): Act[] {
  return actions.flatMap((a): Act[] => {
    if (!a || typeof a !== 'object') return [];
    if (a.type === 'CONDITIONAL') return flat((a.conditionalBlocks ?? []).flatMap((b: any) => b?.actions ?? []));
    return [{ type: String(a.type ?? ''), destinationId: a.destinationId ?? null, navigation: a.navigation ?? null }];
  });
}

export function reactionsOf(node: any): Reaction[] {
  const out: Reaction[] = [];
  const add = (trigger: any, actions: any[]) => {
    if (!trigger?.type) return;
    const t = String(trigger.type);
    out.push({ kind: CLICK.has(t) ? 'click' : HOVER.has(t) ? 'hover' : 'other', actions: flat(actions) });
  };
  for (const i of node?.interactions ?? []) add(i?.trigger, i?.actions ?? []);
  for (const r of node?.reactions ?? []) add(r?.trigger, r?.actions ?? (r?.action ? [r.action] : []));
  if (node?.transitionNodeID) out.push({ kind: 'click', actions: [{ type: 'NODE', destinationId: node.transitionNodeID, navigation: 'NAVIGATE' }] });
  return out;
}

// A trigger with no actions does nothing in the prototype, so it does not count.
const has = (node: any, kind: Reaction['kind']) => reactionsOf(node).some((r) => r.kind === kind && r.actions.length > 0);
export const hasClick = (node: any) => has(node, 'click');
export const hasHover = (node: any) => has(node, 'hover');

const STRONG = new RegExp(`${CONTROL.source}|\\bclose\\b`, 'i');
const SOFT = /\b(card|row|tile)\b/i;
const BUTTONISH = /\b(button|btn|cta|close)\b/i;
const ICON_BUTTON = /\bicon[- ]?button\b/i;
const CONTAINER = /\b(group|bar|tabs|list|toolbar)\b/i;
const STATE_SKIP = /\b(hover|hovered|disabled|selected|pressed)\b/i;
const DIALOG = /\b(dialog|modal|drawer|sheet|popover)\b/i;
const DIALOG_PART = /\b(header|footer|body|content|overlay|backdrop|scrim|title|actions)\b/i;
const CLOSE = /\b(close|dismiss)\b|(^|[\s/_-])x$/i;
const DECISION = /^\s*decision\s*(\d+)\s*[·•:|-]\s*(.*)$/i;
const NOT_SCREEN = /^\s*(decision|note|notes|flow note|section note|changelog|review|readme|legend|title|label|sticky|arrow)\b/i;
const LINKS = new Set(['NAVIGATE', 'OVERLAY', 'SWAP']);
const CANVAS = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

type Maps = { components?: Record<string, any>; componentSets?: Record<string, any> };
type Box = { x: number; y: number; width: number; height: number };
type ScreenInfo = { id: string; name: string; flow: FlowRef };

const visible = (n: any) => n && n.visible !== false;
const kids = (n: any): any[] => (n?.children ?? []).filter(visible);

function label(node: any, maps: Maps) {
  const comp = maps.components?.[node.componentId];
  const set = comp?.componentSetId ? maps.componentSets?.[comp.componentSetId] : null;
  return [node.name, set?.name, comp?.name].filter(Boolean).join(' ');
}

function variantText(node: any, maps: Maps) {
  const props = Object.values(node.componentProperties ?? {}).filter((p: any) => p?.type === 'VARIANT').map((p: any) => String(p.value));
  return [node.name, maps.components?.[node.componentId]?.name, ...props].filter(Boolean).join(' ');
}

const some = (node: any, test: (n: any) => boolean): boolean => kids(node).some((c) => test(c) || some(c, test));
const textIn = (node: any) => some(node, (n) => n.type === 'TEXT' && String(n.characters ?? '').trim() !== '');
function firstText(node: any): string {
  for (const c of kids(node)) {
    if (c.type === 'TEXT' && String(c.characters ?? '').trim()) return String(c.characters).trim().slice(0, 40);
    const t = firstText(c);
    if (t) return t;
  }
  return '';
}

export function isScreen(n: any) {
  if (!visible(n) || !CANVAS.has(n.type) || NOT_SCREEN.test(n.name ?? '')) return false;
  const b = n.absoluteBoundingBox;
  return !b || (b.width >= 240 && b.height >= 240);
}

const quote = (s: string) => `"${s}"`;
// Names a node by its layer name and its label, like: Button "Manage".
function describe(n: any) {
  const name = String(n.name ?? n.id);
  const t = firstText(n);
  return t && t !== name ? `${name} ${quote(t)}` : quote(name);
}

type Control = { node: any; key: string; wired: boolean; hover: boolean; iconOnly: boolean; buttonish: boolean };

function collectControls(node: any, maps: Maps, clickAbove: boolean, out: Control[]) {
  for (const c of kids(node)) {
    if (!CANVAS.has(c.type) || STATE_SKIP.test(variantText(c, maps))) {
      if (c.type !== 'COMPONENT_SET') collectControls(c, maps, clickAbove || hasClick(c), out);
      continue;
    }
    const inst = c.type === 'INSTANCE';
    const lab = inst ? label(c, maps) : String(c.name ?? '');
    const strong = STRONG.test(lab) && !CONTAINER.test(c.name ?? '');
    const click = hasClick(c);
    const key = `${inst ? c.componentId : c.name}|${firstText(c)}`;
    if (strong) {
      const buttonish = inst && (BUTTONISH.test(lab) || ICON_BUTTON.test(lab));
      out.push({ node: c, key, wired: click || clickAbove, hover: hasHover(c), iconOnly: ICON_BUTTON.test(lab) || !textIn(c), buttonish });
      continue;
    }
    if (inst && SOFT.test(lab) && !clickAbove) {
      // Rows of one table are often different variants of one set, so the set is the group.
      const wired = click || some(c, hasClick);
      out.push({ node: c, key: String(maps.components?.[c.componentId]?.componentSetId ?? c.componentId), wired, hover: true, iconOnly: false, buttonish: false });
      if (!wired) continue;
    }
    collectControls(c, maps, clickAbove || click, out);
  }
}

// Same component and same label on one screen counts as one control: one wired example is enough (prototype depth rule).
function controlFindings(screen: any, maps: Maps, add: (node: any, rule: FlowRule, message: string, fix: string) => void) {
  const all: Control[] = [];
  collectControls(screen, maps, hasClick(screen), all);
  const groups = new Map<string, Control[]>();
  for (const c of all) groups.set(c.key, [...(groups.get(c.key) ?? []), c]);
  const more = (n: number) => (n > 1 ? ` (and ${n - 1} more like it)` : '');
  for (const list of groups.values()) {
    const name = describe(list[0].node);
    if (!list.some((c) => c.wired)) add(list[0].node, 'no-click', `${name} looks clickable but has no click${more(list.length)}.`, 'Add an On click action to the screen or state it opens, or make it look static.');
    const noHover = list.filter((c) => c.buttonish && !c.hover);
    const icon = noHover.filter((c) => c.iconOnly);
    const plain = noHover.filter((c) => !c.iconOnly);
    if (icon.length) add(icon[0].node, 'no-tooltip', `${describe(icon[0].node)} is an icon-only button with no hover, so no tooltip shows${more(icon.length)}.`, 'Add While hovering: open the tooltip overlay that names the action, and keep the click.');
    if (plain.length) add(plain[0].node, 'no-hover', `${describe(plain[0].node)} has no hover state${more(plain.length)}.`, 'Add While hovering: change to the Hover variant with the same type and size.');
  }
}

function dialogFindings(node: any, maps: Maps, add: (node: any, rule: FlowRule, message: string, fix: string) => void) {
  const isDialog = (n: any) => CANVAS.has(n.type) && DIALOG.test(label(n, maps)) && !DIALOG_PART.test(n.name ?? '');
  const isClose = (c: any) => CLOSE.test(String(c.name ?? '')) || CLOSE.test(label(c, maps));
  const deepest = (n: any): any => {
    for (const c of kids(n)) {
      const d = deepest(c);
      if (d) return d;
      if (isDialog(c)) return c;
    }
    return null;
  };
  // The outermost dialog decides: a close anywhere inside it passes, so parts like "Dialog buttons" are not checked alone.
  const visit = (n: any) => {
    if (isDialog(n)) {
      if (!some(n, isClose)) {
        const target = n === node ? (deepest(n) ?? n) : n;
        add(target, 'no-close', `${describe(target)} has no close icon.`, 'Add an icon-only Close button, top right, with a Close tooltip and a click back to the screen that opened it.');
      }
      return;
    }
    for (const c of kids(n)) if (c.type !== 'COMPONENT_SET') visit(c);
  };
  visit(node);
}

function linkFindings(node: any, flow: FlowRef, screens: Map<string, ScreenInfo>, add: (node: any, rule: FlowRule, message: string, fix: string, suffix?: string) => void) {
  const visit = (n: any) => {
    for (const r of reactionsOf(n)) {
      for (const a of r.actions) {
        if (a.type !== 'NODE' || !a.destinationId || !LINKS.has(a.navigation ?? '')) continue;
        const dest = screens.get(a.destinationId);
        if (!dest || dest.flow.id === flow.id) continue;
        add(n, 'stale-link', `${describe(n)} opens ${quote(dest.name)} in ${quote(dest.flow.name)}, outside this flow.`, `Point it to the matching screen in ${quote(flow.name)}.`, a.destinationId);
      }
    }
    for (const c of kids(n)) visit(c);
  };
  visit(node);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function stickyMatch(decision: string, screen: string) {
  const truncated = /(…|\.{3})\s*$/.test(decision);
  const d = norm(decision.replace(/(…|\.{3})\s*$/, ''));
  const s = norm(screen);
  if (!d) return false;
  return d === s || ((truncated || d.length < s.length) && s.startsWith(d));
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

type Flow = { ref: FlowRef; path: string[]; page: string; node: any; screens: any[]; leaf: boolean };
type Item = { id: string; name: string; box: Box; section: boolean; ancestors: string[]; flow: FlowRef; parent: string | null };

export function checkFlows(document: any, maps: Maps = {}): { flows: FlowResult[]; unchecked: FlowRule[] } {
  const flows: Flow[] = [];
  const screens = new Map<string, ScreenInfo>();
  const pageItems: Item[][] = [];
  let decisions = false;
  const scanDecisions = (n: any) => {
    if (decisions) return;
    if (DECISION.test(String(n.name ?? ''))) decisions = true;
    else for (const c of n.children ?? []) scanDecisions(c);
  };
  scanDecisions(document);

  for (const page of kids(document)) {
    const items: Item[] = [];
    const tops = kids(page);
    if (!tops.some((c) => c.type === 'SECTION')) continue;
    const walkSection = (s: any, path: string[], ancestors: string[]) => {
      const ref = { id: s.id, name: String(s.name ?? s.id) };
      const own = kids(s).filter(isScreen);
      const subs = kids(s).filter((c) => c.type === 'SECTION');
      flows.push({ ref, path, page: page.name, node: s, screens: own, leaf: !subs.length });
      if (s.absoluteBoundingBox) items.push({ id: s.id, name: ref.name, box: s.absoluteBoundingBox, section: true, ancestors, flow: ref, parent: ancestors[ancestors.length - 1] ?? null });
      for (const sc of own) {
        screens.set(sc.id, { id: sc.id, name: String(sc.name ?? sc.id), flow: ref });
        if (sc.absoluteBoundingBox) items.push({ id: sc.id, name: String(sc.name ?? sc.id), box: sc.absoluteBoundingBox, section: false, ancestors: [...ancestors, s.id], flow: ref, parent: s.id });
      }
      for (const sub of subs) walkSection(sub, [...path, ref.name], [...ancestors, s.id]);
    };
    for (const t of tops) if (t.type === 'SECTION') walkSection(t, [], []);
    const loose = tops.filter((t) => t.type !== 'SECTION' && isScreen(t));
    if (loose.length) {
      const ref = { id: page.id, name: `Not in a section (${page.name})` };
      flows.push({ ref, path: [], page: page.name, node: { ...page, children: loose }, screens: loose, leaf: true });
      for (const sc of loose) {
        screens.set(sc.id, { id: sc.id, name: String(sc.name ?? sc.id), flow: ref });
        if (sc.absoluteBoundingBox) items.push({ id: sc.id, name: String(sc.name ?? sc.id), box: sc.absoluteBoundingBox, section: false, ancestors: [], flow: ref, parent: null });
      }
    }
    pageItems.push(items);
  }

  const found = new Map<string, FlowFinding[]>();
  const push = (f: FlowFinding) => found.set(f.flow.id, [...(found.get(f.flow.id) ?? []), f]);
  const adder = (flow: FlowRef, screen: FlowRef | null) => (node: any, rule: FlowRule, message: string, fix: string, suffix?: string) =>
    push({ id: `flow:${rule}:${node.id}${suffix ? `:${suffix}` : ''}`, flow, screen, nodeId: node.id, nodeName: String(node.name ?? node.id), rule, message, fix, severity: rule === 'no-click' || rule === 'no-close' || rule === 'stale-link' ? 'major' : 'minor' });

  for (const f of flows) {
    const decisionNames: string[] = [];
    const collect = (n: any) => {
      for (const c of n.children ?? []) {
        if (c.type === 'SECTION' || f.screens.includes(c)) continue;
        if (DECISION.test(String(c.name ?? ''))) decisionNames.push(String(c.name));
        else collect(c);
      }
    };
    collect(f.node);
    for (const sc of f.screens) {
      const screen = { id: sc.id, name: String(sc.name ?? sc.id) };
      const add = adder(f.ref, screen);
      controlFindings(sc, maps, add);
      dialogFindings(sc, maps, add);
      linkFindings(sc, f.ref, screens, add);
      if (decisions) {
        const have = new Set(decisionNames.map((d) => DECISION.exec(d)!).filter((m) => stickyMatch(m[2], screen.name)).map((m) => m[1]));
        const missing = ['1', '2'].filter((n) => !have.has(n));
        if (missing.length) add(sc, 'no-stickies', `${quote(screen.name)} is missing ${missing.map((n) => `Decision ${n}`).join(' and ')}.`, `Add ${missing.map((n) => `"Decision ${n} · ${screen.name}"`).join(' and ')} under the screen: one bold decision line and one Why line.`);
      }
    }
  }

  for (const items of pageItems) {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const own = a.parent ? byId.get(a.parent) : undefined;
      if (own && !contains(own.box, a.box)) adder(a.flow, a.section ? null : { id: a.id, name: a.name })({ id: a.id, name: a.name }, 'overlap', `${quote(a.name)} sits partly outside its section ${quote(own.name)}.`, `Grow ${quote(own.name)} so it holds ${quote(a.name)} with room to spare, then restack the sections below.`, 'outside');
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.ancestors.includes(b.id) || b.ancestors.includes(a.id) || !intersects(a.box, b.box)) continue;
        // A screen over another section only counts when its own section does not already overlap that section.
        const scr = !a.section && b.section ? a : !b.section && a.section ? b : null;
        const sec = scr === a ? b : scr === b ? a : null;
        if (scr && sec) {
          const mine = scr.parent ? byId.get(scr.parent) : undefined;
          if (mine && intersects(mine.box, sec.box)) continue;
        }
        const first = a.section && !b.section ? b : a;
        const other = first === a ? b : a;
        adder(first.flow, first.section ? null : { id: first.id, name: first.name })({ id: first.id, name: first.name }, 'overlap', `${quote(first.name)} overlaps ${quote(other.name)} on the canvas.`, `Move ${quote(first.name)} or ${quote(other.name)} so they do not touch, and grow the section if it needs room.`, other.id);
      }
    }
  }

  const results: FlowResult[] = [];
  for (const f of flows) {
    const list = found.get(f.ref.id) ?? [];
    if (!f.screens.length && !list.length && !f.leaf) continue;
    const counts: Partial<Record<FlowRule, number>> = {};
    for (const x of list) counts[x.rule] = (counts[x.rule] ?? 0) + 1;
    const state = list.length ? 'fail' : f.screens.length ? 'pass' : 'unchecked';
    const order = (x: FlowFinding) => f.screens.findIndex((s) => s.id === x.screen?.id);
    const sorted = [...list].sort((x, y) => order(x) - order(y) || FLOW_RULES.indexOf(x.rule) - FLOW_RULES.indexOf(y.rule));
    results.push({ id: f.ref.id, name: f.ref.name, path: f.path, page: f.page, screens: f.screens.length, state, counts, unchecked: decisions ? [] : ['no-stickies'], findings: sorted.slice(0, MAX_PER_FLOW), more: Math.max(0, sorted.length - MAX_PER_FLOW) });
  }
  return { flows: results, unchecked: decisions ? [] : ['no-stickies'] };
}

export const readFlowChecks = (dir: string) => readFile(path.join(dir, FLOWCHECK_FILE), 'utf8').then((t) => JSON.parse(t).runs as FlowCheckRun[]).catch(() => [] as FlowCheckRun[]);

const CHUNK = 8;

// Reads pages and their top-level nodes first, then the full tree of each top-level section and frame in small batches,
// so one huge file request does not time out.
export async function loadDocument(fileKey: string) {
  const top = await figmaGet<any>(`/files/${fileKey}?depth=2`);
  const pages: any[] = top.document?.children ?? [];
  const ids = pages.filter((p) => (p.children ?? []).some((c: any) => c.type === 'SECTION')).flatMap((p) => (p.children ?? []).filter((c: any) => c.type === 'SECTION' || c.type === 'FRAME').map((c: any) => c.id as string));
  const full: Record<string, any> = {};
  const maps: Required<Maps> = { components: {}, componentSets: {} };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await nodes(fileKey, ids.slice(i, i + CHUNK));
    for (const [id, n] of Object.entries(r.nodes)) {
      if (!n) continue;
      full[id] = n.document;
      Object.assign(maps.components, n.components ?? {});
      Object.assign(maps.componentSets, n.componentSets ?? {});
    }
  }
  const document = { ...top.document, children: pages.map((p) => ({ ...p, children: (p.children ?? []).map((c: any) => full[c.id] ?? c) })) };
  return { document, maps };
}

export async function runFlowCheck(input: { dir: string; fileKey: string; load?: typeof loadDocument }): Promise<FlowCheckRun> {
  const { dir, fileKey } = input;
  const result = fileKey === SAMPLE_KEY ? { flows: [], unchecked: [] as FlowRule[] } : await (async () => {
    const { document, maps } = await (input.load ?? loadDocument)(fileKey);
    return checkFlows(document, maps);
  })();
  const run: FlowCheckRun = { id: randomUUID(), at: Date.now(), fileKey, flows: result.flows, unchecked: result.unchecked };
  const runs = await readFlowChecks(dir);
  await writeFile(path.join(dir, FLOWCHECK_FILE), JSON.stringify({ runs: [...runs, run].slice(-5) }, null, 2));
  return run;
}
