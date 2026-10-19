import type { RuleResult } from './rules.js';

/** Review areas, in Richa's order from her design-process skill file. */
export const AREAS = ['system', 'interaction', 'visual', 'writing', 'accessibility'] as const;
export type Area = (typeof AREAS)[number];
/** Area ids from before the five areas. Old review.json files and the sample chat still carry them. */
export const LEGACY_AREAS = ['color', 'typography', 'spacing', 'components', 'brief'] as const;
export type LegacyArea = (typeof LEGACY_AREAS)[number];
export type AnyArea = Area | LegacyArea;

export const AREA_NAMES: Record<AnyArea, string> = {
  system: 'Design system',
  interaction: 'Interaction',
  visual: 'Visual craft',
  writing: 'UX writing',
  accessibility: 'Accessibility',
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing and layout',
  components: 'Components',
  brief: 'Brief',
};

/** One short line per area, shown next to its tick box. */
export const AREA_DETAIL: Record<Area, string> = {
  system: 'Components, variants, tokens and drift',
  interaction: 'Wiring, hover, states and flow',
  visual: 'Grid, spacing, alignment and equal heights',
  writing: 'Terms, labels, counts and punctuation',
  accessibility: 'WCAG 2.2 AA: contrast, targets, focus and labels',
};

/** Where each old area went, so saved settings keep their meaning. */
export const LEGACY_TO_AREA: Record<LegacyArea, Area> = { color: 'system', typography: 'visual', spacing: 'visual', components: 'system', brief: 'interaction' };

/** Ticked areas in her order, old ids mapped to new ones, unknown ids dropped. */
export function toAreas(list: unknown): Area[] {
  if (!Array.isArray(list)) return [];
  const want = new Set(list.map((a) => (AREAS as readonly unknown[]).includes(a) ? a : LEGACY_TO_AREA[a as LegacyArea]).filter(Boolean));
  return AREAS.filter((a) => want.has(a));
}

/** Areas saved before the five areas (old chats and settings) held a default nobody chose: they become all five. */
export const tickedAreas = (list: unknown): Area[] =>
  Array.isArray(list) && !list.some((a) => (LEGACY_AREAS as readonly unknown[]).includes(a)) ? toAreas(list) : [...AREAS];

export const PRESETS = ['check', 'quick', 'focused', 'full'] as const;
export type ReviewPreset = (typeof PRESETS)[number];
/** The presets the designer picks from. Check runs on its own after edits and as the final check. */
export const SHOWN_PRESETS = ['quick', 'focused', 'full'] as const;
export type ShownPreset = (typeof SHOWN_PRESETS)[number];

export const PRESET_INFO: Record<ReviewPreset, { label: string; detail: string }> = {
  check: { label: 'Check', detail: 'Code scan only, no reviewers' },
  quick: { label: 'Quick', detail: 'Code scan, then one reviewer covering the ticked areas' },
  focused: { label: 'Focused', detail: 'Code scan, then one reviewer per ticked area' },
  full: { label: 'Full', detail: 'Code scan, then one reviewer for each of the five areas' },
};

/** How many model reviewers a run starts. */
export const reviewerCount = (preset: ReviewPreset, areas: Area[]) => (preset === 'check' ? 0 : preset === 'quick' ? 1 : preset === 'full' ? AREAS.length : Math.max(1, areas.length));

/** Measured: one Sonnet reviewer on a few frames costs about 5 cents; reading 6 frames costs about half a cent. */
export const REVIEWER_USD = 0.05;
export const READ_USD = 0.005;

/** A rough cost for one review round, before any fix rounds. */
export function roundCost(preset: ReviewPreset, areas: Area[], perReviewer = REVIEWER_USD) {
  const usd = READ_USD + reviewerCount(preset, areas) * perReviewer;
  return usd < 0.01 ? 'under a cent' : `about $${usd.toFixed(2)}`;
}

// read: the cheap model that only drives Figma plugin reads (it never sees the file content).
export const MODELS = { plan: 'claude-opus-5-5', work: 'claude-sonnet-5-5', read: 'claude-haiku-5-5' } as const;

export const FLOW_MODES = ['chat', 'design', 'review'] as const;
export type FlowMode = (typeof FLOW_MODES)[number];

export type FlowState = {
  mode: FlowMode;
  preset: ReviewPreset;
  areas: Area[];
  reviewers?: ReviewerState[];
};

export type ReviewerState = { area: AnyArea | 'all' | 'check'; state: 'running' | 'pass' | 'fail' | 'error' };

export type Severity = 'blocking' | 'major' | 'minor';

