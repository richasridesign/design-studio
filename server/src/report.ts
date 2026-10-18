import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { AREA_NAMES, PERSONA_NAMES, figmaNodeUrl, type CopyRun, type CritRun, type DesignDoc, type Finding, type FigmaFile, type ReviewRun, type Severity, type SketchDoc } from '../../shared/design.js';
import { readSketch } from './sketch.js';
import { readCopy, readCrit } from './crit.js';
import { readDesign, readReview, toFix } from './review.js';
import { rulesLine, rulesSummary, type RuleResult } from '../../shared/rules.js';
import { decisionLog, whoLabel } from '../../shared/decisionLog.js';
import { readApprovals } from './stages.js';
import { readScope } from './scope.js';
import { readFlowChecks } from './flowcheck.js';
import { STAGE_IDS, STAGE_INFO, stageLabel, type StageApprovals } from '../../shared/stages.js';
import { FLOW_RULE_LABEL, flowIssues, type FlowCheckRun, type FlowRule } from '../../shared/flowcheck.js';
import type { Scope } from '../../shared/scope.js';

const MAX_SHOTS = 8;
const MAX_SHOT_BYTES = 1.5 * 1024 * 1024;
const LEDE_MAX = 280;

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Markdown for the report. Headings start at h3 (the shallowest level in the text becomes h3), so levels never skip
 * under the section's h2. With dropTitle, a first-line heading that is the only one at its level is left out:
 * it repeats the report or section title ("# Grocery app: cart", "# Research").
 */
export function markdown(src: string, opts: { dropTitle?: boolean } = {}): string {
  let lines = src.split(/\r?\n/);
  if (opts.dropTitle) {
    const first = lines.findIndex((l) => l.trim());
    const h = first >= 0 ? HEADING.exec(lines[first]) : null;
    const levels = lines.map((l) => HEADING.exec(l)?.[1].length ?? 0).filter(Boolean);
    if (h && levels.filter((n) => n === h[1].length).length === 1 && Math.min(...levels) === h[1].length) lines = lines.slice(first + 1);
  }
  const top = Math.min(6, ...lines.map((l) => HEADING.exec(l)?.[1].length ?? 6));
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
  for (const line of lines) {
    const h = HEADING.exec(line);
    const li = /^\s*(?:([-*+])|\d+[.)])\s+(.*)$/.exec(line);
    if (h) {
      flush();
      close();
      const level = Math.min(h[1].length - top + 3, 6);
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = (at: number) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const read = (file: string) => readFile(file, 'utf8').catch(() => null);

/** A status: a shape plus a label. The shape differs per kind, so it never relies on colour alone. */
type Status = 'blocking' | 'major' | 'minor' | 'pass' | 'fail' | 'error' | 'none' | 'current';
const st = (kind: Status, label: string) => `<span class="st ${kind}">${esc(label)}</span>`;
const SEV_LABEL: Record<Severity, string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };

type Section = { id: string; title: string; body: string; count?: string };
const section = (s: Section) => `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.body}</section>`;

type Data = {
  dir: string;
  figma: FigmaFile | null;
  plan: string;
  research: string;
  scope: Scope;
  sketch: SketchDoc | null;
  approvals: StageApprovals;
  design: DesignDoc | null;
  run: ReviewRun | undefined;
  flow: FlowCheckRun | undefined;
  crit: CritRun | undefined;
  copy: CopyRun | undefined;
};

const nodeLink = (d: Data, id: string, label: string) => (d.figma && safeId(id) ? `<a href="${esc(figmaNodeUrl(d.figma.key, id))}">${esc(label)}</a>` : esc(label));

function brief(d: Data): Section | null {
  return d.plan ? { id: 'brief', title: 'Brief', body: markdown(d.plan, { dropTitle: true }) } : null;
}

function research(d: Data): Section | null {
  // The report is one file, so screenshots saved next to research.md show as their names.
  const text = d.research.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? `(Screenshot: ${alt})` : ''));
  return d.research ? { id: 'research', title: 'Research', body: markdown(text, { dropTitle: true }) } : null;
}

