import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BUILD_KINDS, MODELS, nodeIdsIn, type BuildDiff, type BuildRun } from '../../shared/design.js';
import { download, images, nodes } from './figma.js';
import { screenshotUrl } from './chrome.js';
import { lean } from './lean.js';
import { outline } from './review.js';

export const BUILDCHECK_FILE = 'buildcheck.json';
const MAX_DIFFS = 15;

export const clampWidth = (w: number) => Math.min(1920, Math.max(320, Math.round(w) || 1440));

export function parseBuildArg(arg: string): { url: string; width: number | null; frames: string[] } | { error: string } {
  const [first = '', ...rest] = arg.trim().split(/\s+/);
  let url: URL;
  try {
    url = new URL(first);
  } catch {
    return { error: 'paste the page address first, like /buildcheck http://localhost:3000 [frame link]' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'only http and https addresses work' };
  const text = rest.join(' ');
  const w = /\bwidth:\s*(\d+)/i.exec(text)?.[1];
  return { url: url.href, width: w ? clampWidth(Number(w)) : null, frames: nodeIdsIn(text) };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'matchScore', 'diffs'],
  properties: {
    summary: { type: 'string', description: 'Two sentences on how close the build is and the biggest gaps' },
    matchScore: { type: 'integer', minimum: 0, maximum: 100 },
    diffs: {
      type: 'array',
      maxItems: MAX_DIFFS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'kind', 'severity', 'figma', 'site', 'fix'],
        properties: {
          area: { type: 'string', description: 'The part of the page, like "Hero heading" or "Footer links"' },
          kind: { type: 'string', enum: [...BUILD_KINDS] },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          figma: { type: 'string', description: 'What the design shows, with values where visible' },
          site: { type: 'string', description: 'What the page shows, with values where visible' },
          fix: { type: 'string', description: 'What the engineer should change' },
          nodeId: { type: 'string', description: 'Figma node id like 12:34 from the outline, when the difference is about one element' },
        },
      },
    },
  },
};

const SYSTEM = 'You compare a built web page with the Figma frame it should match, for a designer doing QA. You get two screenshots to look at with the Read tool: the design (figma.png) and the live page (site.png), plus an outline of the design with node ids. Ignore differences that come from real data, scrolling position, cookie banners and browser chrome. List real differences in spacing, color, type, layout, content, missing elements, extra elements and states. Rank by what a designer would block a release on. Give at most 15, most severe first, with concrete values where you can see them. matchScore is how closely the page matches the design, 100 being identical.';

export const readBuildChecks = (dir: string) => readFile(path.join(dir, BUILDCHECK_FILE), 'utf8').then((t) => JSON.parse(t).runs as BuildRun[]).catch(() => [] as BuildRun[]);

export async function runBuildCheck(input: { dir: string; fileKey: string; frame: string; url: string; width?: number | null; signal?: AbortSignal; onProgress?: (t: string) => void }): Promise<BuildRun> {
  const { dir, fileKey, frame, url } = input;
  input.onProgress?.('Reading the frame from Figma');
  const doc = (await nodes(fileKey, [frame])).nodes[frame];
  if (!doc) throw new Error('Figma could not read that frame');
  const frameName = String(doc.document.name ?? frame);
  const width = clampWidth(input.width ?? doc.document.absoluteBoundingBox?.width ?? 1440);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rel = path.join('buildcheck', stamp);
  await mkdir(path.join(dir, rel), { recursive: true });
  input.onProgress?.('Rendering the frame');
  const figmaUrl = (await images(fileKey, [frame], 1))[frame];
  if (!figmaUrl) throw new Error('Figma could not render that frame');
  await download(figmaUrl, path.join(dir, rel, 'figma.png'));
  input.onProgress?.(`Screenshotting the page at ${width}px`);
  await writeFile(path.join(dir, rel, 'site.png'), await screenshotUrl(url, width));
  input.onProgress?.('Comparing');
  const prompt = [
    `Design: ${path.join(rel, 'figma.png')} (frame "${frameName}", ${Math.round(doc.document.absoluteBoundingBox?.width ?? 0)}px wide).`,
    `Live page: ${path.join(rel, 'site.png')} (${url}, rendered at ${width}px wide, full page).`,
    `Outline of the design:\n${outline(doc.document, doc.components ?? {})}`,
  ].join('\n\n');
  const r = await lean<{ summary: string; matchScore: number; diffs: BuildDiff[] }>(prompt, { cwd: dir, model: MODELS.work, system: SYSTEM, schema: SCHEMA, tools: ['Read'], maxTurns: 6, signal: input.signal });
  if (!r.data) throw new Error(r.error ?? 'No comparison returned');
  const run: BuildRun = {
    id: randomUUID(),
    at: Date.now(),
    url,
    frame,
    frameName,
    width,
    dir: rel,
    summary: r.data.summary,
    matchScore: Math.min(100, Math.max(0, Math.round(r.data.matchScore))),
    diffs: r.data.diffs.slice(0, MAX_DIFFS),
    tokens: r.tokens,
    costUsd: r.costUsd,
  };
  const runs = await readBuildChecks(dir);
  await writeFile(path.join(dir, BUILDCHECK_FILE), JSON.stringify({ runs: [...runs, run].slice(-20) }, null, 2));
  return run;
}
