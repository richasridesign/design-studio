import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SAMPLE_KEY } from './figma.js';
import { cacheDir, outlineFrom, type Outline } from './figmaCache.js';
import { pluginScript, type ReadDeps } from './pluginRead.js';
import { projectRoot } from './roots.js';
import { unpackTag, type MapRow, type Tag } from '../../shared/project.js';

// A map of the whole Figma file, read once through the plugin and kept on disk in the chat folder, so Claude can
// find pages, sections, screens, components with their Hover variants, variables and text styles without spending
// Figma calls on discovery. It is read when a chat with a file opens, after a run that edited the file, when the
// designer refreshes the outline, and when Claude asks for it. The same read also writes the outline the UI shows.

/**
 * Node: [type letter, id, name, x, y, w, h, children?, other count?, tag?]. S section, F frame, C component, K set,
 * I instance, G group. The tag ("kind;iteration;flow") is the Design Studio plugin data on a section, see shared/project.ts.
 */
type RawNode = MapRow;
type RawSet = [string, string, string, Array<[string, string, string[]]>, Array<[string, string]>];
export type RawMap = {
  pages: Array<[string, string, RawNode[], Array<[string, string]>]>;
  sets: RawSet[];
  comps: Array<[string, string, string]>;
  vars: Array<[string, string, string, string]>;
  styles: Array<[string, string, string]>;
};

/** Read only: pages are loaded, never switched to. Screens are the frames directly inside sections or on the page. */
export const MAP_SCRIPT = `const r = (v) => Math.round(Number(v || 0));
const nm = (n, k = 90) => String(n.name == null ? '' : n.name).slice(0, k);
const LETTER = { SECTION: 'S', FRAME: 'F', COMPONENT: 'C', COMPONENT_SET: 'K', INSTANCE: 'I', GROUP: 'G' };
const isScreen = (n) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'GROUP' || (n.type === 'INSTANCE' && n.width >= 900);
const isBox = (n) => n.type === 'SECTION' || (n.type === 'FRAME' && n.children.some((c) => c.type === 'SECTION'));
function walk(n, depth) {
  const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
  const row = [LETTER[n.type] || n.type, n.id, nm(n), r(b.x), r(b.y), r(b.width), r(b.height)];
  if (isBox(n) && depth < 6) {
    const kids = [];
    let other = 0;
    for (const c of n.children) { if (c.type === 'SECTION' || isScreen(c)) kids.push(walk(c, depth + 1)); else other++; }
    row.push(kids, other);
    if (n.type === 'SECTION') {
      let tag = null;
      try {
        const kind = n.getSharedPluginData('designstudio', 'kind');
        if (kind) tag = kind + ';' + n.getSharedPluginData('designstudio', 'iteration') + ';' + n.getSharedPluginData('designstudio', 'flow');
      } catch (e) {}
      row.push(tag);
    }
  }
  return row;
}
const pages = [];
const sets = [];
const comps = [];
for (const page of figma.root.children) {
  await page.loadAsync();
  const top = [];
  for (const n of page.children) if (n.type === 'SECTION' || isScreen(n)) top.push(walk(n, 0));
  const starts = (page.flowStartingPoints || []).map((s) => [s.nodeId, String(s.name).slice(0, 80)]);
  pages.push([page.id, nm(page, 120), top, starts]);
  for (const s of page.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
    let defs = [];
    try {
      const d = s.componentPropertyDefinitions;
      defs = Object.keys(d).map((k) => [k, d[k].type, d[k].type === 'VARIANT' ? (d[k].variantOptions || []).slice(0, 30) : []]);
    } catch (e) {}
    const hasState = defs.some((d) => d[1] === 'VARIANT' && /state|interaction/i.test(d[0]));
    const variants = hasState ? s.children.slice(0, 120).map((c) => [c.id, nm(c, 160)]) : [];
    sets.push([s.id, nm(s), nm(page, 60), defs, variants]);
  }
  for (const c of page.findAllWithCriteria({ types: ['COMPONENT'] })) if (!c.parent || c.parent.type !== 'COMPONENT_SET') comps.push([c.id, nm(c), nm(page, 60)]);
}
const collections = {};
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) collections[c.id] = c.name;
const vars = (await figma.variables.getLocalVariablesAsync()).slice(0, 1500).map((v) => [v.id, v.name, v.resolvedType, collections[v.variableCollectionId] || '']);
const styles = [];
for (const s of await figma.getLocalTextStylesAsync()) styles.push([s.id, s.name, 'text ' + (typeof s.fontSize === 'number' ? s.fontSize : '')]);
for (const s of await figma.getLocalPaintStylesAsync()) styles.push([s.id, s.name, 'paint']);
for (const s of await figma.getLocalEffectStylesAsync()) styles.push([s.id, s.name, 'effect']);
return { pages, sets, comps, vars, styles };`;