function scope(d: Data): Section | null {
  const s = d.scope;
  if (!s.flows.length && !s.parked.length) return null;
  const flows = s.flows.length ? `<p>Flows in scope: ${s.flows.map(esc).join(', ')}</p>` : '';
  const parked = s.parked.length
    ? `<h3>Parked</h3><ul class="rows">${s.parked.map((p) => `<li><strong>${esc(p.name)}</strong>, parked ${esc(day(p.at))}<br>Why: ${esc(p.why)}${p.restore ? `<br>To restore: ${esc(p.restore)}` : ''}</li>`).join('')}</ul>`
    : '';
  return { id: 'scope', title: 'Scope', body: flows + parked };
}

async function sketches(d: Data): Promise<Section | null> {
  if (!d.sketch) return null;
  const blocks: string[] = [];
  for (const s of d.sketch.screens) {
    if (!safeId(s.id)) continue;
    const figs: string[] = [];
    for (const dir of s.directions) {
      if (!safeId(dir.id)) continue;
      const svg = await read(path.join(d.dir, 'sketches', `${s.id}--${dir.id}.svg`));
      if (!svg) continue;
      const chosen = s.chosen === dir.id;
      figs.push(`<figure class="${chosen ? 'chosen' : ''}"><img alt="Sketch: ${esc(dir.name)}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><figcaption><strong>${esc(dir.name)}</strong>${chosen ? ` ${st('pass', 'Chosen')}` : ''}<small>${esc(dir.rationale)}</small></figcaption></figure>`);
    }
    if (figs.length) blocks.push(`<h3>${esc(s.name)}</h3><div class="grid">${figs.join('')}</div>`);
  }
  return blocks.length ? { id: 'sketches', title: 'Sketches', body: blocks.join('') } : null;
}

