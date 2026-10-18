export const AREAS = ['color', 'typography', 'spacing', 'components', 'accessibility', 'brief'] as const;
export type Area = (typeof AREAS)[number];

export const AREA_NAMES: Record<Area, string> = {
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing and layout',
  components: 'Components',
  accessibility: 'Accessibility',
  brief: 'Brief',
};

export const PRESETS = ['check', 'quick', 'focused', 'full'] as const;
export type ReviewPreset = (typeof PRESETS)[number];

export const PRESET_INFO: Record<ReviewPreset, { label: string; detail: string; fixRounds: number }> = {
  check: { label: 'Check', detail: 'Design system check only, no model calls', fixRounds: 1 },
  quick: { label: 'Quick', detail: 'Check plus one reviewer covering all areas', fixRounds: 1 },
  focused: { label: 'Focused', detail: 'Check plus one reviewer per area you tick', fixRounds: 1 },
  full: { label: 'Full', detail: 'Check plus all six area reviewers in parallel', fixRounds: 2 },
};

export const MODELS = { plan: 'claude-opus-5-5', work: 'claude-sonnet-5-5' } as const;

export type FlowPhase = 'plan' | 'sketch' | 'pick' | 'file' | 'system' | 'design' | 'review' | 'fix' | 'done' | 'stopped';
export type FlowKind = 'design' | 'sketch';

export const FLOW_MODES = ['chat', 'design', 'review'] as const;
export type FlowMode = (typeof FLOW_MODES)[number];

export type FlowState = {
  mode: FlowMode;
  kind: FlowKind;
  phase: FlowPhase | null;
  round: number;
  preset: ReviewPreset;
  areas: Area[];
  stopAfterSketch: boolean;
  tokens: number;
  reviewers?: ReviewerState[];
};

export type ReviewerState = { area: Area | 'all' | 'check'; state: 'running' | 'pass' | 'fail' | 'error' };

export type Severity = 'blocking' | 'major' | 'minor';

export type Finding = {
  id: string;
  area: Area | 'check';
  node: string;
  nodeName?: string;
  severity: Severity;
  rule: string;
  fix: string;
};

export type AreaResult = {
  area: Area | 'all';
  pass: boolean;
  summary: string;
  findings: Finding[];
  tokens: number;
  costUsd: number;
  error?: string;
};

export type ReviewRun = {
  id: string;
  kind: 'review' | 'audit' | 'verify';
  at: number;
  round: number;
  preset: ReviewPreset;
  frames: string[];
  check: Finding[];
  checkError?: string;
  results: AreaResult[];
  tokens: number;
  costUsd: number;
};

export type ReviewDoc = { runs: ReviewRun[]; posted?: string[] };

export const SKETCH_ITEMS = ['box', 'text', 'heading', 'button', 'input', 'image', 'icon', 'line', 'circle', 'note'] as const;
export type SketchItemType = (typeof SKETCH_ITEMS)[number];
export type SketchItem = { t: SketchItemType; x: number; y: number; w: number; h: number; label?: string };
export type SketchDirection = { id: string; name: string; rationale: string; w: number; h: number; items: SketchItem[] };
export type SketchScreen = { id: string; name: string; directions: SketchDirection[]; chosen?: string; chosenBy?: 'claude' | 'designer' };
export type SketchDoc = { screens: SketchScreen[] };

export type DesignFrame = { screen: string; state: string; nodeId: string; name?: string };
export type DesignDoc = { page?: string; frames: DesignFrame[] };

export type DsColor = { name: string; value: string; variable?: string };
export type DsText = { name: string; family?: string; size?: number; weight?: number | string; lineHeight?: number | string };
export type DsComponent = { name: string; key?: string; variants?: string[]; description?: string };
export type DesignSystem = {
  builtAt: number;
  libraries: string[];
  colors: DsColor[];
  text: DsText[];
  spacing: number[];
  radius: number[];
  components: DsComponent[];
  rules: string[];
};

export type FigmaFile = { key: string; name: string; url: string };

export type Settings = {
  figmaToken: string;
  teamId: string;
  stopAfterSketch: boolean;
  preset: ReviewPreset;
  areas: Area[];
  askBeforeEdit: boolean;
  followClaude: boolean;
  autoCheck: boolean;
  devTools: boolean;
  dailyBudgetUsd: number;
};

export const DEFAULT_SETTINGS: Settings = {
  figmaToken: '',
  teamId: '',
  stopAfterSketch: false,
  preset: 'quick',
  areas: ['components', 'accessibility', 'brief'],
  askBeforeEdit: false,
  followClaude: true,
  autoCheck: true,
  devTools: false,
  dailyBudgetUsd: 0,
};

export const flowOff = (s: Pick<Settings, 'preset' | 'areas' | 'stopAfterSketch'> = DEFAULT_SETTINGS): FlowState => ({
  mode: 'chat',
  kind: 'design',
  phase: null,
  round: 0,
  preset: s.preset,
  areas: s.areas,
  stopAfterSketch: s.stopAfterSketch,
  tokens: 0,
  reviewers: [],
});