export type FileMap = { key: string; name: string; readAt: number; raw: RawMap };

const parseVariant = (name: string) => Object.fromEntries(name.split(',').map((p) => p.split('=').map((s) => s.trim())).filter((p) => p.length === 2 && p[0]) as Array<[string, string]>);

/** For each non-hover variant in a set, the variant that is the same except for a Hover state. */
export function hoverPairs(variants: Array<[string, string]>): Array<[string, string]> {
  const parsed = variants.map(([id, name]) => ({ id, props: parseVariant(name) }));
  const out: Array<[string, string]> = [];
  for (const v of parsed) {
    const keys = Object.keys(v.props).filter((k) => /state|interaction/i.test(k));
    for (const k of keys) {
      if (/hover/i.test(v.props[k])) continue;
      const hit = parsed.find((o) => o !== v && /hover/i.test(o.props[k] ?? '') && Object.keys(v.props).every((p) => p === k || o.props[p] === v.props[p]));
      if (hit) {
        out.push([v.id, hit.id]);
        break;
      }
    }
  }
  return out;
}

const fmtBox = (n: RawNode) => `${n[5]}x${n[6]} @${n[3]},${n[4]}`;
const cut = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function screens(n: RawNode): number {
  return (n[7] ?? []).reduce((sum, k) => sum + (k[0] === 'S' || k[7] ? screens(k) : 1), 0);
}

/** One line per node with the section it sits in, so one grep for a name gives the id and where it is. */
export function mapMarkdown(map: FileMap): string {
  const { raw } = map;
  const lines: string[] = [
    `# Figma file map: ${map.name || map.key}`,
    `Read ${new Date(map.readAt).toISOString()} (file key ${map.key}). Changes made after that are not in it.`,
    'Lines: <node id> | <name> | <width>x<height> @<x>,<y> (page coordinates) | in <section id> <section name>. S = section, F = frame, C = component, K = component set, I = instance, G = group.',
    '',
  ];
  for (const [pid, pname, top, starts] of raw.pages) {
    lines.push(`## Page ${pid} | ${pname}`);
    if (starts.length) lines.push(`Prototype starts: ${starts.map(([id, n]) => `${id} ${n}`).join('; ')}`);
    const walk = (n: RawNode, parent: RawNode | null) => {
      const where = parent ? ` | in ${parent[1]} ${cut(parent[2])}` : '';
      const extra = n[7] ? ` | ${screens(n)} screens${n[8] ? `, ${n[8]} other layers` : ''}` : '';
      lines.push(`${n[0]} ${n[1]} | ${n[2]} | ${fmtBox(n)}${where}${extra}`);
      for (const k of n[7] ?? []) walk(k, n);
    };
    for (const n of top) walk(n, null);
    lines.push('');
  }
  lines.push('## Component sets', 'Lines: <set id> | <name> | page | properties (setProperties keys). Sets with a State property list their variants and the Hover variant each one should point to.');
  for (const [id, name, page, defs, variants] of raw.sets) {
    const props = defs.map(([k, type, opts]) => (type === 'VARIANT' ? `${k}=${opts.join('|')}` : `${k} (${type.toLowerCase()})`)).join('; ');
    lines.push(`K ${id} | ${name} | ${page} | ${props}`);
    if (variants.length) {
      const hover = new Map(hoverPairs(variants));
      for (const [vid, vname] of variants) lines.push(`  ${vid} | ${vname}${hover.has(vid) ? ` | hover ${hover.get(vid)}` : ''}`);
    }
  }
  if (raw.comps.length) {
    lines.push('', '## Single components');
    for (const [id, name, page] of raw.comps) lines.push(`C ${id} | ${name} | ${page}`);
  }
  if (raw.vars.length) {
    lines.push('', '## Variables', 'Lines: <variable id> | <name> | type | collection');
    for (const [id, name, type, coll] of raw.vars) lines.push(`V ${id} | ${name} | ${type} | ${coll}`);
  }
  if (raw.styles.length) {
    lines.push('', '## Styles');
    for (const [id, name, kind] of raw.styles) lines.push(`Y ${id} | ${name} | ${kind}`);
  }
  return `${lines.join('\n')}\n`;
}

const SUMMARY_MAX = 7000;
const PER_PAGE = 10;
const SUB_MAX = 12;
/** Newer nodes have a larger first number in their id, so sorting by it puts recent work first. */
const age = (n: RawNode) => Number(n[1].split(':')[0]) || 0;