function decisions(d: Data): Section | null {
  const rows = decisionLog(d.sketch, d.approvals);
  if (!rows.length) return null;
  const items = rows.map((r) => {
    const when = r.at ? `, ${new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
    const lines = [r.over.length ? `Over: ${r.over.join(', ')}` : '', r.why ? `Why: ${r.why}` : ''].filter(Boolean).map((l) => `<br>${esc(l)}`).join('');
    return `<li><strong>${esc(r.title)}</strong>: ${esc(r.choice)}${lines}<br><small>${esc(whoLabel(r, 'the designer'))}${esc(when)}</small></li>`;
  });
  return { id: 'decisions', title: 'Decision log', body: `<ul class="rows">${items.join('')}</ul>`, count: String(rows.length) };
}

async function shotFor(dir: string, nodeId: string) {
  if (!safeId(nodeId)) return null;
  const file = path.join(dir, 'review', 'shots', `${nodeId.replace(/[:;]/g, '-')}.png`);
  const size = await stat(file).then((s) => s.size).catch(() => Infinity);
  if (size > MAX_SHOT_BYTES) return null;
  const data = await readFile(file).catch(() => null);
  return data ? `data:image/png;base64,${data.toString('base64')}` : null;
}

async function design(d: Data): Promise<Section | null> {
  const frames = d.design?.frames ?? [];
  if (!frames.length) return null;
  let shots = 0;
  const figs: string[] = [];
  const rest: string[] = [];
  for (const f of frames) {
    const name = f.name || `${f.screen} / ${f.state}`;
    const state = f.state && f.name ? `<small>State: ${esc(f.state)}</small>` : '';
    const src = shots < MAX_SHOTS ? await shotFor(d.dir, f.nodeId) : null;
    if (src) {
      shots++;
      figs.push(`<figure class="frame"><img src="${src}" alt="Screenshot: ${esc(name)}"><figcaption>${nodeLink(d, f.nodeId, name)}${state}</figcaption></figure>`);
    } else rest.push(`<li>${nodeLink(d, f.nodeId, name)}${state ? ` ${state}` : ''}</li>`);
  }
  const more = rest.length ? `${figs.length ? '<h3>More frames</h3>' : ''}<ul class="rows">${rest.join('')}</ul>` : '';
  return { id: 'design', title: 'Design', body: (figs.length ? `<div class="grid">${figs.join('')}</div>` : '') + more, count: String(frames.length) };
}

const SEV_ORDER: Record<Severity, number> = { blocking: 0, major: 1, minor: 2 };
const bySeverity = (a: Finding, b: Finding) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity];

const findingRow = (d: Data) => (f: Finding) =>
  `<li>${st(f.severity, SEV_LABEL[f.severity] ?? f.severity)} <strong>${nodeLink(d, f.node, f.nodeName || `Layer ${f.node}`)}</strong>: ${esc(f.rule)}<br><small>Fix: ${esc(f.fix)}</small></li>`;

const RULE_STATE: Record<RuleResult['state'], [Status, string]> = { pass: ['pass', 'Passed'], fail: ['fail', 'Failed'], unchecked: ['none', 'Not checked'] };

const ruleRow = (d: Data) => (r: RuleResult) => {
  const frames = r.state === 'fail' && r.frames.length ? `<br><small>Fails on ${r.frames.map((id) => nodeLink(d, id, id)).join(', ')}</small>` : '';
  return `<li>${st(...RULE_STATE[r.state])} ${esc(r.rule)}${frames}</li>`;
};

const flowCounts = (counts: Partial<Record<FlowRule, number>>) =>
  Object.entries(counts).filter(([, n]) => n).map(([rule, n]) => `${FLOW_RULE_LABEL[rule as FlowRule] ?? rule} ${n}`).join(', ');

function flowPart(d: Data) {
  const flows = d.flow?.flows ?? [];
  if (!flows.length) return '';
  const checked = flows.filter((f) => f.state !== 'unchecked');
  const issues = checked.reduce((n, f) => n + flowIssues(f), 0);
  const rows = flows.map((f) => {
    const n = flowIssues(f);
    const status = f.state === 'unchecked' ? st('none', 'Not checked') : n ? st('fail', plural(n, 'issue')) : st('pass', 'Passed');
    return `<li>${nodeLink(d, f.id, f.name)} ${status}${n ? `<br><small>${esc(flowCounts(f.counts))}</small>` : ''}</li>`;
  });
  return `<h3>Prototype check <small>${issues ? plural(issues, 'issue') : 'No issues'}, ${esc(dayTime(d.flow!.at))}</small></h3><ul class="rows">${rows.join('')}</ul>`;
}

function review(d: Data): Section | null {
  const run = d.run;
  const flow = flowPart(d);
  if (!run && !flow) return null;
  const parts: string[] = [];
  if (run) {
    parts.push(`<p class="meta">Reviewed: ${esc(dayTime(run.at))}, round ${run.round}, ${plural(run.frames.length, 'frame')}</p>`);
    if (run.checkError) parts.push(`<p>${st('error', 'Error')} Design system check: ${esc(run.checkError)}</p>`);
    if (run.check.length) parts.push(`<h3>Design system check <small>${plural(run.check.length, 'finding')}</small></h3><ul class="rows">${[...run.check].sort(bySeverity).map(findingRow(d)).join('')}</ul>`);
    if (run.rulesError) parts.push(`<p>${st('error', 'Error')} House rules: ${esc(run.rulesError)}</p>`);
    if (run.rules?.length) parts.push(`<h3>House rules <small>${esc(rulesLine(run.rules))}</small></h3><ul class="rows">${run.rules.map(ruleRow(d)).join('')}</ul>`);
    const passed = run.results.filter((r) => !r.error && r.pass && !r.findings.length);
    for (const r of run.results.filter((x) => !passed.includes(x))) {
      const name = r.area === 'all' ? 'All areas' : AREA_NAMES[r.area];
      parts.push(`<h3>${esc(name)} ${r.error ? st('error', 'Error') : r.pass ? st('pass', 'Passed') : st('fail', 'Needs work')}</h3>`);
      if (r.error || r.summary) parts.push(`<p>${esc(r.error || r.summary)}</p>`);
      if (r.findings.length) parts.push(`<ul class="rows">${[...r.findings].sort(bySeverity).map(findingRow(d)).join('')}</ul>`);
    }
    if (passed.length) parts.push(`<p class="passed">${st('pass', 'Passed')} ${esc(passed.map((r) => (r.area === 'all' ? 'All areas' : AREA_NAMES[r.area])).join(', '))}</p>`);
    if (!run.check.length && !run.rules?.length && !run.results.length && !run.checkError) parts.push('<p>No findings.</p>');
  }
  parts.push(flow);
  return { id: 'review', title: 'Review', body: parts.join('') };
}

const CRIT_KIND: Record<string, string> = { like: 'Like', concern: 'Concern', idea: 'Idea' };

function crit(d: Data): Section | null {
  const run = d.crit;
  if (!run || (!run.summary && !run.personas.length)) return null;
  const parts = [run.summary ? `<p>${esc(run.summary)}</p>` : ''];
  for (const p of run.personas) {
    parts.push(`<h3>${esc(PERSONA_NAMES[p.id] ?? p.id)}</h3>${p.verdict ? `<p>${esc(p.verdict)}</p>` : ''}`);
    if (p.points.length) parts.push(`<ul>${p.points.map((x) => `<li><strong>${esc(CRIT_KIND[x.kind] ?? x.kind)}</strong>: ${esc(x.text)}</li>`).join('')}</ul>`);
  }
  return { id: 'crit', title: 'Crit', body: parts.join('') };
}

function copy(d: Data): Section | null {
  const run = d.copy;
  if (!run?.items.length) return null;
  const rows = run.items.map((i) => `<tr><td data-label="Before">${esc(i.before)}</td><td data-label="After">${esc(i.after)}</td><td data-label="Why">${esc(i.reason)}</td></tr>`).join('');
  return { id: 'copy', title: 'Copy changes', body: `<table class="copy"><thead><tr><th scope="col">Before</th><th scope="col">After</th><th scope="col">Why</th></tr></thead><tbody>${rows}</tbody></table>`, count: String(run.items.length) };
}

/** The goal in one paragraph: the text under a "Goal" heading, or the first paragraph of the brief. */
export function briefLede(plan: string): string {
  const lines = plan.split(/\r?\n/).map((l) => l.trim());
  const isHeading = (l: string) => /^#{1,6}\s/.test(l);
  const isText = (l: string) => !!l && !isHeading(l) && !/^(?:[-*+]|\d+[.)])\s/.test(l) && !l.startsWith('![');
  const goal = lines.findIndex((l) => /^#{1,6}\s+(goals?|problem|summary|overview)\b/i.test(l));
  const firstText = (from: number) => {
    for (let i = from; i < lines.length; i++) {
      if (isText(lines[i])) return i;
      if (from > 0 && isHeading(lines[i])) return -1;
    }
    return -1;
  };
  const inGoal = goal >= 0 ? firstText(goal + 1) : -1;
  const start = inGoal >= 0 ? inGoal : firstText(0);
  if (start < 0) return '';
  const para: string[] = [];
  for (const l of lines.slice(start)) {
    if (!isText(l)) break;
    para.push(l);
  }
  const text = para.join(' ').replace(/\s+/g, ' ').replace(/[*`]/g, '').trim();
  return text.length > LEDE_MAX ? `${text.slice(0, LEDE_MAX - 1).trimEnd()}…` : text;
}