export const FLOW_ACTIVE: FlowPhase[] = ['plan', 'sketch', 'system', 'design', 'review', 'fix'];

export function parseFigmaUrl(input: string): { key: string; nodeId: string | null } | null {
  const m = /figma\.com\/(?:design|file|proto|board|make)\/([A-Za-z0-9]{10,})/.exec(input);
  if (!m) return null;
  const node = /[?&]node-id=([0-9]+[-:][0-9]+)/.exec(input);
  return { key: m[1], nodeId: node ? node[1].replace('-', ':') : null };
}

export function nodeIdsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/node-id=([0-9]+[-:][0-9]+)/g)) ids.add(m[1].replace('-', ':'));
  for (const m of text.matchAll(/(?:^|\s)([0-9]+:[0-9]+)(?=\s|$|,)/g)) ids.add(m[1]);
  return [...ids];
}

export const figmaNodeUrl = (key: string, nodeId: string) => `https://www.figma.com/design/${key}?node-id=${nodeId.replace(':', '-')}`;

export const PERSONAS = ['new-user', 'power-user', 'accessibility', 'product'] as const;
export type Persona = (typeof PERSONAS)[number];
export const PERSONA_NAMES: Record<Persona, string> = { 'new-user': 'New user', 'power-user': 'Power user', accessibility: 'Accessibility', product: 'Product' };
export type CritPoint = { kind: 'like' | 'concern' | 'idea'; text: string; nodeId?: string };
export type CritPersona = { id: Persona; verdict: string; points: CritPoint[] };
export type CritRun = { id: string; at: number; frames: string[]; personas: CritPersona[]; summary: string; tokens: number; costUsd: number };

export const BUILD_KINDS = ['spacing', 'color', 'type', 'layout', 'content', 'missing', 'extra', 'state'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export type BuildDiff = { area: string; kind: BuildKind; severity: 'blocking' | 'major' | 'minor'; figma: string; site: string; fix: string; nodeId?: string };
export type BuildRun = { id: string; at: number; url: string; frame: string; frameName: string; width: number; dir: string; summary: string; matchScore: number; diffs: BuildDiff[]; tokens: number; costUsd: number };

export function buildChecklist(run: Pick<BuildRun, 'url' | 'frameName' | 'matchScore' | 'diffs'>) {
  const lines = run.diffs.map((d) => `- [ ] **${d.severity}** (${d.kind}) ${d.area}: ${d.fix} Figma: ${d.figma}. Site: ${d.site}.${d.nodeId ? ` Node ${d.nodeId}.` : ''}`);
  return [`Build check of ${run.url} against ${run.frameName}: ${run.matchScore}% match, ${run.diffs.length} ${run.diffs.length === 1 ? 'difference' : 'differences'}`, '', ...lines].join('\n');
}

const SEVERITY_ORDER: Severity[] = ['blocking', 'major', 'minor'];

export function reviewChecklist(run: Pick<ReviewRun, 'check' | 'results' | 'frames'>, fileKey: string | null) {
  const findings = [...run.check, ...run.results.flatMap((r) => r.findings)].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const lines = findings.map((f) => `- [ ] **${f.severity}** ${f.nodeName ?? f.node}: ${f.rule.replace(/\.$/, '')}. Fix: ${f.fix}${fileKey && f.node ? ` (${figmaNodeUrl(fileKey, f.node)})` : ''}`);
  const n = run.frames.length;
  const head = `Review of ${n} ${n === 1 ? 'frame' : 'frames'}: ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'}`;
  return lines.length ? [head, '', ...lines].join('\n') : head;
}

const POINT_LABEL: Record<CritPoint['kind'], string> = { like: 'Like', concern: 'Concern', idea: 'Idea' };

export function critMarkdown(run: Pick<CritRun, 'summary' | 'personas'>) {
  const blocks = PERSONAS.flatMap((id) => run.personas.filter((p) => p.id === id)).map((p) =>
    [`## ${PERSONA_NAMES[p.id]}`, '', p.verdict, '', ...p.points.map((pt) => `- **${POINT_LABEL[pt.kind]}:** ${pt.text}${pt.nodeId ? ` (${pt.nodeId})` : ''}`)].join('\n'));
  return [run.summary, ...blocks].join('\n\n');
}

export function copyTable(run: Pick<CopyRun, 'items'>) {
  const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  return ['| Before | After | Reason |', '| --- | --- | --- |', ...run.items.map((i) => `| ${cell(i.before)} | ${cell(i.after)} | ${cell(i.reason)} |`)].join('\n');
}

export const TONES = ['friendly', 'neutral', 'formal'] as const;
export type Tone = (typeof TONES)[number];
export type CopyItem = { nodeId: string; before: string; after: string; reason: string };
export type CopyRun = { id: string; at: number; frames: string[]; tone: Tone; items: CopyItem[]; tokens: number; costUsd: number };
