import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { FlowCheckRun, FlowRule } from '../../shared/flowcheck.js';
import type { Scope } from '../../shared/scope.js';
import { readScope } from './scope.js';
import { SAMPLE_KEY } from './figma.js';
import { checkFlows, type Iterations, type StickyRule } from './flowRules.js';
import { pluginFlowCheck } from './flowcheckPlugin.js';
import { readProject } from './project.js';
import { projectRoot } from './roots.js';
import { cachedMap, taggedSections } from './fileMap.js';

export const FLOWCHECK_FILE = 'flowcheck.json';
export { checkFlows, hasClick, hasHover, isParkedSection, isScreen, reactionsOf, type Act, type Reaction } from './flowRules.js';

export const readFlowChecks = (dir: string) => readFile(path.join(dir, FLOWCHECK_FILE), 'utf8').then((t) => JSON.parse(t).runs as FlowCheckRun[]).catch(() => [] as FlowCheckRun[]);

type Maps = { components?: Record<string, any>; componentSets?: Record<string, any> };
type Loaded = { document: any; maps: Maps; truncated?: boolean };
type Checked = { flows: FlowCheckRun['flows']; unchecked: FlowRule[]; missing: string[]; truncated?: boolean };

/**
 * For an adopted file, the flow and states subsections of its working iterations (project.json, then the tags in the
 * map): only their screens need 3 to 5 Decision stickies. No project.json: the older Decision 1 and 2 rule.
 */
export async function stickyRule(dir: string, fileKey: string): Promise<StickyRule> {
  const project = await readProject(dir);
  if (!project || project.key !== fileKey) return {};
  const working = new Set(project.iterations.filter((it) => it.state === 'working').map((it) => it.id));
  const ids = new Set<string>();
  for (const it of project.iterations) if (working.has(it.id)) for (const f of Object.values(it.flows ?? {})) for (const id of [f.node, f.states]) if (id) ids.add(id);
  const map = await cachedMap(projectRoot(dir), fileKey).catch(() => null);
  if (map) for (const s of taggedSections(map)) if ((s.tag.kind === 'flow' || s.tag.kind === 'states') && s.tag.iteration && working.has(s.tag.iteration)) ids.add(s.id);
  // Iteration sections by node, from project.json and then the tags, for the Old link rule and the iteration scope.
  const iterations: Iterations = {};
  const stateOf = (id: string): 'working' | 'frozen' => (working.has(id) ? 'working' : 'frozen');
  for (const it of project.iterations) if (it.node) iterations[it.node] = { id: it.id, state: stateOf(it.id) };
  if (map) for (const s of taggedSections(map)) if (s.tag.kind === 'iteration' && s.tag.iteration && project.iterations.some((it) => it.id === s.tag.iteration)) iterations[s.id] ??= { id: s.tag.iteration, state: stateOf(s.tag.iteration) };
  return { working: [...ids], iterations };
}

// The check runs inside Figma through the plugin. `load` hands a document to the same rules here instead (tests).
export async function runFlowCheck(input: { dir: string; fileKey: string; load?: (fileKey: string) => Promise<Loaded>; read?: (fileKey: string, scope: Scope, opts: { dir: string; signal?: AbortSignal; sticky?: StickyRule }) => Promise<Checked>; scope?: Scope; signal?: AbortSignal }): Promise<FlowCheckRun> {
  const { dir, fileKey } = input;
  const scope = input.scope ?? (await readScope(dir));
  const sticky = fileKey === SAMPLE_KEY ? {} : await stickyRule(dir, fileKey).catch(() => ({}));
  const result: Checked = fileKey === SAMPLE_KEY
    ? { flows: [], unchecked: [], missing: [] }
    : input.load
      ? await input.load(fileKey).then((l) => ({ ...checkFlows(l.document, l.maps, scope, sticky), truncated: l.truncated }))
      : await (input.read ?? pluginFlowCheck)(fileKey, scope, { dir, signal: input.signal, sticky });
  const run: FlowCheckRun = { id: randomUUID(), at: Date.now(), fileKey, flows: result.flows, unchecked: result.unchecked, via: 'plugin', ...(result.truncated ? { truncated: true } : {}), ...(result.missing.length ? { missing: result.missing } : {}) };
  const runs = await readFlowChecks(dir);
  await writeFile(path.join(dir, FLOWCHECK_FILE), JSON.stringify({ runs: [...runs, run].slice(-5) }, null, 2));
  return run;
}
