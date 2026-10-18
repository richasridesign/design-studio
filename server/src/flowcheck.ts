import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { FlowCheckRun, FlowRule } from '../../shared/flowcheck.js';
import type { Scope } from '../../shared/scope.js';
import { readScope } from './scope.js';
import { SAMPLE_KEY } from './figma.js';
import { checkFlows } from './flowRules.js';
import { pluginFlowCheck } from './flowcheckPlugin.js';

export const FLOWCHECK_FILE = 'flowcheck.json';
export { checkFlows, hasClick, hasHover, isParkedSection, isScreen, reactionsOf, type Act, type Reaction } from './flowRules.js';

export const readFlowChecks = (dir: string) => readFile(path.join(dir, FLOWCHECK_FILE), 'utf8').then((t) => JSON.parse(t).runs as FlowCheckRun[]).catch(() => [] as FlowCheckRun[]);

type Maps = { components?: Record<string, any>; componentSets?: Record<string, any> };
type Loaded = { document: any; maps: Maps; truncated?: boolean };
type Checked = { flows: FlowCheckRun['flows']; unchecked: FlowRule[]; missing: string[]; truncated?: boolean };

// The check runs inside Figma through the plugin. `load` hands a document to the same rules here instead (tests).
export async function runFlowCheck(input: { dir: string; fileKey: string; load?: (fileKey: string) => Promise<Loaded>; read?: (fileKey: string, scope: Scope, opts: { dir: string; signal?: AbortSignal }) => Promise<Checked>; scope?: Scope; signal?: AbortSignal }): Promise<FlowCheckRun> {
  const { dir, fileKey } = input;
  const scope = input.scope ?? (await readScope(dir));
  const result: Checked = fileKey === SAMPLE_KEY
    ? { flows: [], unchecked: [], missing: [] }
    : input.load
      ? await input.load(fileKey).then((l) => ({ ...checkFlows(l.document, l.maps, scope), truncated: l.truncated }))
      : await (input.read ?? pluginFlowCheck)(fileKey, scope, { dir, signal: input.signal });
  const run: FlowCheckRun = { id: randomUUID(), at: Date.now(), fileKey, flows: result.flows, unchecked: result.unchecked, via: 'plugin', ...(result.truncated ? { truncated: true } : {}), ...(result.missing.length ? { missing: result.missing } : {}) };
  const runs = await readFlowChecks(dir);
  await writeFile(path.join(dir, FLOWCHECK_FILE), JSON.stringify({ runs: [...runs, run].slice(-5) }, null, 2));
  return run;
}