/** The Design Studio tag on a map row (sections only), or null. */
export const tagOf = (n: RawNode): Tag | null => unpackTag(n[9]);

export type TaggedSection = { id: string; name: string; tag: Tag; page: string; parent: string | null; box: [number, number, number, number] };

/** Every section in the map that carries a Design Studio tag, with where it sits. */
export function taggedSections(map: FileMap): TaggedSection[] {
  const out: TaggedSection[] = [];
  for (const [pid, , top] of map.raw.pages) {
    const walk = (n: RawNode, parent: string | null) => {
      const tag = tagOf(n);
      if (tag) out.push({ id: n[1], name: n[2], tag, page: pid, parent, box: [n[3], n[4], n[5], n[6]] });
      for (const k of n[7] ?? []) walk(k, n[1]);
    };
    for (const n of top) walk(n, null);
  }
  return out;
}

/** The chain of sections (outermost first) a node sits in, from the map. Empty when the id is not in the map. */
export function ownerChain(map: FileMap, id: string): Array<{ id: string; name: string; tag: Tag | null }> {
  for (const [, , top] of map.raw.pages) {
    const find = (n: RawNode, trail: RawNode[]): RawNode[] | null => {
      if (n[1] === id) return trail;
      for (const k of n[7] ?? []) {
        const hit = find(k, n[0] === 'S' ? [...trail, n] : trail);
        if (hit) return hit;
      }
      return null;
    };
    for (const n of top) {
      const hit = find(n, []);
      if (hit) return hit.map((s) => ({ id: s[1], name: s[2], tag: tagOf(s) }));
    }
  }
  return [];
}

export type SummaryScope = {
  /** Page-level sections to list in full (this iteration, this flow's baseline). Other sections are counted only. */
  sections: string[];
  /** Pages always listed in full (the components page). */
  pages?: string[];
};

/**
 * The short version Claude gets in the message: pages (most recently worked on first) and their newest sections with
 * screen counts, and where the full map is. With a scope, only the scoped sections are listed and the rest are
 * counted, so eight chats starting together do not each carry the whole file.
 */