export type Finding = {
  id: string;
  area: AnyArea | 'check';
  node: string;
  nodeName?: string;
  severity: Severity;
  rule: string;
  fix: string;
  /** Set when fixing it changes something shared (a token, a component, a feature, other screens): the designer decides, the fix round skips it. */
  decide?: string;
};

export type AreaResult = {
  area: AnyArea | 'all';
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
  /** House rules checked by one reviewer. Missing on runs with no rules or no model reviewer. */
  rules?: RuleResult[];
  rulesError?: string;
  tokens: number;
  costUsd: number;
};

export type ReviewDoc = { runs: ReviewRun[]; posted?: string[] };

export type DesignFrame = { screen: string; state: string; nodeId: string; name?: string };
export type DesignDoc = { page?: string; frames: DesignFrame[] };

/** Where an item came from: a starter profile, the Figma file, a tokens file in code, or added by hand. */
export type DsFrom = 'starter' | 'figma' | 'code' | 'hand';
export type DsColor = { name: string; value: string; variable?: string; from?: DsFrom };
export type DsText = { name: string; family?: string; size?: number; weight?: number | string; lineHeight?: number | string; from?: DsFrom };
export type DsComponent = { name: string; key?: string; variants?: string[]; description?: string; from?: DsFrom };

export type DsSource =
  | { kind: 'figma'; key: string; name: string; at: number; error?: string }
  | { kind: 'code'; path: string; at: number; error?: string }
  /** Rule files are read live at review time, never copied, so they cannot drift. off: file names turned off. */
  | { kind: 'skills'; dir: string; off: string[] };

export type DesignSystem = {
  builtAt: number;
  libraries: string[];
  colors: DsColor[];
  text: DsText[];
  spacing: number[];
  radius: number[];
  components: DsComponent[];
  /** Short principles, one per line. Designs and reviews follow them. */
  rules: string[];
  /** The fields below are missing on profiles built before sources and starters. */
  name?: string;
  starter?: string;
  note?: string;
  sources?: DsSource[];
  /** false: designs need not use variables, styles or library components (lo-fi), so the code scan skips those checks. */
  tokens?: boolean;
  /** Areas this profile reviews by default. */
  areas?: Area[];
  /** Items the designer dropped, as "kind:name", so a refresh does not bring them back. */
  dropped?: string[];
};

export type FigmaFile = { key: string; name: string; url: string };

export type Settings = {
  preset: ReviewPreset;
  areas: Area[];
  askBeforeEdit: boolean;
  followClaude: boolean;
  autoCheck: boolean;
  devTools: boolean;
  dailyBudgetUsd: number;
  /** Where new projects are made. Empty means the default (~/workspace/design-projects, or DESIGN_STUDIO_PROJECTS). */
  projectsRoot: string;
  /** Chats that run at once when a prompt runs across flows. The rest wait their turn. */
  parallelChats: number;
};

export const DEFAULT_SETTINGS: Settings = {
  preset: 'quick',
  areas: [...AREAS],
  askBeforeEdit: false,
  followClaude: true,
  autoCheck: true,
  devTools: false,
  dailyBudgetUsd: 0,
  projectsRoot: '',
  parallelChats: 3,
};

export const flowOff = (s: Pick<Settings, 'preset' | 'areas'> = DEFAULT_SETTINGS): FlowState => ({
  mode: 'chat',
  preset: s.preset,
  areas: s.areas,
  reviewers: [],
});

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

export function reviewChecklist(run: Pick<ReviewRun, 'check' | 'results' | 'frames' | 'rules'>, fileKey: string | null) {
  const findings = [...run.check, ...run.results.flatMap((r) => r.findings)].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const lines = findings.map((f) => `- [ ] **${f.severity}** ${f.nodeName ?? f.node}: ${f.rule.replace(/\.$/, '')}. Fix: ${f.fix}${fileKey && f.node ? ` (${figmaNodeUrl(fileKey, f.node)})` : ''}`);
  const failed = (run.rules ?? []).filter((r) => r.state === 'fail' && !r.triage);
  const where = (ids: string[]) => (ids.length ? `: fails on ${ids.map((id) => (fileKey ? figmaNodeUrl(fileKey, id) : id)).join(', ')}` : '');
  const rules = failed.map((r) => `- [ ] **house rule** ${r.rule.replace(/\.$/, '')}${where(r.frames)}`);
  const n = run.frames.length;
  const ruleNote = failed.length ? `, ${failed.length} ${failed.length === 1 ? 'house rule' : 'house rules'} failed` : '';
  const head = `Review of ${n} ${n === 1 ? 'frame' : 'frames'}: ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'}${ruleNote}`;
  return lines.length || rules.length ? [head, '', ...lines, ...rules].join('\n') : head;
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