function summary(d: Data, frames: string[]) {
  const facts: string[] = [];
  const fact = (k: string, v: string) => facts.push(`<div><dt>${esc(k)}:</dt><dd>${v}</dd></div>`);
  if (d.figma) fact('Figma file', `<a class="file" href="${esc(d.figma.url)}">Open in Figma</a>`);
  if (frames.length) {
    const screens = new Set((d.design?.frames ?? []).map((f) => f.screen).filter(Boolean)).size;
    fact('Frames', esc(`${plural(frames.length, 'frame')}${screens ? `, ${plural(screens, 'screen')}` : ''}`));
  }
  const stage = stageLabel(d.approvals);
  if (stage) fact('Stage', esc(stage === 'Shipped' ? 'Shipped' : stage));
  const scope = d.scope.flows.length ? plural(d.scope.flows.length, 'flow') : '';
  if (scope) fact('Scope', esc(`${scope}${d.scope.parked.length ? `, ${d.scope.parked.length} parked` : ''}`));

  const strip = stage
    ? `<ol class="stages" aria-label="Stages">${STAGE_IDS.map((id) => {
        const approved = !!d.approvals[id];
        const current = !approved && STAGE_INFO[id].name === stage;
        return `<li>${st(approved ? 'pass' : current ? 'current' : 'none', STAGE_INFO[id].name)}<small>${approved ? 'Approved' : current ? 'Current' : 'Later'}</small></li>`;
      }).join('')}</ol>`
    : '';

  let issues = '';
  if (frames.length || d.run || d.flow) {
    const lines: string[] = [];
    if (d.run) {
      const all = [...d.run.check, ...d.run.results.flatMap((r) => r.findings)];
      const open = toFix(d.run);
      const n = (s: Severity) => open.filter((f) => f.severity === s).length;
      const minor = all.filter((f) => f.severity === 'minor').length;
      const tile = (kind: Severity, count: number) => `<li class="tile"><span class="num">${count}</span>${st(count ? kind : 'none', SEV_LABEL[kind])}</li>`;
      lines.push(`<ul class="tiles">${tile('blocking', n('blocking'))}${tile('major', n('major'))}${tile('minor', minor)}</ul>`);
      const facts2: string[] = [];
      if (d.run.rules?.length) {
        const r = rulesSummary(d.run.rules);
        facts2.push(`<li>${r.failed ? st('fail', 'House rules:') : st('pass', 'House rules:')} ${esc(rulesLine(d.run.rules))}</li>`);
      }
      if (d.flow?.flows.length) facts2.push(`<li>${flowLine(d.flow)}</li>`);
      else facts2.push(`<li>${st('none', 'Prototype check:')} Not run yet</li>`);
      lines.push(`<ul class="lines">${facts2.join('')}</ul>`);
    } else {
      lines.push(`<ul class="lines"><li>${st('none', 'Review:')} Not run yet</li><li>${d.flow?.flows.length ? flowLine(d.flow) : `${st('none', 'Prototype check:')} Not run yet`}</li></ul>`);
    }
    if (d.run || d.flow?.flows.length) lines.push('<p><a href="#review">See every issue in Review</a></p>');
    issues = `<h3>Open issues</h3>${lines.join('')}`;
  }

  const lede = briefLede(d.plan);
  const body = `${lede ? `<p class="lede">${esc(lede)}</p>` : ''}${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}${strip}${issues}`;
  return `<section id="summary" class="summary"><h2>Summary</h2>${body}</section>`;
}

