import { FLOW_RULES, flowMatches, namedLike, type FlowFinding, type FlowRef, type FlowResult, type FlowRule } from '../../shared/flowcheck.js';
import { EMPTY_SCOPE, type Scope } from '../../shared/scope.js';
import { CONTROL } from './controls.js';

// The Flow check rules. This module has no Node imports on purpose: it is bundled into the Plugin API script that
// use_figma runs (see flowcheckPlugin.ts), so the check runs inside Figma and only the findings come back.

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
const CHIP = /\b(chip|suggestion)\b/i;
const BUTTONISH = /\b(button|btn|cta|close)\b/i;
const ICON_BUTTON = /\bicon[- ]?button\b/i;
const CONTAINER = /\b(group|bar|tabs|list|toolbar)\b/i;
const STATE_SKIP = /\b(hover|hovered|disabled|selected|pressed)\b/i;
const DIALOG = /\b(dialog|modal|drawer|sheet|popover)\b/i;
const DIALOG_PART = /\b(header|footer|body|content|overlay|backdrop|scrim|title|actions)\b/i;
const CLOSE = /\b(close|dismiss)\b|(^|[\s/_-])x$/i;
const DECISION = /^\s*decision\s*(\d+)\s*[·•:|-]\s*(.*)$/i;
const OPTION_SECTION = /·\s*option\s+[a-c]\s*:/i;
const NOT_SCREEN = /^\s*(decision|note|notes|flow note|section note|changelog|review|readme|legend|title|label|sticky|arrow)\b/i;
const LINKS = new Set(['NAVIGATE', 'OVERLAY', 'SWAP']);
const MAJOR = new Set<FlowRule>(['no-click', 'no-close', 'wrong-hover', 'stale-link', 'parked-link']);
const TOAST = /\btoast\b/i;
// Keys a hover may change besides a value that names Hover, like State=Default to State=Hover.
const STATE_KEY = /^\s*(state|interaction|hover|show tooltip|tooltip)\s*$/i;
const HOVER_WORD = /\b(hover|hovered)\b/i;
const NOTE_LIMIT = 230;
const NOTE_SKIP = /\b(change ?log|version history|readme)\b/i;
const BULLETS = /•|(^|\n)\s*([-*–]|\d+[.)])\s/;
const CANVAS = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

// A link destination the plugin walk did not reach, looked up on its own: name, type, size, the sections around it
// (outermost first) and its page.
export type Outside = { n: string; t: string; w: number; h: number; s: Array<[string, string]>; p: [string, string] | null };
type Maps = { components?: Record<string, any>; componentSets?: Record<string, any>; outside?: Record<string, Outside> };
type Box = { x: number; y: number; width: number; height: number };
type ScreenInfo = { id: string; name: string; flow: FlowRef; version: string };

const LATEST = /\blatest\b/i;
/**
 * Which version of the design a section belongs to, for the Old link rule. Her rule: links in the latest version
 * never open a screen from an old version. Sub-sections of one version (main path, supporting states, branches) are
 * one flow, so links between them are fine.
 * - Inside a Parked section: that Parked section, so a link into it is never fine.
 * - Inside a section named LATEST, at any depth: the latest version. Every LATEST section counts as one.
 * - Otherwise: its top-level section.
 */
export function versionOf(chain: FlowRef[], its: Iterations = {}): string {
  const parked = chain.find((s) => namedLike(s.name, 'parked'));
  if (parked) return `parked:${parked.id}`;
  // A tagged iteration (project.json and the map tags): every working one is the latest version, each frozen one
  // its own old version. Untagged files fall back to the LATEST name.
  const it = chain.map((s) => its[s.id]).find(Boolean);
  if (it) return it.state === 'working' ? 'latest' : `frozen:${it.id}`;
  if (chain.some((s) => LATEST.test(s.name))) return 'latest';
  return chain[0]?.id ?? '';
}

