import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { AREAS, AREA_NAMES, MODELS, type Area, type AreaResult, type DesignDoc, type DesignSystem, type Finding, type ReviewDoc, type ReviewPreset, type ReviewRun, type ReviewerState } from '../../shared/design.js';
import { checkFrames } from './check.js';
import { readRules, rulesBlock } from './rules.js';
import { download, images, nodes } from './figma.js';
import { lean } from './lean.js';

export const REVIEW_FILE = 'review.json';
const MAX_FINDINGS = 8;
const OUTLINE_LINES = 350;

const GUIDE: Record<Area, string> = {
  color: 'Color: semantic tokens used for their meaning (primary only for the main action, danger only for destructive or error states), consistent emphasis across screens, no decorative color that competes with actions, correct use of modes if the profile has them.',
  typography: 'Typography: clear hierarchy with one main heading per screen, consistent steps between levels, library text styles, body line length around 45 to 75 characters, no awkward truncation, consistent alignment.',
  spacing: 'Spacing and layout: consistent rhythm, related things grouped and unrelated things separated, aligned edges, same padding for the same kind of element across screens, sensible resizing (hug or fill), nothing cramped or floating.',
  components: 'Components: the right library component for each job, correct variants and properties, the same element looks the same on every screen, needed states present (disabled, selected, error), nothing rebuilt by hand.',
  accessibility: 'Accessibility: contrast for text on images and tinted surfaces, target sizes, visible labels on inputs, errors not shown by color alone, icon-only buttons with a clear meaning, a sensible reading order.',
  brief: 'Brief: every screen and state the plan asks for exists (empty, loading, error, success where relevant), the copy fits the request, the layout follows the chosen sketch direction, the flow between screens makes sense.',
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
        required: ['area', 'node', 'severity', 'rule', 'fix'],
        properties: {
          area: { type: 'string', enum: [...AREAS] },
          node: { type: 'string', description: 'Figma node id like 12:34, from the outline' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          rule: { type: 'string', description: 'What is wrong, one sentence' },
          fix: { type: 'string', description: 'What to change, one sentence' },
        },
      },
    },
  },
};

const SYSTEM = 'You review UI designs made in Figma against a design system and a brief. You get an outline of the frames, screenshots to look at with the Read tool, and the results of an automatic check. Report only real problems a senior product designer would fix, most important first. Do not repeat what the automatic check already found. Use node ids from the outline.';

export async function readReview(dir: string): Promise<ReviewDoc> {
  return readFile(path.join(dir, REVIEW_FILE), 'utf8').then(JSON.parse).catch(() => ({ runs: [] }));
}

async function saveRun(dir: string, run: ReviewRun) {
  const doc = await readReview(dir);
  doc.runs = [...doc.runs.filter((r) => r.id !== run.id), run].slice(-30);
  await writeFile(path.join(dir, REVIEW_FILE), JSON.stringify(doc, null, 2));
}

export async function markPosted(dir: string, ids: string[]) {
  const doc = await readReview(dir);
  doc.posted = [...new Set([...(doc.posted ?? []), ...ids])];
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
  if (!ds) return 'No design system profile yet. Judge consistency within the frames.';
  const parts: string[] = [];
  const want = (a: Area) => area === 'all' || area === a;
  if (want('color')) parts.push(`Colors: ${ds.colors.slice(0, 60).map((c) => `${c.name} ${c.value}`).join('; ')}`);
  if (want('typography') || want('accessibility')) parts.push(`Text styles: ${ds.text.slice(0, 40).map((t) => `${t.name} ${t.size ?? ''}/${t.lineHeight ?? ''} ${t.weight ?? ''}`).join('; ')}`);
  if (want('spacing')) parts.push(`Spacing scale: ${ds.spacing.join(', ')}. Radius: ${ds.radius.join(', ')}`);
  if (want('components') || want('brief')) parts.push(`Components: ${ds.components.slice(0, 80).map((c) => c.name).join(', ')}`);
  if (ds.rules.length) parts.push(`Rules:\n- ${ds.rules.slice(0, 20).join('\n- ')}`);
  return parts.join('\n');
}

