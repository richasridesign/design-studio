import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FlowCheckRun } from '../../shared/flowcheck.js';
import { EMPTY_SCOPE, type Scope } from '../../shared/scope.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';

// Flow check through the Figma plugin. A real file is megabytes of layers, far over the 20480-byte use_figma return
// limit (a 240,000-layer test file gave 1.5 MB at the 20,000-layer cap), so the check itself runs inside Figma:
// the rules in flowRules.ts are bundled into the script, and only the findings come back.

export const PLUGIN_MAX_NODES = 20000;
export const PLUGIN_MAX_DEPTH = 40;

// Shapes with no children that matter to the walker: icon vectors are most of a file's layers. They are kept only
// when they carry a prototype reaction, or a name the close and sticky checks read.
const GEOMETRY = ['VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION', 'SLICE'];
const KEEP = /close|dismiss|decision|^\s*x\s*$/i;

/**
 * The Plugin API script for use_figma. It only reads: no setters, no page switch, no version save.
 * It builds a compact tree (short keys, see expandNode) plus the component maps checkFlows groups copies by.
 * Like the REST loader, pages with a top-level SECTION get full SECTION and FRAME subtrees and shallow other nodes.
 */
type WalkOpts = { maxNodes?: number; maxDepth?: number };

function flowWalk(opts: WalkOpts = {}) {
  const maxNodes = opts.maxNodes ?? PLUGIN_MAX_NODES;
  const maxDepth = opts.maxDepth ?? PLUGIN_MAX_DEPTH;
  return `const MAX_NODES = ${maxNodes};
const MAX_DEPTH = ${maxDepth};
const GEOMETRY = new Set(${JSON.stringify(GEOMETRY)});
const KEEP = new RegExp(${JSON.stringify(KEEP.source)}, 'i');
const components = {};
const componentSets = {};
let count = 0;
let truncated = false;
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const clip = (s) => String(s == null ? '' : s).slice(0, 120);
function box(n) {
  const b = n.absoluteBoundingBox;
  if (b) return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  const t = n.absoluteTransform;
  return [r2(t ? t[0][2] : n.x), r2(t ? t[1][2] : n.y), r2(n.width), r2(n.height)];
}
function acts(list) {
  const out = [];
  for (const a of list || []) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'CONDITIONAL') {
      for (const b of a.conditionalBlocks || []) for (const x of acts(b && b.actions)) out.push(x);
      continue;
    }
    out.push([String(a.type || ''), a.destinationId || null, a.navigation || null]);
  }
  return out;
}
function reactions(n) {
  let list = null;
  try { list = n.reactions; } catch (e) { return null; }
  if (!list || !list.length) return null;
  const out = [];
  for (const r of list) {
    if (!r || !r.trigger || !r.trigger.type) continue;
    const a = acts(r.actions || (r.action ? [r.action] : []));
    if (a.length) out.push([String(r.trigger.type), a]);
  }
  return out.length ? out : null;
}
async function instance(n, o) {
  try {
    const m = typeof n.getMainComponentAsync === 'function' ? await n.getMainComponentAsync() : null;
    if (m) {
      o.m = m.id;
      if (!components[m.id]) {
        const p = m.parent;
        const set = p && p.type === 'COMPONENT_SET' ? p : null;
        components[m.id] = set ? { name: m.name, componentSetId: set.id } : { name: m.name };
        if (set && !componentSets[set.id]) componentSets[set.id] = { name: set.name };
      }
    }
  } catch (e) {}
  try {
    const props = n.componentProperties || {};
    const v = [];
    for (const k of Object.keys(props)) if (props[k] && props[k].type === 'VARIANT') v.push(String(props[k].value));
    if (v.length) o.p = v;
  } catch (e) {}
}
async function walk(n, depth, parentType, full) {
  if (count >= MAX_NODES) { truncated = true; return null; }
  const o = { i: n.id, n: clip(n.name), t: n.type };
  if (n.visible === false) { count++; o.h = 1; return o; }
  const r = reactions(n);
  if (GEOMETRY.has(n.type) && !r && !KEEP.test(n.name || '')) return null;
  count++;
  if (n.type === 'SECTION' || parentType === 'SECTION' || parentType === 'PAGE') o.b = box(n);
  if (r) o.r = r;
  if (n.type === 'TEXT') {
    try { const s = String(n.characters || '').trim(); if (s) o.x = s.slice(0, 40); } catch (e) {}
  }
  if (n.type === 'INSTANCE') await instance(n, o);
  if (!full || GEOMETRY.has(n.type)) return o;
  let ch = null;
  try { ch = 'children' in n ? n.children : null; } catch (e) {}
  if (ch && ch.length) {
    if (depth >= MAX_DEPTH) { truncated = true; return o; }
    const c = [];
    for (const k of ch) {
      if (count >= MAX_NODES) { truncated = true; break; }
      const w = await walk(k, depth + 1, n.type, true);
      if (w) c.push(w);
    }
    if (c.length) o.c = c;
  }
  return o;
}
const pages = [];
for (const page of figma.root.children) {
  if (typeof page.loadAsync === 'function') await page.loadAsync();
  const tops = page.children || [];
  const flows = tops.some((t) => t.type === 'SECTION');
  const c = [];
  for (const t of tops) {
    if (flows) {
      const w = await walk(t, 1, 'PAGE', t.type === 'SECTION' || t.type === 'FRAME');
      if (w) c.push(w);
    } else if (KEEP.test(t.name || '')) {
      c.push({ i: t.id, n: clip(t.name), t: t.type });
    }
  }
  pages.push({ i: page.id, n: clip(page.name), t: page.type, c });
}
const __payload = { flowcheck: 1, document: { i: figma.root.id, n: clip(figma.root.name), t: 'DOCUMENT', c: pages }, components, componentSets, nodes: count, truncated };`;
}