function flowLine(run: FlowCheckRun) {
  const checked = run.flows.filter((f) => f.state !== 'unchecked');
  const failing = checked.filter((f) => flowIssues(f) > 0);
  const issues = failing.reduce((n, f) => n + flowIssues(f), 0);
  if (!checked.length) return `${st('none', 'Prototype check:')} No flows checked`;
  return failing.length
    ? `${st('fail', 'Prototype check:')} ${esc(`${plural(issues, 'issue')} in ${failing.length} of ${plural(checked.length, 'flow')}`)}`
    : `${st('pass', 'Prototype check:')} ${esc(checked.length === 1 ? 'The flow passed' : `All ${checked.length} flows passed`)}`;
}

const STYLE = `
:root {
  --accent: #b5573a; --bg: #faf9f5; --surface: #fff; --text: #2b2926; --muted: #66615a; --line: #e4e0d4; --soft: #f0ede3;
  --red: #a8321f; --amber: #a86f00; --green: #2e6b41;
  color-scheme: light;
}
*, ::before, ::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/24px system-ui, -apple-system, 'Segoe UI', sans-serif; overflow-wrap: break-word; }
.page { max-width: 808px; margin: 0 auto; padding: 48px 24px 80px; }
h1, h2, h3, h4, h5, h6 { font-family: ui-serif, Georgia, serif; font-weight: 600; }
h1 { font-size: 32px; line-height: 40px; margin: 0 0 8px; }
h2 { font-size: 24px; line-height: 32px; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 8px; margin: 0 0 16px; }
h3 { font-size: 18px; line-height: 24px; margin: 24px 0 8px; }
h4, h5, h6 { font-size: 16px; line-height: 24px; margin: 16px 0 4px; }
h3 small { font: 14px/20px system-ui, sans-serif; color: var(--muted); margin-left: 8px; }
p, ul, ol { margin: 0 0 12px; }
ul, ol { padding-left: 24px; }
li + li { margin-top: 4px; }
section { margin-top: 48px; scroll-margin-top: 24px; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
code { background: var(--soft); padding: 0 4px; border-radius: 4px; font-size: 14px; }
small, .meta { color: var(--muted); font-size: 14px; line-height: 20px; }
.eyebrow { margin: 0 0 4px; color: var(--muted); font-size: 14px; line-height: 20px; }
header .meta { margin: 0; }
nav.toc { margin-top: 24px; font-size: 14px; line-height: 20px; }
nav.toc p { display: inline; margin: 0 8px 0 0; color: var(--muted); }
nav.toc ol { display: inline; list-style: none; padding: 0; margin: 0; }
nav.toc li { display: inline-block; margin: 0 16px 4px 0; }
nav.toc small { margin-left: 4px; }

.summary { margin-top: 32px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
.summary h2 { border: 0; padding: 0; margin-bottom: 12px; }
.summary h3 { margin-top: 24px; }
.lede { font-size: 18px; line-height: 28px; margin-bottom: 16px; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px 24px; margin: 0; }
.facts dt { color: var(--muted); font-size: 14px; line-height: 20px; }
.facts dd { margin: 0; }
.stages { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 20px 0 0; }
.stages li { margin: 0; flex: 1 1 96px; border-top: 4px solid var(--line); padding-top: 8px; }
.stages li:has(.pass) { border-top-color: var(--green); }
.stages li:has(.current) { border-top-color: var(--accent); }
.stages small { display: block; padding-left: 18px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; list-style: none; padding: 0; margin: 0 0 12px; }
.tile { margin: 0 !important; border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
.tile .num { display: block; font-size: 24px; line-height: 32px; font-weight: 600; }
.lines { list-style: none; padding: 0; }

.st { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; line-height: 20px; color: var(--text); white-space: nowrap; }
.st::before { content: ''; flex: none; width: 12px; height: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.st.blocking::before, .st.error::before { background: var(--red); border-radius: 2px; }
.st.major::before, .st.fail::before { background: var(--amber); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.st.minor::before { border: 2px solid var(--muted); border-radius: 50%; }
.st.pass::before { background: var(--green); border-radius: 50%; }
.st.none::before { background: linear-gradient(var(--muted), var(--muted)) center / 12px 2px no-repeat; }
.st.current::before { background: var(--accent); transform: rotate(45deg) scale(0.8); }
h3 .st { margin-left: 8px; vertical-align: 2px; font-family: system-ui, sans-serif; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
figure { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; break-inside: avoid; }
figure.chosen { border-color: var(--green); box-shadow: 0 0 0 1px var(--green); }
figure img { width: 100%; height: auto; display: block; border-radius: 4px; }
figure.frame img { max-height: 560px; object-fit: contain; object-position: top; background: var(--soft); }
figcaption { margin-top: 8px; font-size: 14px; line-height: 20px; }
figcaption small { display: block; margin-top: 4px; }
figcaption .st { margin-left: 4px; }
.rows { list-style: none; padding: 0; }
.rows li { margin: 0; padding: 12px 0; border-bottom: 1px solid var(--line); }
.rows li:first-child { padding-top: 4px; }
.rows li > small { display: inline-block; margin-top: 4px; }
.passed { color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 20px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; }
.empty { margin-top: 32px; }
footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--line); }
footer p { margin: 0; }

@media (min-width: 1200px) {
  .page { max-width: 1104px; display: grid; grid-template-columns: 200px minmax(0, 760px); column-gap: 64px; justify-content: center; }
  .page > * { grid-column: 2; }
  .page > nav.toc { grid-column: 1; grid-row: 1 / span 3; align-self: start; position: sticky; top: 48px; margin-top: 0; padding-top: 4px; }
  nav.toc p { display: block; margin: 0 0 8px; font-weight: 600; }
  nav.toc ol { display: block; }
  nav.toc li { display: block; margin: 0 0 8px; }
}
@media (max-width: 600px) {
  .page { padding: 32px 16px 64px; }
  h1 { font-size: 28px; line-height: 36px; }
  .summary { padding: 16px; }
  .tile { padding: 8px 12px; }
  table.copy thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.copy, table.copy tbody, table.copy tr, table.copy td { display: block; }
  table.copy tr { padding: 8px 0; border-bottom: 1px solid var(--line); }
  table.copy td { border: 0; padding: 4px 0; }
  table.copy td::before { content: attr(data-label) ': '; color: var(--muted); font-weight: 600; }
}
@media print {
  @page { margin: 16mm; }
  body { background: #fff; font-size: 12pt; line-height: 1.45; }
  .page { max-width: none; padding: 0; display: block; }
  nav.toc, footer { display: none; }
  .summary { break-inside: avoid; border-color: #ccc; }
  section { margin-top: 32px; }
  h2, h3 { break-after: avoid; }
  li, tr, figure { break-inside: avoid; }
  .grid { grid-template-columns: repeat(3, 1fr); }
  figure img, figure.frame img { max-height: 320px; object-fit: contain; object-position: top; }
  .facts > div:first-child:has(a.file) { grid-column: 1 / -1; }
  a.file::after { content: ' (' attr(href) ')'; color: var(--muted); }
}
`;