/** The iteration a section sits in, by the iteration sections around it. */
const iterationOf = (chain: FlowRef[], its: Iterations) => chain.map((s) => its[s.id]).find(Boolean)?.id;

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
    // Chips in a list are repeated items: one wired example covers the rest, whatever their labels.
    const set = inst ? maps.components?.[c.componentId]?.componentSetId ?? c.componentId : null;
    const key = inst && CHIP.test(lab) ? `chip|${set}` : `${inst ? c.componentId : c.name}|${firstText(c)}`;
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
  // A close inside a button, chip or other control is already checked by the No click rule, so it is not flagged twice.
  const closes = (dialog: any) => {
    const out: Array<{ node: any; wired: boolean; covered: boolean }> = [];
    const find = (x: any, wired: boolean, covered: boolean) => {
      for (const c of kids(x)) {
        const w = wired || hasClick(c);
        const cov = covered || (CANVAS.has(c.type) && STRONG.test(label(c, maps)) && !CONTAINER.test(c.name ?? ''));
        if (isClose(c)) out.push({ node: c, wired: w || some(c, hasClick), covered: cov });
        else find(c, w, cov);
      }
    };
    find(dialog, false, false);
    return out;
  };
  // The outermost dialog decides: a close anywhere inside it passes, so parts like "Dialog buttons" are not checked alone.
  const visit = (n: any) => {
    if (isDialog(n)) {
      const found = closes(n);
      if (!found.length) {
        const target = n === node ? (deepest(n) ?? n) : n;
        add(target, 'no-close', `${describe(target)} has no close icon.`, 'Add an icon-only Close button, top right, with a Close tooltip and a click back to the screen that opened it.');
      } else if (!found.some((c) => c.wired || c.covered)) {
        add(found[0].node, 'no-close', `The close icon in ${describe(n)} does nothing when clicked.`, 'Add On click: Close overlay (or Back) to the screen that opened it, and a Close tooltip on hover.');
      }
      return;
    }
    for (const c of kids(n)) if (c.type !== 'COMPONENT_SET') visit(c);
  };
  visit(node);
}

// "Type=Primary, State=Default" as key and value pairs, keyed by the lower-case key.
function variantPairs(name: string) {
  const out = new Map<string, { key: string; value: string }>();
  for (const part of String(name ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim().toLowerCase(), { key: part.slice(0, i).trim(), value: part.slice(i + 1).trim() });
  }
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const isDefault = (s: string) => !s || /^(default|rest|none|off|false|no)$/i.test(s.trim());

/** What a hover changes besides the state, as Key: own value and Key: hover value. Empty when the hover is right. */
export function hoverDrift(own: string, hover: string): Array<{ key: string; from: string; to: string }> {
  const a = variantPairs(own);
  const b = variantPairs(hover);
  if (!a.size || !b.size) return [];
  const out: Array<{ key: string; from: string; to: string }> = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(k)?.value ?? '';
    const to = b.get(k)?.value ?? '';
    if (plain(from) === plain(to)) continue;
    // Status=Partly ready to Status=Partly ready Hover is right. Status=Needs setup Hover is not.
    if (HOVER_WORD.test(to)) {
      const rest = plain(to.replace(HOVER_WORD, ' '));
      if (rest === plain(from) || (isDefault(rest) && isDefault(from))) continue;
    } else if (STATE_KEY.test(k)) continue;
    out.push({ key: a.get(k)?.key ?? b.get(k)!.key, from, to });
  }
  return out;
}

type Adder = (node: any, rule: FlowRule, message: string, fix: string, suffix?: string) => void;

