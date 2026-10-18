import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { AREAS, AREA_NAMES, MODELS, type Area, type AreaResult, type DesignDoc, type DesignSystem, type Finding, type ReviewDoc, type ReviewPreset, type ReviewRun, type ReviewerState } from '../../shared/design.js';
import { checkFrames } from './check.js';
import { readRules, rulesBlock } from './rules.js';
import { allRules, MAX_CHECKED_RULES, ruleResults } from '../../shared/rules.js';
import { readFrames, readingText, type Loaded } from './frameRead.js';
import { lean } from './lean.js';
import { awaitFindings } from './awaiting.js';

export const REVIEW_FILE = 'review.json';
const MAX_FINDINGS = 8;
const OUTLINE_LINES = 350;

const GUIDE: Record<Area, string> = {
  system: 'Design system: the right library component for each job with the right variant, nothing rebuilt by hand or left as a loose frame, the same element with the same variant, size and radius on every screen, colours and text from variables and styles, status shown as a dot plus a label, one primary button per screen, no drift between instances.',
  interaction: 'Interaction: every screen and state the brief asks for exists (empty, loading, error, filled, done), whole cards and rows clickable when they lead to one place, hover and pressed states, open menus and dialogs with a close icon, tooltips on icon buttons, the flow between screens keeps the same status, counts and content.',
  visual: 'Visual craft: a 4px grid for padding, gaps, radii and sizes, the type scale, one control height per toolbar, aligned left edges, cards in a row with one height, nothing clipped, overlapping or touching an edge, calm spacing with whitespace and hierarchy over boxes.',
  writing: 'UX writing: plain words and short sentences, labels as "Label: Value", the same name for the same thing on every screen, buttons that name what they do, counts that match the rows shown, errors that say what is wrong and who acts, no em dashes.',
  accessibility: 'Accessibility (WCAG 2.2 AA): text contrast 4.5:1 (3:1 for large text), icons and borders 3:1, click targets at least 24px, colour never the only signal, visible labels on inputs, visible focus, icon-only buttons with a clear name, a sensible reading order.',
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'summary', 'findings'],
  properties: {
    pass: { type: 'boolean', description: 'true when there is nothing blocking or major' },
    summary: { type: 'string', description: 'One or two sentences' },
    findings: {
      type: 'array',
      maxItems: MAX_FINDINGS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'node', 'severity', 'rule', 'fix', 'global'],
        properties: {
          area: { type: 'string', enum: [...AREAS] },
          node: { type: 'string', description: 'Figma node id like 12:34, from the outline' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          rule: { type: 'string', description: 'What is wrong, one sentence' },
          fix: { type: 'string', description: 'What to change, one sentence' },
          global: { type: 'boolean', description: 'true when the fix changes something shared: a variable or style, a main component, a feature, or screens outside these frames. The designer decides those; they are not fixed automatically.' },
          impact: { type: 'string', description: 'When global: what the fix touches, for example "the text/muted token, about 70 layers". Empty otherwise.' },
        },
      },
    },
  },
};

const RULES_SCHEMA = {
  ...SCHEMA,
  required: [...SCHEMA.required, 'rules'],
  properties: {
    ...SCHEMA.properties,
    rules: {
      type: 'array',
      maxItems: MAX_CHECKED_RULES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'state', 'frames'],
        properties: {
          n: { type: 'integer', description: 'The house rule number' },
          state: { type: 'string', enum: ['pass', 'fail'] },
          frames: { type: 'array', items: { type: 'string' }, description: 'Frame ids where the rule fails, empty when it passes' },
        },
      },
    },
  },
};

/** One reviewer checks the house rules, so the others do not pay for it or disagree. */
export function rulesReviewer(reviewers: Array<Area | 'all'>): Area | 'all' | null {
  return reviewers.includes('all') ? 'all' : reviewers.includes('system') ? 'system' : reviewers[0] ?? null;
}

export function rulesPrompt(rules: string[], frames: string[]) {
  const shown = rules.slice(0, MAX_CHECKED_RULES);
  return [
    'House rules from the designer. Check every rule below on these frames, whatever your area.',
    ...shown.map((r, i) => `${i + 1}. ${r}`),
    `For each rule you can judge, return its number, pass or fail, and for a fail the frame ids where it fails, from: ${frames.join(', ')}. Leave a rule out when the outline and screenshots cannot tell you.`,
  ].join('\n');
}