export const reportSlug = (figma: FigmaFile | null) => (figma?.name ?? 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';

async function load(dir: string, figma: FigmaFile | null): Promise<Data> {
  const [plan, researchMd, scopeDoc, sketch, approvals, designDoc, reviewDoc, flows, critRuns, copyRuns] = await Promise.all([
    read(path.join(dir, 'plan.md')),
    read(path.join(dir, 'research.md')),
    readScope(dir),
    readSketch(dir).catch(() => null),
    readApprovals(dir),
    readDesign(dir),
    readReview(dir).catch(() => ({ runs: [] })),
    readFlowChecks(dir).catch(() => []),
    readCrit(dir).catch(() => []),
    readCopy(dir).catch(() => []),
  ]);
  return {
    dir,
    figma,
    plan: plan?.trim() ?? '',
    research: researchMd?.trim() ?? '',
    scope: scopeDoc,
    sketch,
    approvals,
    design: designDoc,
    run: reviewDoc.runs?.at(-1),
    flow: figma ? flows.filter((r) => r.fileKey === figma.key).at(-1) : undefined,
    crit: critRuns.at(-1),
    copy: copyRuns.at(-1),
  };
}

export async function buildReport(dir: string, figma: FigmaFile | null): Promise<string> {
  const title = figma?.name || path.basename(dir);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const d = await load(dir, figma);
  // Older chats only list frames on their review runs.
  const frames = d.design?.frames.length ? d.design.frames.map((f) => f.nodeId) : (d.run?.frames ?? []);
  const sections = (await Promise.all([brief(d), research(d), scope(d), sketches(d), decisions(d), design(d), review(d), crit(d), copy(d)])).filter((s): s is Section => !!s);
  const toc = sections.length >= 3
    ? `<nav class="toc" aria-label="Contents"><p>Contents</p><ol><li><a href="#summary">Summary</a></li>${sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a>${s.count ? `<small>${esc(s.count)}</small>` : ''}</li>`).join('')}</ol></nav>`
    : '';
  const content = sections.length || figma
    ? summary(d, frames) + sections.map(section).join('\n')
    : '<p class="empty">Nothing to hand off yet. Write a brief or design some frames in Design Studio, then open the report again.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} design report</title><style>${STYLE}</style></head><body><div class="page"><header><p class="eyebrow">Design handoff</p><h1>${esc(title)}</h1><p class="meta">Date: ${esc(date)}</p></header>${toc}<main>${content}</main><footer><p class="meta">Made with Design Studio</p></footer></div></body></html>`;
}