// A hover that changes an instance to a variant with other properties than its own: another status, decider or icon.
function hoverFindings(screen: any, maps: Maps, add: Adder) {
  const groups = new Map<string, { node: any; dest: string; message: string; fix: string; n: number }>();
  const check = (c: any) => {
    const own = maps.components?.[c.componentId];
    if (!own) return;
    for (const r of reactionsOf(c)) {
      if (r.kind !== 'hover') continue;
      for (const a of r.actions) {
        if (a.navigation !== 'CHANGE_TO' || !a.destinationId || a.destinationId === c.componentId) continue;
        const to = maps.components?.[a.destinationId];
        if (!to) continue;
        const key = `${c.componentId}|${a.destinationId}`;
        const seen = groups.get(key);
        if (seen) { seen.n++; continue; }
        let message = '';
        let fix = '';
        if (own.componentSetId && to.componentSetId && own.componentSetId !== to.componentSetId) {
          message = `${describe(c)} changes on hover to ${quote(String(to.name))}, a variant of another component.`;
          fix = 'Point While hovering to the Hover variant in its own component set.';
        } else {
          const drift = hoverDrift(String(own.name ?? ''), String(to.name ?? ''));
          if (!drift.length) continue;
          message = `${describe(c)} changes on hover to ${drift.map((d) => `${d.key}=${d.to || 'none'}`).join(', ')}, but its own is ${drift.map((d) => `${d.key}=${d.from || 'none'}`).join(', ')}.`;
          fix = drift.some((d) => /\b(selected|disabled|active)\b/i.test(d.from))
            ? 'A selected or disabled item stays as it is on hover: remove the While hovering reaction.'
            : `Point While hovering to the Hover variant with ${drift.map((d) => `${d.key}=${d.from || 'none'}`).join(', ')} and the same other properties.`;
        }
        groups.set(key, { node: c, dest: a.destinationId, message, fix, n: 1 });
      }
    }
  };
  const visit = (n: any) => {
    for (const c of kids(n)) {
      if (c.type === 'INSTANCE') check(c);
      if (c.type !== 'COMPONENT_SET') visit(c);
    }
  };
  visit(screen);
  for (const g of groups.values()) add(g.node, 'wrong-hover', g.n > 1 ? g.message.replace(/\.$/, ` (and ${g.n - 1} more like it).`) : g.message, g.fix, g.dest);
}

// Toasts sit 24px from the top of the screen, centred, as the top layer. 1px of slack covers rounding.
const FLOATING = /\b(tooltip|popover|menu|dropdown)\b/i;

function toastFindings(screen: any, maps: Maps, add: Adder) {
  const s = screen.absoluteBoundingBox;
  if (!s) return;
  const toasts: any[] = [];
  const visit = (n: any) => {
    for (const c of kids(n)) {
      if (CANVAS.has(c.type) && c.absoluteBoundingBox && TOAST.test(label(c, maps))) toasts.push(c);
      else if (c.type !== 'COMPONENT_SET') visit(c);
    }
  };
  visit(screen);
  const top = kids(screen);
  for (const t of toasts) {
    const b = t.absoluteBoundingBox;
    const dy = b.y - s.y;
    const dx = b.x + b.width / 2 - (s.x + s.width / 2);
    const off: string[] = [];
    if (Math.abs(dy - 24) > 1) off.push(`${Math.round(dy)}px from the top of the screen`);
    if (Math.abs(dx) > 1) off.push(`${Math.round(Math.abs(dx))}px ${dx < 0 ? 'left' : 'right'} of centre`);
    // Tooltips and menus draw above everything by her own rule, and a layer that does not touch the toast hides nothing.
    const above = top.slice(top.indexOf(t) + 1).filter((c) => !FLOATING.test(label(c, maps)) && (!c.absoluteBoundingBox || intersects(c.absoluteBoundingBox, b)));
    if (top.includes(t) && above.length) off.push(`under ${describe(above[0])}`);
    if (off.length) add(t, 'toast', `${describe(t)} sits ${off.join(', ')}.`, 'Place the toast 24px from the top of the screen, centred, as the top layer.');
  }
}

/** The rules that read one screen on its own. The Code scan runs them on reviewed frames too. */
function screenRules(screen: any, maps: Maps, add: Adder) {
  controlFindings(screen, maps, add);
  dialogFindings(screen, maps, add);
  hoverFindings(screen, maps, add);
  toastFindings(screen, maps, add);
}

export type ScreenFinding = { id: string; rule: FlowRule; nodeId: string; nodeName: string; message: string; fix: string; severity: 'major' | 'minor' };

/** Per-screen prototype findings for one frame, for the Code scan. Ids are stable for triage. */
export function screenFindings(screen: any, maps: Maps): ScreenFinding[] {
  const out: ScreenFinding[] = [];
  screenRules(screen, maps, (node, rule, message, fix, suffix) => {
    const id = `${rule}:${node.id}${suffix ? `:${suffix}` : ''}`;
    if (!out.some((f) => f.id === id)) out.push({ id, rule, nodeId: node.id, nodeName: String(node.name ?? node.id), message, fix, severity: MAJOR.has(rule) ? 'major' : 'minor' });
  });
  return out;
}
// Where a link lands when it lands in a parked feature: the feature's name if known, else the Parked section's.
type ParkedTarget = { name: string; feature: boolean };
const PARKED_FIX = 'Remove the entry point, or restore the feature in Scope.';