const SYSTEM = 'You review UI designs made in Figma against a design system, the designer\'s rules and a brief. You get an outline of the frames, screenshots to look at with the Read tool, and the results of an automatic check. Report only real problems a senior product designer would fix, most important first. Do not repeat what the automatic check already found. Use node ids from the outline.';

export async function readReview(dir: string): Promise<ReviewDoc> {
  return readFile(path.join(dir, REVIEW_FILE), 'utf8').then(JSON.parse).catch(() => ({ runs: [] }));
}

async function saveRun(dir: string, run: ReviewRun) {
  const doc = await readReview(dir);
  doc.runs = [...doc.runs.filter((r) => r.id !== run.id), run].slice(-30);
  await writeFile(path.join(dir, REVIEW_FILE), JSON.stringify(doc, null, 2));
}

const hex = (p: any) => (p?.type === 'SOLID' ? '#' + ['r', 'g', 'b'].map((k) => Math.round(p.color[k] * 255).toString(16).padStart(2, '0')).join('') : p?.type?.toLowerCase());

export function outline(doc: any, components: Record<string, any>, max = OUTLINE_LINES) {
  const lines: string[] = [];
  const visit = (n: any, depth: number) => {
    if (!n || n.visible === false || lines.length >= max) return;
    const b = n.absoluteBoundingBox;
    const parts = [`${'  '.repeat(depth)}${n.type} "${n.name}" ${n.id}`];
    if (b) parts.push(`${Math.round(b.width)}x${Math.round(b.height)}`);
    if (n.type === 'INSTANCE') parts.push(`of ${components[n.componentId]?.name ?? 'component'}`);
    if (n.fills?.length) parts.push(`fill ${n.fills.filter((f: any) => f.visible !== false).map(hex).join(',')}`);
    if (n.layoutMode && n.layoutMode !== 'NONE') parts.push(`auto ${n.layoutMode.toLowerCase()} gap ${n.itemSpacing ?? 0} pad ${[n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => v ?? 0).join('/')}`);
    if (n.type === 'TEXT') parts.push(`${n.style?.fontSize ?? '?'}px ${n.style?.fontWeight ?? ''} "${String(n.characters ?? '').replace(/\s+/g, ' ').slice(0, 80)}"`);
    lines.push(parts.join(' · '));
    if (n.type !== 'INSTANCE') for (const c of n.children ?? []) visit(c, depth + 1);
  };
  visit(doc, 0);
  if (lines.length >= max) lines.push('… outline cut here');
  return lines.join('\n');
}

function profileFor(ds: DesignSystem | null, area: Area | 'all') {
  if (!ds) return 'No design system profile. Judge consistency within the frames.';
  const parts: string[] = [];
  const want = (...a: Area[]) => area === 'all' || a.includes(area);
  if (ds.name) parts.push(`Profile: ${ds.name}${ds.note ? `. ${ds.note}` : ''}`);
  if (ds.tokens === false) parts.push('This is a lo-fi profile: designs do not need variables, styles or library components. Do not report missing tokens.');
  if (want('system', 'accessibility') && ds.colors.length) parts.push(`Colors: ${ds.colors.slice(0, 60).map((c) => `${c.name} ${c.value}`).join('; ')}`);
  if (want('system', 'visual', 'accessibility') && ds.text.length) parts.push(`Text styles: ${ds.text.slice(0, 40).map((t) => `${t.name} ${t.size ?? ''}/${t.lineHeight ?? ''} ${t.weight ?? ''}`).join('; ')}`);
  if (want('system', 'visual') && (ds.spacing.length || ds.radius.length)) parts.push(`Spacing scale: ${ds.spacing.join(', ') || 'not set'}. Radius: ${ds.radius.join(', ') || 'not set'}`);
  if (want('system', 'interaction') && ds.components.length) parts.push(`Components: ${ds.components.slice(0, 80).map((c) => c.name).join(', ')}`);
  if (ds.rules.length) parts.push(`Principles:\n- ${ds.rules.slice(0, 20).join('\n- ')}`);
  return parts.join('\n');
}