export function mapSummary(map: FileMap, file: string, scope?: SummaryScope): string {
  const out: string[] = [];
  const newest = (top: RawNode[]) => Math.max(0, ...top.map(age));
  const pages = [...map.raw.pages].sort((a, b) => newest(b[2]) - newest(a[2]));
  const want = scope ? new Set(scope.sections) : null;
  const fullPages = new Set(scope?.pages ?? []);
  for (const [pid, pname, top] of pages) {
    const all = top.filter((n) => n[7]).sort((a, b) => age(b) - age(a));
    const secs = want && !fullPages.has(pid) ? all.filter((s) => want.has(s[1])) : all;
    const loose = top.length - all.length;
    const skipped = all.length - secs.length;
    out.push(`- Page ${pid} "${pname}": ${all.length} sections${loose ? `, ${loose} loose frames` : ''}${skipped ? ` (${skipped} outside this chat's scope, see the full map)` : secs.length > PER_PAGE ? ` (newest ${PER_PAGE} below)` : ''}`);
    for (const s of secs.slice(0, PER_PAGE)) {
      const tag = tagOf(s);
      out.push(`  - ${s[1]} "${cut(s[2], 70)}" (${screens(s)} screens)${tag ? ` [${tag.kind}${tag.iteration ? ` ${tag.iteration}` : ''}${tag.flow ? ` ${tag.flow}` : ''}]` : ''}`);
      const subs = (s[7] ?? []).filter((k) => k[7]);
      for (const k of subs.slice(0, SUB_MAX)) {
        const t = tagOf(k);
        out.push(`    - ${k[1]} "${cut(k[2], 70)}" (${screens(k)} screens)${t ? ` [${t.kind}${t.flow ? ` ${t.flow}` : ''}]` : ''}`);
      }
      if (subs.length > SUB_MAX) out.push(`    - … ${subs.length - SUB_MAX} more sections`);
    }
  }
  let body = out.join('\n');
  if (body.length > SUMMARY_MAX) body = `${body.slice(0, SUMMARY_MAX)}\n- … more in the full map`;
  const n = map.raw;
  return [
    `File map of the Figma file, read ${new Date(map.readAt).toLocaleString('en-GB', { hour12: false })}: ${file}`,
    `It lists every section and screen with ids and positions, ${n.sets.length} component sets (with setProperties keys and the Hover variant of each state), ${n.comps.length} single components, ${n.vars.length} variables and ${n.styles.length} styles. Grep it for a screen, section, component or variable name before reading Figma. Anything made after the read time is not in it.`,
    body,
  ].join('\n');
}

export const mapFiles = (dir: string, key: string) => ({ json: path.join(cacheDir(dir, key), 'map.json'), md: path.join(cacheDir(dir, key), 'map.md') });

export async function cachedMap(dir: string, key: string): Promise<FileMap | null> {
  if (key === SAMPLE_KEY) return null;
  return readFile(mapFiles(dir, key).json, 'utf8').then(JSON.parse, () => null);
}

/** Top-level frames, components and sections, the shape the outline keeps. */
function outlinePages(raw: RawMap) {
  const keep = new Set(['F', 'C', 'K', 'S']);
  const types: Record<string, string> = { F: 'FRAME', C: 'COMPONENT', K: 'COMPONENT_SET', S: 'SECTION' };
  return raw.pages.map(([id, name, top]) => [id, name, top.filter((n) => keep.has(n[0])).map((n) => [n[1], n[2], types[n[0]], n[5], n[6]])]) as Array<[string, string, Array<[string, string, string, number, number]>]>;
}

const runs = new Map<string, Promise<FileMap>>();

/** Reads the map through the plugin and saves it (with the outline). Reads of the same file share one run. */
export function buildMap(dir: string, key: string, opts: { signal?: AbortSignal } & ReadDeps = {}): Promise<FileMap> {
  const id = `${dir}|${key}`;
  const hit = runs.get(id);
  if (hit) return hit;
  const run = (async () => {
    const r = await pluginScript<RawMap>(key, MAP_SCRIPT, 'Map pages, sections, screens and components (read only)', { ...opts, dir, key: 'map', socket: { name: 'map', ms: 30_000 } });
    const raw = r.value;
    if (!raw || !Array.isArray(raw.pages)) throw new Error('The file map came back empty');
    const name = await readFile(path.join(projectRoot(dir), 'figma.json'), 'utf8').then((t) => String(JSON.parse(t).name ?? ''), () => '');
    const map: FileMap = { key, name, readAt: Date.now(), raw };
    const files = mapFiles(dir, key);
    await mkdir(path.dirname(files.json), { recursive: true });
    const outline: Outline = outlineFrom(outlinePages(raw), name);
    await Promise.all([writeFile(files.json, JSON.stringify(map)), writeFile(files.md, mapMarkdown(map)), writeFile(path.join(path.dirname(files.json), 'outline.json'), JSON.stringify(outline))]);
    return map;
  })();
  runs.set(id, run);
  const clear = () => runs.delete(id);
  run.then(clear, clear);
  return run;
}

/** Reads the map again in the background. Errors are logged, not shown. */
export function refreshMapSoon(dir: string, key: string, deps: ReadDeps = {}) {
  if (!key || key === SAMPLE_KEY) return;
  buildMap(dir, key, deps).catch((err) => console.error('file map:', (err as Error).message));
}

export const MAP_MAX_AGE = 6 * 3600_000;

/** Reads the map in the background when there is none or it is older than MAP_MAX_AGE. */
export async function ensureMapSoon(dir: string, key: string, deps: ReadDeps = {}) {
  if (!key || key === SAMPLE_KEY) return;
  const map = await cachedMap(dir, key);
  if (!map || Date.now() - map.readAt > MAP_MAX_AGE) refreshMapSoon(dir, key, deps);
}

/** Where pasted node ids sit, from the map, so Claude does not have to look them up. */
export function locate(map: FileMap, ids: string[]): Array<{ id: string; found: boolean; text: string }> {
  const found = new Map<string, string>();
  for (const [, pname, top] of map.raw.pages) {
    const walk = (n: RawNode, trail: string[]) => {
      if (ids.includes(n[1])) found.set(n[1], `${n[1]} is ${n[0] === 'S' ? 'section' : 'screen'} "${n[2]}" (${n[5]}x${n[6]}) on page "${pname}"${trail.length ? `, in ${trail.join(' > ')}` : ''}${n[7] ? `, ${screens(n)} screens inside` : ''}.`);
      for (const k of n[7] ?? []) walk(k, [...trail, `${n[1]} "${cut(n[2], 50)}"`]);
    };
    for (const n of top) walk(n, []);
  }
  return ids.map((id) => {
    const text = found.get(id);
    return { id, found: Boolean(text), text: text ?? `${id} is not a section or screen in the map: it is a layer inside a screen, or newer than the map. Read it with DS.tree(await DS.node("${id}"), 2).` };
  });
}
