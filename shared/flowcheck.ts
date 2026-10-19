import { figmaNodeUrl } from './design.js';

export const FLOW_RULES = ['no-click', 'no-hover', 'wrong-hover', 'no-close', 'no-tooltip', 'stale-link', 'parked-link', 'toast', 'overlap', 'loose-screen', 'no-stickies', 'long-note'] as const;
export type FlowRule = (typeof FLOW_RULES)[number];

export const FLOW_RULE_LABEL: Record<FlowRule, string> = {
  'no-click': 'No click',
  'no-hover': 'No hover',
  'wrong-hover': 'Wrong hover',
  'no-close': 'No close icon',
  'no-tooltip': 'No tooltip',
  'stale-link': 'Old link',
  'parked-link': 'Link to parked',
  toast: 'Toast place',
  overlap: 'Overlap',
  'loose-screen': 'Loose screen',
  'no-stickies': 'No stickies',
  'long-note': 'Long note',
};

// Canvas tidiness and toast placement are craft: they show in Flow check but do not hold back the Prototype wired gate.
const NOT_WIRING = new Set<FlowRule>(['toast', 'loose-screen', 'long-note']);

export type FlowRef = { id: string; name: string };

export type FlowFinding = {
  id: string;
  flow: FlowRef;
  screen: FlowRef | null;
  nodeId: string;
  nodeName: string;
  rule: FlowRule;
  message: string;
  fix: string;
  severity: 'major' | 'minor';
};

export type FlowState = 'pass' | 'fail' | 'unchecked';

export type FlowResult = {
  id: string;
  name: string;
  // Names of the sections around this one, outermost first.
  path: string[];
  page: string;
  // The tagged iteration this section sits in, for an adopted file.
  iteration?: string;
  screens: number;
  state: FlowState;
  counts: Partial<Record<FlowRule, number>>;
  // Rules that could not run for this flow, like stickies when the file has none.
  unchecked: FlowRule[];
  findings: FlowFinding[];
  // Findings beyond the stored cap. Counts always cover every finding.
  more: number;
  // Why the whole section was skipped. Parked sections are frozen references, so no rule runs on them. Cut: the
  // plugin read reached its layer cap inside this section.
  skipped?: 'parked' | 'cut';
};

export type FlowCheckRun = {
  id: string;
  at: number;
  fileKey: string;
  flows: FlowResult[];
  unchecked: FlowRule[];
  // How the file was read: the REST API with a token, or the Figma plugin. Older runs have neither.
  via?: 'rest' | 'plugin';
  // The plugin read stops at a layer cap on very large files.
  truncated?: boolean;
  // Flows named in Scope that match no section in the file. Older runs have none.
  missing?: string[];
};

export const flowIssues = (f: FlowResult) => Object.values(f.counts).reduce((n, c) => n + (c ?? 0), 0);

/** Issues that count for the Prototype wired gate. */
export const wiringIssues = (f: FlowResult) => Object.entries(f.counts).reduce((n, [r, c]) => n + (NOT_WIRING.has(r as FlowRule) ? 0 : c ?? 0), 0);

export function flowLabel(f: FlowResult) {
  if (f.state === 'unchecked') return 'Not checked';
  const n = flowIssues(f);
  return n ? `${n} ${n === 1 ? 'issue' : 'issues'}` : 'Passed';
}

// Forgiving names: no case, punctuation or extra spaces, so "Add a workflow" matches "Button / Add-a-workflow".
export const nameWords = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** True when the whole name (a parked feature) appears in the text as whole words. */
export function namedLike(text: string, name: string) {
  const n = nameWords(name);
  return !!n && ` ${nameWords(text)} `.includes(` ${n} `);
}

const FILLER = new Set(['flow', 'flows', 'the', 'a', 'an', 'screen', 'screens']);
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const allWords = (s: string) => nameWords(s).split(' ').filter(Boolean).map(stem);
// Filler words are dropped from the flow name, unless that leaves nothing.
function want(s: string) {
  const all = allWords(s);
  const kept = all.filter((w) => !FILLER.has(w));
  return kept.length ? kept : all;
}

/**
 * A scope flow matches a section when every word of the flow name is in the section's name or path, in any order.
 * A number stays with the word before it: "Flow 1" needs "flow 1" in that order, so it never matches "Flow 10",
 * "V2.1" or "flows 1 to 6".
 */
export function flowMatches(flow: string, section: string) {
  const words = nameWords(flow).split(' ').filter(Boolean);
  const text = ` ${nameWords(section)} `;
  const phrases: string[] = [];
  const bound = new Set<number>();
  words.forEach((w, i) => {
    if (i > 0 && /^\d+$/.test(w)) {
      phrases.push(`${words[i - 1]} ${w}`);
      bound.add(i - 1).add(i);
    }
  });
  const need = bound.size ? want(words.filter((_, i) => !bound.has(i)).join(' ')).filter((w) => !FILLER.has(w)) : want(flow);
  const have = new Set(allWords(section));
  return need.length + phrases.length > 0 && phrases.every((p) => text.includes(` ${p} `)) && need.every((w) => have.has(w));
}

const MAX_PROMPT = 40;

// The message for the composer. It asks for a plan first, so nothing changes in Figma before Richa approves.
export function flowFixPrompt(run: FlowCheckRun, flowIds?: string[]) {
  const flows = run.flows.filter((f) => f.state === 'fail' && (!flowIds || flowIds.includes(f.id)));
  const total = flows.reduce((n, f) => n + flowIssues(f), 0);
  const link = (id: string) => (run.fileKey && run.fileKey !== 'sample' ? ` ${figmaNodeUrl(run.fileKey, id)}` : '');
  const lines: string[] = [
    `Flow check found ${total} prototype ${total === 1 ? 'gap' : 'gaps'} in ${flows.length} ${flows.length === 1 ? 'flow' : 'flows'}.`,
    'Plan the fixes first: list each fix with its screen, node and change, then wait for my approval before you edit anything in Figma.',
  ];
  let shown = 0;
  for (const f of flows) {
    if (shown >= MAX_PROMPT) break;
    lines.push('', `${f.name} (section ${f.id}${link(f.id)}):`);
    for (const x of f.findings) {
      if (shown >= MAX_PROMPT) break;
      lines.push(`- [${x.rule}] ${x.screen ? `${x.screen.name}: ` : ''}${x.message} Fix: ${x.fix} (node ${x.nodeId})`);
      shown++;
    }
  }
  if (total > shown) lines.push('', `And ${total - shown} more. Run Flow check again after these are fixed.`);
  if (run.missing?.length) lines.push('', `Not found in the file: ${run.missing.join(', ')}. These flows are in Scope. Tell me if they were renamed or cut before you plan anything for them.`);
  return lines.join('\n');
}