export function reviewersFor(preset: ReviewPreset, areas: Area[], onlyFailed: Area[] | null): Array<Area | 'all'> {
  if (preset === 'check') return [];
  // Quick is one reviewer covering the ticked areas (all five when none are ticked).
  if (preset === 'quick') return onlyFailed && onlyFailed.length === 0 ? [] : ['all'];
  const base = preset === 'full' ? [...AREAS] : AREAS.filter((a) => areas.includes(a));
  return onlyFailed ? base.filter((a) => onlyFailed.includes(a)) : base;
}

export type ReviewInput = {
  dir: string;
  fileKey: string;
  frames: string[];
  preset: ReviewPreset;
  areas: Area[];
  round: number;
  kind: ReviewRun['kind'];
  onlyFailed?: Area[] | null;
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
  onArea?: (area: ReviewerState['area'], state: ReviewerState['state']) => void;
};

/** Longest screenshot edge for reviewers: a 1440 frame keeps its size, tall pages are scaled down. */
export const SHOT_MAX = 1600;

export async function runReview(input: ReviewInput): Promise<ReviewRun> {
  const { dir, fileKey, frames } = input;
  const run: ReviewRun = { id: randomUUID(), kind: input.kind, at: Date.now(), round: input.round, preset: input.preset, frames, check: [], results: [], tokens: 0, costUsd: 0 };
  const ds: DesignSystem | null = await readFile(path.join(dir, 'design-system.json'), 'utf8').then(JSON.parse).catch(() => null);
  const plan = await readFile(path.join(dir, 'plan.md'), 'utf8').catch(() => '');

  const reviewers = reviewersFor(input.preset, input.areas, input.onlyFailed ?? null);
  input.onProgress?.(readingText(frames.length, reviewers.length > 0));
  input.onArea?.('check', 'running');
  let docs: Loaded[] = [];
  let shots: string[] = [];
  let readCost = 0;
  try {
    // One plugin read gets the frames and, when a reviewer will look at them, their screenshots.
    const read = await readFrames(fileKey, frames, { dir, signal: input.signal, shots: reviewers.length ? { dir: path.join('review', 'shots'), maxDimension: SHOT_MAX } : undefined });
    docs = read.docs;
    shots = read.shots;
    readCost = read.costUsd;
    run.check = checkFrames(docs, ds);
  } catch (err) {
    run.checkError = (err as Error).message;
  }
  input.onArea?.('check', run.checkError ? 'error' : run.check.some((f) => f.severity !== 'minor') ? 'fail' : 'pass');

  if (reviewers.length && docs.length) {
    const rules = await readRules(dir);
    const ruleList = allRules(rules);
    const checker = ruleList.length ? rulesReviewer(reviewers) : null;
    let verdicts: unknown;
    const outlines = docs.map((d) => outline(d.document, d.components)).join('\n\n');
    input.onProgress?.(`Reviewing with ${reviewers.length === 1 ? 'one reviewer' : `${reviewers.length} reviewers`}`);
    run.results = await Promise.all(reviewers.map(async (area) => {
      input.onArea?.(area, 'running');
      try {
        const { verdicts: v, ...r } = await reviewOne(area, { dir, plan, ds, outlines, covers: input.areas, shots, check: run.check, rules: area === checker ? ruleList : null, rulesText: rulesBlock(rules), frames: docs.map((d) => d.id), signal: input.signal });
        if (area === checker) verdicts = v;
        input.onArea?.(area, r.error ? 'error' : r.pass ? 'pass' : 'fail');
        return r;
      } catch (err) {
        input.onArea?.(area, 'error');
        throw err;
      }
    }));
    // Model findings name only a node id, so each one takes the name of the frame it sits in.
    run.results = run.results.map((r) => ({ ...r, findings: r.findings.map((f) => (f.nodeName ? f : { ...f, nodeName: frameOf(docs, f.node) })) }));
    if (checker) {
      run.rules = ruleResults(ruleList, verdicts, docs.map((d) => d.id));
      const failed = run.results.find((r) => r.area === checker)?.error;
      if (failed || verdicts === undefined) run.rulesError = failed ?? 'The reviewer did not check the rules';
    }
  }
  run.tokens = run.results.reduce((n, r) => n + r.tokens, 0);
  // The plugin read is a short Claude run too, so its cost counts.
  run.costUsd = readCost + run.results.reduce((n, r) => n + r.costUsd, 0);
  await saveRun(dir, run);
  await awaitFindings(dir, fileKey, run.results.flatMap((r) => r.findings)).catch((err) => console.error('awaiting list:', err));
  return run;
}

