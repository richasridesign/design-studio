import { figmaNodeUrl } from './design.js';

export const FLOW_RULES = ['no-click', 'no-hover', 'no-close', 'no-tooltip', 'stale-link', 'overlap', 'no-stickies'] as const;
export type FlowRule = (typeof FLOW_RULES)[number];

export const FLOW_RULE_LABEL: Record<FlowRule, string> = {
  'no-click': 'No click',
  'no-hover': 'No hover',
  'no-close': 'No close icon',
  'no-tooltip': 'No tooltip',
  'stale-link': 'Old link',
  overlap: 'Overlap',
  'no-stickies': 'No stickies',
};

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
  screens: number;
  state: FlowState;
  counts: Partial<Record<FlowRule, number>>;
  // Rules that could not run for this flow, like stickies when the file has none.
  unchecked: FlowRule[];
  findings: FlowFinding[];
  // Findings beyond the stored cap. Counts always cover every finding.
  more: number;
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
};

export const flowIssues = (f: FlowResult) => Object.values(f.counts).reduce((n, c) => n + (c ?? 0), 0);

export function flowLabel(f: FlowResult) {
  if (f.state === 'unchecked') return 'Not checked';
  const n = flowIssues(f);
  return n ? `${n} ${n === 1 ? 'issue' : 'issues'}` : 'Passed';
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
  return lines.join('\n');
}
