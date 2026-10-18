import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { AREA_NAMES, PERSONA_NAMES, figmaNodeUrl, type Finding, type FigmaFile } from '../../shared/design.js';
import { readSketch } from './sketch.js';
import { readCopy, readCrit } from './crit.js';
import { readDesign, readReview } from './review.js';

const MAX_SHOTS = 8;
const MAX_SHOT_BYTES = 1.5 * 1024 * 1024;

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export function markdown(src: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of src.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*+])|\d+[.)])\s+(.*)$/.exec(line);
    if (h) {
      flush();
      close();
      const level = Math.min(h[1].length + 2, 6);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      flush();
      const kind = li[1] ? 'ul' : 'ol';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(li[2])}</li>`);
    } else if (!line.trim()) {
      flush();
      close();
    } else {
      close();
      para.push(line.trim());
    }
  }
  flush();
  close();
  return out.join('\n');
}

export const safeId = (id: unknown): id is string => typeof id === 'string' && /^[\w:;.-]+$/.test(id) && !id.includes('..');

const section = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
const read = (file: string) => readFile(file, 'utf8').catch(() => null);

async function brief(dir: string) {
  const text = (await read(path.join(dir, 'plan.md')))?.trim();
  return text ? section('Brief', markdown(text)) : '';
}

async function sketches(dir: string) {
  const doc = await readSketch(dir).catch(() => null);
  if (!doc) return '';
  const blocks: string[] = [];
  for (const s of doc.screens) {
    if (!safeId(s.id)) continue;
    const figs: string[] = [];
    for (const d of s.directions) {
      if (!safeId(d.id)) continue;
      const svg = await read(path.join(dir, 'sketches', `${s.id}--${d.id}.svg`));
      if (!svg) continue;
      const chosen = s.chosen === d.id;
      figs.push(`<figure class="${chosen ? 'chosen' : ''}"><img alt="${esc(d.name)}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><figcaption>${esc(d.name)}${chosen ? ' (chosen)' : ''}<small>${esc(d.rationale)}</small></figcaption></figure>`);
    }
    if (figs.length) blocks.push(`<h3>${esc(s.name)}</h3><div class="grid">${figs.join('')}</div>`);
  }
  return blocks.length ? section('Sketches', blocks.join('')) : '';
}

async function shotFor(dir: string, nodeId: string) {
  if (!safeId(nodeId)) return null;
  const file = path.join(dir, 'review', 'shots', `${nodeId.replace(/[:;]/g, '-')}.png`);
  const size = await stat(file).then((s) => s.size).catch(() => Infinity);
  if (size > MAX_SHOT_BYTES) return null;
  const data = await readFile(file).catch(() => null);
  return data ? `data:image/png;base64,${data.toString('base64')}` : null;
}

async function design(dir: string, figma: FigmaFile | null) {
  const doc = await readDesign(dir);
  if (!doc?.frames?.length) return '';
  let shots = 0;
  const items: string[] = [];
  for (const f of doc.frames) {
    const label = esc(f.name || `${f.screen} / ${f.state}`);
    const link = figma ? `<a href="${esc(figmaNodeUrl(figma.key, f.nodeId))}">${label}</a>` : label;
    const src = shots < MAX_SHOTS ? await shotFor(dir, f.nodeId) : null;
    if (src) shots++;
    items.push(`<figure>${src ? `<img src="${src}" alt="${label}">` : ''}<figcaption>${link}</figcaption></figure>`);
  }
  return section('Design', `<div class="grid">${items.join('')}</div>`);
}

const findingRow = (f: Finding) =>
  `<li><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span> <strong>${esc(f.nodeName || f.node)}</strong>: ${esc(f.rule)}<br><small>Fix: ${esc(f.fix)}</small></li>`;