function linkFindings(node: any, flow: FlowRef, version: string, screens: (id: string) => ScreenInfo | undefined, parkedAt: (id: string) => ParkedTarget | null, add: Adder, flagged: Set<string>) {
  const visit = (n: any) => {
    for (const r of reactionsOf(n)) {
      for (const a of r.actions) {
        if (a.type !== 'NODE' || !a.destinationId || !LINKS.has(a.navigation ?? '')) continue;
        // A link into a parked feature is reported once, as a parked link, not also as an old link.
        const parked = parkedAt(a.destinationId);
        if (parked) {
          const where = screens(a.destinationId)?.name;
          const target = where ? `${quote(where)}, ` : '';
          add(n, 'parked-link', parked.feature ? `${describe(n)} opens ${target}part of the parked feature ${quote(parked.name)}.` : `${describe(n)} opens ${target}in the parked section ${quote(parked.name)}.`, PARKED_FIX, a.destinationId);
          flagged.add(n.id);
          continue;
        }
        const dest = screens(a.destinationId);
        if (!dest || dest.flow.id === flow.id || dest.version === version) continue;
        add(n, 'stale-link', `${describe(n)} opens ${quote(dest.name)} in ${quote(dest.flow.name)}, which is an old version.`, `Point it to the matching screen in ${quote(flow.name)}.`, a.destinationId);
      }
    }
    for (const c of kids(n)) visit(c);
  };
  visit(node);
}

