import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { MODELS } from '../../shared/design.js';
import { FigmaError } from './figma.js';
import { figmaMcp, lean, type FigmaMcp } from './lean.js';

// Flow check without a Figma token: Claude calls use_figma once with a fixed, read-only Plugin API script, and the
// server reads the script's return value straight from the tool result. Claude never repeats the document, because a
// real file is megabytes of JSON, far more than a model can write back.

export const PLUGIN_MAX_NODES = 20000;
export const PLUGIN_MAX_DEPTH = 40;

// Shapes with no children that matter to the walker: icon vectors are most of a file's layers. They are kept only
// when they carry a prototype reaction, or a name the close and sticky checks read.
const GEOMETRY = ['VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION', 'SLICE'];
const KEEP = /close|dismiss|decision|^\s*x\s*$/i;

/**
 * The Plugin API script for use_figma. It only reads: no setters, no page switch, no version save.
 * It returns a compact tree (short keys, see expandNode) plus the component maps checkFlows groups copies by.
 * Like the REST loader, pages with a top-level SECTION get full SECTION and FRAME subtrees and shallow other nodes.
 */
export function flowCheckScript(opts: { maxNodes?: number; maxDepth?: number } = {}) {
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
return { flowcheck: 1, document: { i: figma.root.id, n: clip(figma.root.name), t: 'DOCUMENT', c: pages }, components, componentSets, nodes: count, truncated };
`;
}

type Compact = { i: string; n: string; t: string; h?: 1; b?: number[]; r?: Array<[string, Array<[string, string | null, string | null]>]>; m?: string; p?: string[]; x?: string; c?: Compact[] };
export type PluginPayload = { flowcheck: 1; document: Compact; components: Record<string, any>; componentSets: Record<string, any>; nodes: number; truncated: boolean };

/** Turns the script's short keys into the node shape checkFlows reads (Plugin API `reactions`, REST-like box and ids). */
export function expandNode(c: Compact): any {
  const o: any = { id: c.i, name: c.n, type: c.t };
  if (c.h) o.visible = false;
  if (c.b) o.absoluteBoundingBox = { x: c.b[0], y: c.b[1], width: c.b[2], height: c.b[3] };
  if (c.r) o.reactions = c.r.map(([type, acts]) => ({ trigger: { type }, actions: acts.map(([t, destinationId, navigation]) => ({ type: t, destinationId, navigation })) }));
  if (c.m) o.componentId = c.m;
  if (c.p) o.componentProperties = Object.fromEntries(c.p.map((value, i) => [`variant${i}`, { type: 'VARIANT', value }]));
  if (c.x !== undefined) o.characters = c.x;
  if (c.c) o.children = c.c.map(expandNode);
  return o;
}

const isPayload = (v: any): v is PluginPayload => !!v && typeof v === 'object' && v.flowcheck === 1 && !!v.document;

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return undefined;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      return undefined;
    }
  }
}

/** Finds the script's return value in a tool result, whatever envelope it comes in (text blocks, JSON in a string, structuredContent). */
export function findPayload(v: unknown, depth = 0): PluginPayload | null {
  if (depth > 6 || v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || t.includes('"flowcheck"') ? findPayload(tryJson(t), depth + 1) : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const p = findPayload(x, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (typeof v !== 'object') return null;
  if (isPayload(v)) return v;
  for (const x of Object.values(v)) {
    const p = findPayload(x, depth + 1);
    if (p) return p;
  }
  return null;
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join('\n') : v && typeof v === 'object' ? textOf((v as any).text ?? (v as any).content ?? '') : '');

// Claude Code can save a large tool result to a file and hand the model a preview with the path.
const SAVED = /saved to:?\s*(\S+?\.(?:txt|json))\b/i;

type Capture = { payload: PluginPayload | null; text: string; error: boolean; saved: string | null };

/** Watches the query for the use_figma call and its result. Returns true once the result is in. */
export function captureUseFigma(onDone: (c: Capture) => void) {
  const calls = new Set<string>();
  return (msg: SDKMessage) => {
    const content = (msg as any).message?.content;
    if (!Array.isArray(content)) return;
    if (msg.type === 'assistant') {
      for (const b of content) if (b?.type === 'tool_use' && /__use_figma$/.test(String(b.name ?? ''))) calls.add(String(b.id));
      return;
    }
    if (msg.type !== 'user') return;
    for (const b of content) {
      if (b?.type !== 'tool_result' || !calls.has(String(b.tool_use_id))) continue;
      const payload = findPayload(b.content) ?? findPayload((msg as any).tool_use_result);
      const text = textOf(b.content);
      onDone({ payload, text, error: !!b.is_error, saved: payload ? null : (SAVED.exec(text)?.[1] ?? null) });
    }
  };
}

const SYSTEM = 'You run one Figma Plugin API script through the use_figma tool and report whether it ran. You do not edit the file.';

/** Reads the document through the Figma plugin (no REST token needed). */
export async function loadDocumentViaPlugin(fileKey: string, opts: { dir: string; signal?: AbortSignal; mcp?: FigmaMcp; run?: typeof lean }) {
  const { servers, plugins, name } = opts.mcp ?? (await figmaMcp());
  const tool = `mcp__${name}__use_figma`;
  const prompt = [
    `Call the ${tool} tool exactly once with fileKey "${fileKey}", description "Read sections and prototype links for Flow check (read only)", and this exact code. Do not change the code.`,
    'The script is read only and already follows the figma-use rules, so do not load any skill and do not call any other tool.',
    'After the call, reply with ok true if it returned data, or ok false and the error text in note.',
    '',
    '```js',
    flowCheckScript(),
    '```',
  ].join('\n');
  const stop = new AbortController();
  opts.signal?.addEventListener('abort', () => stop.abort());
  let got: Capture | null = null;
  const r = await (opts.run ?? lean)<{ ok: boolean; note?: string }>(prompt, {
    cwd: opts.dir,
    model: MODELS.work,
    system: SYSTEM,
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['ok'], additionalProperties: false },
    tools: [],
    mcp: servers,
    plugins,
    allowed: [tool],
    maxTurns: 4,
    // Raised so the tool result reaches us whole. The model never reads it: the query stops as soon as it arrives.
    env: { MAX_MCP_OUTPUT_TOKENS: '1000000' },
    signal: stop.signal,
    onMessage: captureUseFigma((c) => {
      got = c;
      stop.abort();
    }),
  });
  if (opts.signal?.aborted) throw new FigmaError('Flow check stopped', 499);
  const cap = got as Capture | null;
  let payload = cap?.payload ?? null;
  // Only Claude Code's own tool-results folder, never a path the file's content could point to.
  const saved = cap?.saved && path.resolve(cap.saved).startsWith(path.join(os.homedir(), '.claude')) && cap.saved.includes('/tool-results/') ? cap.saved : null;
  if (!payload && saved) payload = findPayload(await readFile(saved, 'utf8').catch(() => ''));
  if (!payload) {
    const why = (cap?.text || r.data?.note || r.error || 'no result').replace(/\s+/g, ' ').slice(0, 240);
    throw new FigmaError(`Could not read the file through the Figma plugin: ${why}`, 502);
  }
  return { document: expandNode(payload.document), maps: { components: payload.components ?? {}, componentSets: payload.componentSets ?? {} }, truncated: !!payload.truncated, nodes: payload.nodes };
}