/** The walker alone, returning the compact tree. Tests run it against a fake figma global. */
export const flowCheckScript = (opts: WalkOpts = {}) => `${flowWalk(opts)}\nreturn __payload;`;

let bundle: Promise<string> | null = null;

/** flowRules.ts as one plain script that defines __fc. Built once per server start. */
export function rulesBundle(): Promise<string> {
  bundle ??= (async () => {
    const here = (ext: string) => fileURLToPath(new URL(`./flowRules.${ext}`, import.meta.url));
    const entry = existsSync(here('ts')) ? here('ts') : here('js');
    const { build } = await import('esbuild');
    const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', globalName: '__fc', platform: 'neutral', target: 'es2018', minify: true, legalComments: 'none', logLevel: 'silent' });
    return out.outputFiles[0].text;
  })();
  bundle.catch(() => { bundle = null; });
  return bundle;
}

/** The whole use_figma body: rules, walker, then the check. Only reads. */
export async function flowCheckBody(scope: Scope = EMPTY_SCOPE, opts: WalkOpts = {}) {
  return `${await rulesBundle()}\n${flowWalk(opts)}\nreturn __fc.runPayload(__payload, ${JSON.stringify(scope)});`;
}

export type PluginCheck = { flows: FlowCheckRun['flows']; unchecked: FlowCheckRun['unchecked']; missing: string[]; truncated: boolean; nodes: number; costUsd: number; ms: number };

/** Runs the Flow check inside Figma through the plugin. */
export async function pluginFlowCheck(fileKey: string, scope: Scope, opts: { dir: string; signal?: AbortSignal } & ReadDeps): Promise<PluginCheck> {
  const r = await pluginScript<Omit<PluginCheck, 'costUsd' | 'ms'>>(fileKey, await flowCheckBody(scope), 'Check prototype links for Flow check (read only)', opts);
  return { ...r.value, costUsd: r.costUsd, ms: r.ms };
}