async function review(dir: string) {
  const run = (await readReview(dir)).runs.at(-1);
  if (!run) return '';
  const parts: string[] = [`<p class="meta">${esc(new Date(run.at).toLocaleString('en-GB'))}</p>`];
  if (run.check.length) parts.push(`<h3>Design system check <small>${run.check.length} findings</small></h3><ul class="findings">${run.check.map(findingRow).join('')}</ul>`);
  for (const r of run.results) {
    const name = r.area === 'all' ? 'All areas' : AREA_NAMES[r.area];
    parts.push(`<h3>${esc(name)} <small>${r.error ? 'error' : r.pass ? 'pass' : 'needs work'}</small></h3>`);
    parts.push(`<p>${esc(r.error || r.summary)}</p>`);
    if (r.findings.length) parts.push(`<ul class="findings">${r.findings.map(findingRow).join('')}</ul>`);
  }
  return section('Review', parts.join(''));
}

async function crit(dir: string) {
  const run = (await readCrit(dir)).at(-1);
  if (!run) return '';
  const parts = [run.summary ? `<p>${esc(run.summary)}</p>` : ''];
  for (const p of run.personas) {
    parts.push(`<h3>${esc(PERSONA_NAMES[p.id] ?? p.id)}</h3><p>${esc(p.verdict)}</p>`);
    if (p.points.length) parts.push(`<ul>${p.points.map((x) => `<li><strong>${esc(x.kind)}</strong>: ${esc(x.text)}</li>`).join('')}</ul>`);
  }
  return section('Crit', parts.join(''));
}

async function copy(dir: string) {
  const run = (await readCopy(dir)).at(-1);
  if (!run?.items.length) return '';
  const rows = run.items.map((i) => `<tr><td>${esc(i.before)}</td><td>${esc(i.after)}</td><td>${esc(i.reason)}</td></tr>`).join('');
  return section('Copy changes', `<table><thead><tr><th>Before</th><th>After</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>`);
}

const STYLE = `
:root { --accent: #b5573a; }
* { box-sizing: border-box; }
body { margin: 0; background: #faf9f5; color: #2b2926; font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
h1, h2, h3, h4 { font-family: ui-serif, Georgia, serif; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2.2rem; margin: 0 0 4px; }
h2 { font-size: 1.5rem; color: var(--accent); border-bottom: 1px solid #e4e0d4; padding-bottom: 6px; margin: 0 0 16px; }
h3 { font-size: 1.1rem; margin: 20px 0 6px; }
h3 small { font: 0.8rem system-ui, sans-serif; color: #7a756b; margin-left: 6px; }
section { margin-top: 44px; }
a { color: var(--accent); }
code { background: #f0ede3; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
small, .meta { color: #7a756b; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
figure { margin: 0; background: #fff; border: 1px solid #e4e0d4; border-radius: 8px; padding: 10px; break-inside: avoid; }
figure.chosen { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
figure img { width: 100%; height: auto; display: block; }
figcaption { margin-top: 8px; font-size: 0.9rem; }
figcaption small { display: block; }
.findings { list-style: none; padding: 0; }
.findings li { padding: 8px 0; border-bottom: 1px solid #ece8dc; }
.sev { display: inline-block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #fff; background: #7a756b; border-radius: 4px; padding: 1px 6px; }
.sev.blocking { background: #a8321f; }
.sev.major { background: var(--accent); }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid #e4e0d4; }
th { color: #7a756b; font-weight: 600; }
@media print { body { background: #fff; } main { max-width: none; padding: 0; } section { break-inside: auto; } h2 { break-after: avoid; } }
`;

export const reportSlug = (figma: FigmaFile | null) => (figma?.name ?? 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';

export async function buildReport(dir: string, figma: FigmaFile | null): Promise<string> {
  const title = figma?.name || path.basename(dir);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const body = (await Promise.all([brief(dir), sketches(dir), design(dir, figma), review(dir), crit(dir), copy(dir)])).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} design report</title><style>${STYLE}</style></head><body><main><h1>${esc(title)}</h1><p class="meta">Design report, ${esc(date)}</p>${body}</main></body></html>`;
}