export function reviewersFor(preset: ReviewPreset, areas: Area[], onlyFailed: Area[] | null): Array<Area | 'all'> {
  if (preset === 'check') return [];
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

export async function runReview(input: ReviewInput): Promise<ReviewRun> {
  const { dir, fileKey, frames } = input;
  const run: ReviewRun = { id: randomUUID(), kind: input.kind, at: Date.now(), round: input.round, preset: input.preset, frames, check: [], results: [], tokens: 0, costUsd: 0 };
  const ds: DesignSystem | null = await readFile(path.join(dir, 'design-system.json'), 'utf8').then(JSON.parse).catch(() => null);
  const plan = await readFile(path.join(dir, 'plan.md'), 'utf8').catch(() => '');

  input.onProgress?.('Reading the frames from Figma');
  input.onArea?.('check', 'running');
  const docs: Array<{ id: string; document: any; components: Record<string, any> }> = [];
  try {
    for (let i = 0; i < frames.length; i += 20) {
      const r = await nodes(fileKey, frames.slice(i, i + 20));
      for (const [id, n] of Object.entries(r.nodes)) if (n) docs.push({ id, document: n.document, components: n.components ?? {} });
    }
    run.check = checkFrames(docs, ds);
  } catch (err) {
    run.checkError = (err as Error).message;
  }
  input.onArea?.('check', run.checkError ? 'error' : run.check.some((f) => f.severity !== 'minor') ? 'fail' : 'pass');

  const reviewers = reviewersFor(input.preset, input.areas, input.onlyFailed ?? null);
  if (reviewers.length && docs.length) {
    input.onProgress?.('Taking screenshots');
    const shotDir = path.join(dir, 'review', 'shots');
    await mkdir(shotDir, { recursive: true });
    const shots: string[] = [];
    try {
      const urls = await images(fileKey, docs.map((d) => d.id), 1);
      for (const d of docs) {
        const url = urls[d.id];
        if (!url) continue;
        const file = path.join('review', 'shots', `${d.id.replace(/[:;]/g, '-')}.png`);
        await download(url, path.join(dir, file)).then(() => shots.push(file)).catch(() => {});
      }
    } catch (err) {
      console.error('review shots:', (err as Error).message);
    }
    const outlines = docs.map((d) => outline(d.document, d.components)).join('\n\n');
    input.onProgress?.(`Reviewing with ${reviewers.length === 1 ? 'one reviewer' : `${reviewers.length} reviewers`}`);
    run.results = await Promise.all(reviewers.map(async (area) => {
      input.onArea?.(area, 'running');
      try {
        const r = await reviewOne(area, { dir, plan, ds, outlines, shots, check: run.check, signal: input.signal });
        input.onArea?.(area, r.error ? 'error' : r.pass ? 'pass' : 'fail');
        return r;
      } catch (err) {
        input.onArea?.(area, 'error');
        throw err;
      }
    }));
  }
  run.tokens = run.results.reduce((n, r) => n + r.tokens, 0);
  run.costUsd = run.results.reduce((n, r) => n + r.costUsd, 0);
  await saveRun(dir, run);
  return run;
}

async function reviewOne(area: Area | 'all', c: { dir: string; plan: string; ds: DesignSystem | null; outlines: string; shots: string[]; check: Finding[]; signal?: AbortSignal }): Promise<AreaResult> {
  const areas = area === 'all' ? [...AREAS] : [area];
  const prompt = [
    area === 'all' ? 'Review these frames across all areas below. Tag each finding with its area.' : `You are the ${AREA_NAMES[area]} reviewer. Review only this area.`,
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
    `Return at most ${MAX_FINDINGS} findings.`,
    rulesBlock(await readRules(c.dir)),
  ].join('\n');
  const r = await lean<{ pass: boolean; summary: string; findings: Array<Omit<Finding, 'id'>> }>(prompt, { cwd: c.dir, model: MODELS.work, system: SYSTEM, schema: SCHEMA, maxTurns: 10, signal: c.signal });
  if (!r.data) return { area, pass: false, summary: 'The reviewer did not return a result', findings: [], tokens: r.tokens, costUsd: r.costUsd, error: r.error };
  const findings = r.data.findings.slice(0, MAX_FINDINGS).map((f, i) => ({ ...f, area: (AREAS.includes(f.area as Area) ? f.area : area === 'all' ? 'brief' : area) as Area, id: `${area}:${i}:${f.node}` }));
  return { area, pass: r.data.pass && !findings.some((f) => f.severity !== 'minor'), summary: r.data.summary, findings, tokens: r.tokens, costUsd: r.costUsd };
}

export function failedAreas(run: ReviewRun): Area[] {
  const out = new Set<Area>();
  for (const r of run.results) for (const f of r.findings) if (f.severity !== 'minor' && f.area !== 'check') out.add(f.area);
  return [...out];
}

export const toFix = (run: ReviewRun) => [...run.check, ...run.results.flatMap((r) => r.findings)].filter((f) => f.severity !== 'minor');

export async function readDesign(dir: string): Promise<DesignDoc | null> {
  return readFile(path.join(dir, 'design.json'), 'utf8').then(JSON.parse).catch(() => null);
}