// Entry points left behind: a layer or text named like a parked feature, the screen itself included.
// A match stops the walk, so a button and its label count once. One finding per feature per screen.
function parkedNameFindings(screen: any, parked: string[], add: Adder, flagged: Set<string>) {
  for (const feature of parked) {
    const hits: any[] = [];
    // A label inside a button or chip reports the instance that holds it, which is the entry point to remove.
    const visit = (n: any, holder: any) => {
      if (flagged.has(n.id)) return;
      if (namedLike(String(n.name ?? ''), feature) || (n.type === 'TEXT' && namedLike(String(n.characters ?? ''), feature))) {
        const hit = n.type === 'TEXT' && holder ? holder : n;
        if (!hits.includes(hit)) hits.push(hit);
        return;
      }
      for (const c of kids(n)) visit(c, n.type === 'INSTANCE' ? n : holder);
    };
    visit(screen, null);
    if (!hits.length) continue;
    const more = hits.length > 1 ? ` (and ${hits.length - 1} more like it)` : '';
    const what = hits[0] === screen ? `${quote(String(screen.name ?? screen.id))} is a screen` : `${describe(hits[0])} is an entry point`;
    add(hits[0], 'parked-link', `${what} for the parked feature ${quote(feature)}${more}.`, PARKED_FIX);
  }
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

// parked: inside a section named Parked, so no rule runs on it. feature: the parked feature this section is named after.
type Flow = { ref: FlowRef; path: string[]; ancestors: string[]; page: string; node: any; screens: any[]; leaf: boolean; section: boolean; parked: boolean; feature: string | null; version: string; iteration?: string };
type Item = { id: string; name: string; box: Box; section: boolean; ancestors: string[]; flow: FlowRef; parent: string | null };

// Flow and section notes: text in a section outside its screens, Decision stickies and the changelog. A note over
// 230 characters with no bullets reads as a paragraph. The plugin walker sends the full length and a bullet flag,
// since it clips the text itself.
function noteFindings(f: Flow, add: Adder) {
  const visit = (n: any) => {
    for (const c of kids(n)) {
      if (c.type === 'SECTION' || f.screens.includes(c) || DECISION.test(String(c.name ?? '')) || NOTE_SKIP.test(String(c.name ?? ''))) continue;
      if (c.type === 'TEXT') {
        const text = String(c.characters ?? '');
        const length = typeof c.textLength === 'number' ? c.textLength : text.length;
        const bullets = typeof c.bullets === 'boolean' ? c.bullets : BULLETS.test(text);
        if (length > NOTE_LIMIT && !bullets) add(c, 'long-note', `The note ${quote(`${text.replace(/\s+/g, ' ').trim().slice(0, 40).trim()}…`)} is ${length} characters with no bullets.`, 'Cut it to at most 5 short bullets (•), one idea each, about 200 characters in all. Move the version trail to the changelog.');
        continue;
      }
      visit(c);
    }
  };
  visit(f.node);
}

export const isParkedSection = (name: string, path: string[]) => [...path, name].some((n) => namedLike(n, 'parked'));

/** True when the read stopped inside this section's own layers (sub-sections are flows of their own). */
const cutShort = (n: any): boolean => !!n.cut || kids(n).some((c) => c.type !== 'SECTION' && cutShort(c));

/**
 * Sticky rule for an adopted file: `working` lists the flow and states subsections of its working iterations. Only
 * screens in those need Decision stickies, 3 to 5 each; frozen iterations, the baseline and entry copies are history.
 * Without it (a file with no project.json) every screen needs Decision 1 and 2, once the file has any sticky.
 */
export type StickyRule = { working?: string[]; iterations?: Iterations };
/** Iteration section node id -> its id and state, for the Old link rule and the iteration scope of each flow. */
export type Iterations = Record<string, { id: string; state: 'working' | 'frozen' }>;

const ENTRY_COPY = /\(entry, unchanged\)/i;

export function checkFlows(document: any, maps: Maps = {}, scope: Scope = EMPTY_SCOPE, sticky: StickyRule = {}): { flows: FlowResult[]; unchecked: FlowRule[]; missing: string[] } {
  const working = sticky.working ? new Set(sticky.working) : null;
  const its = sticky.iterations ?? {};
  const flows: Flow[] = [];
  const screens = new Map<string, ScreenInfo>();
  // Every layer directly inside a section, screens or not, so links to small overlays are traced too.
  const owner = new Map<string, Flow>();
  const parkedNames = scope.parked.map((p) => p.name);
  const pageItems: Item[][] = [];
  const looseScreens: Array<{ flow: FlowRef; node: any }> = [];
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
    const walkSection = (s: any, path: string[], ancestors: string[], chain: FlowRef[]) => {
      const ref = { id: s.id, name: String(s.name ?? s.id) };
      const version = versionOf([...chain, ref], its);
      const own = kids(s).filter(isScreen);
      const subs = kids(s).filter((c) => c.type === 'SECTION');
      const full = [...path, ref.name].join(' / ');
      const flow: Flow = { ref, path, ancestors, page: page.name, node: s, screens: own, leaf: !subs.length, section: true, parked: isParkedSection(ref.name, path), feature: parkedNames.find((p) => namedLike(full, p)) ?? null, version, iteration: iterationOf([...chain, ref], its) };
      flows.push(flow);
      for (const c of kids(s)) if (c.type !== 'SECTION') owner.set(c.id, flow);
      if (s.absoluteBoundingBox) items.push({ id: s.id, name: ref.name, box: s.absoluteBoundingBox, section: true, ancestors, flow: ref, parent: ancestors[ancestors.length - 1] ?? null });
      for (const sc of own) {
        screens.set(sc.id, { id: sc.id, name: String(sc.name ?? sc.id), flow: ref, version });
        if (sc.absoluteBoundingBox) items.push({ id: sc.id, name: String(sc.name ?? sc.id), box: sc.absoluteBoundingBox, section: false, ancestors: [...ancestors, s.id], flow: ref, parent: s.id });
      }
      for (const sub of subs) walkSection(sub, [...path, ref.name], [...ancestors, s.id], [...chain, ref]);
    };
    for (const t of tops) if (t.type === 'SECTION') walkSection(t, [], [], []);
    const loose = tops.filter((t) => t.type !== 'SECTION' && isScreen(t));
    if (loose.length) {
      const ref = { id: page.id, name: `Not in a section (${page.name})` };
      flows.push({ ref, path: [], ancestors: [], page: page.name, node: { ...page, children: loose }, screens: loose, leaf: true, section: false, parked: false, feature: null, version: `loose:${page.id}` });
      // Only frames that are part of a prototype: a thumbnail, a style guide or a main component can sit on the canvas.
      for (const sc of loose) if (sc.type === 'FRAME') looseScreens.push({ flow: ref, node: sc });
      for (const sc of loose) {
        screens.set(sc.id, { id: sc.id, name: String(sc.name ?? sc.id), flow: ref, version: `loose:${page.id}` });
        if (sc.absoluteBoundingBox) items.push({ id: sc.id, name: String(sc.name ?? sc.id), box: sc.absoluteBoundingBox, section: false, ancestors: [], flow: ref, parent: null });
      }
    }
    pageItems.push(items);
  }

  const found = new Map<string, FlowFinding[]>();
  const push = (f: FlowFinding) => found.set(f.flow.id, [...(found.get(f.flow.id) ?? []), f]);
  const adder = (flow: FlowRef, screen: FlowRef | null) => (node: any, rule: FlowRule, message: string, fix: string, suffix?: string) =>
    push({ id: `flow:${rule}:${node.id}${suffix ? `:${suffix}` : ''}`, flow, screen, nodeId: node.id, nodeName: String(node.name ?? node.id), rule, message, fix, severity: MAJOR.has(rule) ? 'major' : 'minor' });

  // Destinations the walk did not reach, from the plugin's own lookups. As for walked layers, any layer counts for the
  // parked check and only screens for the Old link rule.
  const outside = new Map<string, { info: ScreenInfo; chain: FlowRef[]; screen: boolean }>();
  for (const [id, o] of Object.entries(maps.outside ?? {})) {
    if (screens.has(id) || owner.has(id)) continue;
    const chain = (o.s ?? []).map(([i, n]) => ({ id: i, name: n }));
    const page = o.p ? { id: o.p[0], name: o.p[1] } : { id: '', name: '' };
    const flow = chain[chain.length - 1] ?? { id: page.id, name: `Not in a section (${page.name})` };
    const shape = { type: o.t, name: o.n, absoluteBoundingBox: { x: 0, y: 0, width: o.w, height: o.h } };
    const far = { info: { id, name: String(o.n ?? id), flow, version: chain.length ? versionOf(chain, its) : `loose:${page.id}` }, chain, screen: isScreen(shape) };
    outside.set(id, far);
  }
  const screenAt = (id: string) => {
    const far = outside.get(id);
    return screens.get(id) ?? (far?.screen ? far.info : undefined);
  };

  const parkedAt = (id: string): ParkedTarget | null => {
    const f = owner.get(id);
    const far = f ? null : outside.get(id);
    const names = f ? [...f.path, f.ref.name] : far ? far.chain.map((c) => c.name) : [];
    const parked = f ? f.parked : names.some((n) => namedLike(n, 'parked'));
    const own = f ? f.feature : parkedNames.find((p) => namedLike(names.join(' / '), p)) ?? null;
    if (!names.length || !(parked || own)) return null;
    const name = String(screens.get(id)?.name ?? (far?.screen ? far.info.name : ''));
    const feature = own ?? parkedNames.find((p) => namedLike(name, p));
    return feature ? { name: feature, feature: true } : { name: names[names.length - 1], feature: false };
  };

  for (const f of flows) {
    // Parked sections are frozen references: nothing is checked inside them.
    if (f.parked) continue;
    // A section named after a parked feature is that feature's own flow, so its screens are not entry points to it.
    const scanParked = !f.feature && parkedNames.length > 0;
    const decisionNames: string[] = [];
    const collect = (n: any) => {
      for (const c of n.children ?? []) {
        if (c.type === 'SECTION' || f.screens.includes(c)) continue;
        if (DECISION.test(String(c.name ?? ''))) decisionNames.push(String(c.name));
        else collect(c);
      }
    };
    collect(f.node);
    // A low fidelity option ("V0.1 · Flow 2 · Option A: Cards") carries its stickies under its first screen only.
    const optionFirst = OPTION_SECTION.test(f.ref.name) ? [...f.screens].sort((a, b) => (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0))[0] : null;
    if (f.section && ![...f.path, f.ref.name].some((n) => NOTE_SKIP.test(n))) noteFindings(f, adder(f.ref, null));
    for (const sc of f.screens) {
      const screen = { id: sc.id, name: String(sc.name ?? sc.id) };
      const add = adder(f.ref, screen);
      screenRules(sc, maps, add);
      const flagged = new Set<string>();
      linkFindings(sc, f.ref, f.version, screenAt, scanParked ? parkedAt : () => null, add, flagged);
      if (scanParked) parkedNameFindings(sc, parkedNames, add, flagged);
      if (working) {
        const inWorking = working.has(f.ref.id) || f.ancestors.some((a) => working.has(a));
        if (inWorking && !ENTRY_COPY.test(screen.name) && (!optionFirst || optionFirst === sc)) {
          const count = new Set(decisionNames.map((d) => DECISION.exec(d)!).filter((m) => stickyMatch(m[2], screen.name)).map((m) => m[1])).size;
          if (count < 3) add(sc, 'no-stickies', `${quote(screen.name)} has ${count === 0 ? 'no' : count} Decision ${count === 1 ? 'sticky' : 'stickies'}: it needs 3 to 5.`, `Add ${3 - count} more right below the screen, each one bold decision line and one Why line about what is shown and why.`);
          else if (count > 5) add(sc, 'no-stickies', `${quote(screen.name)} has ${count} Decision stickies, 5 at most.`, 'Keep the 5 most important decisions for this screen and remove the rest.');
        }
      } else if (decisions) {
        const have = new Set(decisionNames.map((d) => DECISION.exec(d)!).filter((m) => stickyMatch(m[2], screen.name)).map((m) => m[1]));
        const missing = ['1', '2'].filter((n) => !have.has(n));
        if (missing.length) add(sc, 'no-stickies', `${quote(screen.name)} is missing ${missing.map((n) => `Decision ${n}`).join(' and ')}.`, `Add ${missing.map((n) => `"Decision ${n} · ${screen.name}"`).join(' and ')} under the screen: one bold decision line and one Why line.`);
      }
    }
  }

  const linked = new Set<string>();
  const linksFrom = (n: any): boolean => {
    let out = false;
    for (const r of reactionsOf(n)) for (const a of r.actions) if (a.type === 'NODE' && a.destinationId && LINKS.has(a.navigation ?? '')) { linked.add(a.destinationId); out = true; }
    for (const c of n.children ?? []) if (linksFrom(c)) out = true;
    return out;
  };
  const outgoing = new Set(looseScreens.filter((l) => linksFrom(l.node)).map((l) => l.node.id));
  // Top-level sections hold their sub-sections, so one walk each covers every link.
  if (looseScreens.length) for (const f of flows) if (f.section && !f.path.length) linksFrom(f.node);
  for (const { flow, node } of looseScreens) {
    if (!outgoing.has(node.id) && !linked.has(node.id)) continue;
    const name = String(node.name ?? node.id);
    adder(flow, { id: node.id, name })(node, 'loose-screen', `${quote(name)} sits loose on the canvas, outside any section.`, 'Move it into the section of its flow, or into a named section beside the main one if it is a side scenario, and grow that section.');
  }

  const frozen = new Set(flows.filter((f) => f.parked).map((f) => f.ref.id));
  for (const items of pageItems) {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const own = a.parent ? byId.get(a.parent) : undefined;
      if (own && !contains(own.box, a.box) && !frozen.has(a.flow.id)) adder(a.flow, a.section ? null : { id: a.id, name: a.name })({ id: a.id, name: a.name }, 'overlap', `${quote(a.name)} sits partly outside its section ${quote(own.name)}.`, `Grow ${quote(own.name)} so it holds ${quote(a.name)} with room to spare, then restack the sections below.`, 'outside');
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
        if (frozen.has(a.flow.id) && frozen.has(b.flow.id)) continue;
        // An overlap with a parked section is reported on the side that is still checked.
        const pick = a.section && !b.section ? b : a;
        const first = frozen.has(pick.flow.id) ? (pick === a ? b : a) : pick;
        const other = first === a ? b : a;
        adder(first.flow, first.section ? null : { id: first.id, name: first.name })({ id: first.id, name: first.name }, 'overlap', `${quote(first.name)} overlaps ${quote(other.name)} on the canvas.`, `Move ${quote(first.name)} or ${quote(other.name)} so they do not touch, and grow the section if it needs room.`, other.id);
      }
    }
  }

  const results: FlowResult[] = [];
  for (const f of flows) {
    if (f.parked) {
      results.push({ id: f.ref.id, name: f.ref.name, path: f.path, page: f.page, ...(f.iteration ? { iteration: f.iteration } : {}), screens: f.screens.length, state: 'unchecked', counts: {}, unchecked: [], findings: [], more: 0, skipped: 'parked' });
      continue;
    }
    // The plugin read stops at a layer cap: a section it cut short would show stickies and links as missing.
    if (cutShort(f.node)) {
      results.push({ id: f.ref.id, name: f.ref.name, path: f.path, page: f.page, ...(f.iteration ? { iteration: f.iteration } : {}), screens: f.screens.length, state: 'unchecked', counts: {}, unchecked: [], findings: [], more: 0, skipped: 'cut' });
      continue;
    }
    const list = found.get(f.ref.id) ?? [];
    if (!f.screens.length && !list.length && !f.leaf) continue;
    const counts: Partial<Record<FlowRule, number>> = {};
    for (const x of list) counts[x.rule] = (counts[x.rule] ?? 0) + 1;
    const state = list.length ? 'fail' : f.screens.length ? 'pass' : 'unchecked';
    const order = (x: FlowFinding) => f.screens.findIndex((s) => s.id === x.screen?.id);
    const sorted = [...list].sort((x, y) => order(x) - order(y) || FLOW_RULES.indexOf(x.rule) - FLOW_RULES.indexOf(y.rule));
    results.push({ id: f.ref.id, name: f.ref.name, path: f.path, page: f.page, ...(f.iteration ? { iteration: f.iteration } : {}), screens: f.screens.length, state, counts, unchecked: decisions || working ? [] : ['no-stickies'], findings: sorted.slice(0, MAX_PER_FLOW), more: Math.max(0, sorted.length - MAX_PER_FLOW) });
  }
  // Flows named in Scope need a section in the file. Parked sections and loose screens do not count.
  const live = flows.filter((f) => f.section && !f.parked).map((f) => [...f.path, f.ref.name].join(' '));
  const missing = scope.flows.filter((name) => !live.some((s) => flowMatches(name, s)));
  return { flows: results, unchecked: decisions || working ? [] : ['no-stickies'], missing };
}