type ReviewOneInput = { dir: string; plan: string; ds: DesignSystem | null; outlines: string; covers: Area[]; shots: string[]; check: Finding[]; rules: string[] | null; rulesText: string; frames: string[]; signal?: AbortSignal };

async function reviewOne(area: Area | 'all', c: ReviewOneInput): Promise<AreaResult & { verdicts?: unknown }> {
  const areas = area !== 'all' ? [area] : c.covers.length ? c.covers : [...AREAS];
  const prompt = [
    area === 'all' ? 'Review these frames across the areas below. Tag each finding with its area.' : `You are the ${AREA_NAMES[area]} reviewer. Review only this area.`,
    ...areas.map((a) => `- ${GUIDE[a]}`),
    '',
    c.plan ? `The brief:\n${c.plan.slice(0, 4000)}` : 'There is no written brief.',
    '',
    `Design system profile:\n${profileFor(c.ds, area)}`,
    '',
    `Automatic check already found ${c.check.length} issues${c.check.length ? `: ${c.check.slice(0, 30).map((f) => `${f.node} ${f.rule}`).join('; ')}` : ''}.`,
    '',
    c.shots.length ? `Screenshots to look at with Read:\n${c.shots.join('\n')}` : 'No screenshots are available; use the outline.',
    '',
    `Outline of the frames:\n${c.outlines}`,
    '',
    `Return at most ${MAX_FINDINGS} findings. Mark a finding global when fixing it means changing a shared variable, style or main component, removing a feature, or changing screens outside these frames: the designer decides those.`,
    c.rules ? rulesPrompt(c.rules, c.frames) : c.rulesText,
  ].join('\n');
  const r = await lean<{ pass: boolean; summary: string; findings: Array<Omit<Finding, 'id' | 'decide'> & { global?: boolean; impact?: string }>; rules?: unknown }>(prompt, { cwd: c.dir, model: MODELS.work, system: SYSTEM, schema: c.rules ? RULES_SCHEMA : SCHEMA, maxTurns: 10, signal: c.signal });
  if (!r.data) return { area, pass: false, summary: 'The reviewer did not return a result', findings: [], tokens: r.tokens, costUsd: r.costUsd, error: r.error };
  const findings: Finding[] = r.data.findings.slice(0, MAX_FINDINGS).map(({ global, impact, ...f }, i) => ({
    ...f,
    area: (areas.includes(f.area as Area) ? f.area : areas[0]) as Area,
    id: `${area}:${i}:${f.node}`,
    ...(global ? { decide: impact?.trim() || 'Something shared beyond these frames' } : {}),
  }));
  return { area, pass: r.data.pass && !findings.some((f) => f.severity !== 'minor'), summary: r.data.summary, findings, tokens: r.tokens, costUsd: r.costUsd, ...(c.rules ? { verdicts: r.data.rules } : {}) };
}

const holds = (n: any, id: string): boolean => n?.id === id || (n?.children ?? []).some((c: any) => holds(c, id));

/** The name of the reviewed frame that holds a node, if any. */
export function frameOf(docs: Array<{ document: any }>, id: string): string | undefined {
  const name = docs.find((d) => holds(d.document, id))?.document?.name;
  return typeof name === 'string' && name ? name : undefined;
}

export function failedAreas(run: ReviewRun): Area[] {
  const out = new Set<Area>();
  for (const r of run.results) for (const f of r.findings) if (f.severity !== 'minor' && f.area !== 'check') out.add(f.area as Area);
  return AREAS.filter((a) => out.has(a));
}

/** What a fix round works on: blocking and major findings, except those that wait for the designer's decision. */
export const toFix = (run: ReviewRun) => [...run.check, ...run.results.flatMap((r) => r.findings)].filter((f) => f.severity !== 'minor' && !f.decide);

export async function readDesign(dir: string): Promise<DesignDoc | null> {
  return readFile(path.join(dir, 'design.json'), 'utf8').then(JSON.parse).catch(() => null);
}