type Compact = { i: string; n: string; t: string; h?: 1; b?: number[]; r?: Array<[string, Array<[string, string | null, string | null]>]>; m?: string; p?: string[]; x?: string; L?: number; u?: 0 | 1; k?: 1; c?: Compact[] };
export type PluginPayload = { flowcheck: 1; document: Compact; components: Record<string, any>; componentSets: Record<string, any>; outside?: Record<string, Outside>; nodes: number; truncated: boolean };

/** Turns the script's short keys into the node shape checkFlows reads (Plugin API `reactions`, REST-like box and ids). */
export function expandNode(c: Compact): any {
  const o: any = { id: c.i, name: c.n, type: c.t };
  if (c.h) o.visible = false;
  if (c.b) o.absoluteBoundingBox = { x: c.b[0], y: c.b[1], width: c.b[2], height: c.b[3] };
  if (c.r) o.reactions = c.r.map(([type, acts]) => ({ trigger: { type }, actions: acts.map(([t, destinationId, navigation]) => ({ type: t, destinationId, navigation })) }));
  if (c.m) o.componentId = c.m;
  if (c.p) o.componentProperties = Object.fromEntries(c.p.map((value, i) => [`variant${i}`, { type: 'VARIANT', value }]));
  if (c.x !== undefined) o.characters = c.x;
  if (c.L !== undefined) {
    o.textLength = c.L;
    o.bullets = c.u === 1;
  }
  if (c.k) o.cut = true;
  if (c.c) o.children = c.c.map(expandNode);
  return o;
}


/** Runs inside the plugin: the walker's compact tree in, the Flow check result out. */
export function runPayload(payload: PluginPayload, scope: Scope = EMPTY_SCOPE, sticky: StickyRule = {}) {
  const result = checkFlows(expandNode(payload.document), { components: payload.components ?? {}, componentSets: payload.componentSets ?? {}, outside: payload.outside ?? {} }, scope, sticky);
  return { ...result, truncated: !!payload.truncated, nodes: payload.nodes };
}
