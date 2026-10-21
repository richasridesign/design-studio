import { editCount, type EditCount } from '../../../shared/edits';
import type { ChatEvent } from '../../../shared/protocol';
import { parseReport, type Report } from '../../../shared/longRun';

export type ToolUse = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;

export type Item =
  | { kind: 'user'; id: string; text: string; at: number; stopping?: boolean }
  | { kind: 'phase'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'step'; id: string; use: ToolUse; result?: ToolResult }
  | { kind: 'file'; id: string; path: string; count: EditCount; uses: ToolUse[]; error?: string }
  | { kind: 'agent'; id: string; use: ToolUse; result?: ToolResult }
  | { kind: 'done'; id: string; text: string; nodes: Array<[string, number]> }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'review'; id: string; runAt: number }
  | { kind: 'report'; id: string; report: Report };

export type Block = Item | { kind: 'steps'; id: string; items: Item[]; count: number; ms: number };
export type Turn = { id: string; blocks: Block[] };

export type Label = { verb: string; object: string; mono?: boolean };

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const BIG_BRO = 'big-bro';

export const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

export function relPath(p: string, cwd: string) {
  if (!cwd) return p;
  if (p === cwd) return '.';
  return p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
}

export function duration(ms: number) {
  if (!(ms >= 1000)) return '';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function stepLabel(name: string, input: Record<string, unknown>, cwd = ''): Label {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const rel = (k: string) => relPath(s(k), cwd);
  const inDir = s('path') && rel('path') !== '.' ? rel('path') : '';
  switch (name) {
    case 'Read': return { verb: 'Read', object: rel('file_path') };
    case 'Edit': case 'MultiEdit': return { verb: 'Edited', object: rel('file_path') };
    case 'NotebookEdit': return { verb: 'Edited', object: rel('notebook_path') };
    case 'Write': return { verb: 'Wrote', object: rel('file_path') };
    case 'Grep': return { verb: 'Searched', object: `"${s('pattern')}" in ${inDir || 'the project'}` };
    case 'Glob': return { verb: 'Listed', object: inDir ? `${inDir}/${s('pattern')}` : s('pattern') };
    case 'LS': return { verb: 'Listed', object: `${inDir || '.'}/` };
    case 'Bash': return s('description') ? { verb: 'Ran', object: s('description') } : { verb: 'Ran', object: firstLine(s('command')), mono: true };
    case 'WebFetch': return { verb: 'Fetched', object: s('url').replace(/^https?:\/\//, '').replace(/\/$/, '') };
    case 'WebSearch': return { verb: 'Searched the web for', object: `"${s('query')}"` };
    case 'Agent': case 'Task': return { verb: 'Delegated', object: s('description') };
    case 'TodoWrite': return { verb: 'Updated', object: 'the to-do list' };
    case 'AskUserQuestion': return { verb: 'Asked', object: 'you a question' };
    case 'Skill': return { verb: 'Loaded', object: `the ${s('skill')} skill` };
    case 'ToolSearch': return { verb: 'Looked up', object: `tools for "${s('query')}"` };
    case 'Advisor': return { verb: 'Consulted', object: 'the advisor' };
    case 'ExitPlanMode': return { verb: 'Proposed', object: 'a plan' };
    case 'EnterPlanMode': return { verb: 'Entered', object: 'plan mode' };
  }
  if (name.startsWith('mcp__')) {
    const [, server, ...tool] = name.split('__');
    const figma = /figma/i.test(server) ? figmaLabel(tool.join('__'), s) : null;
    if (figma) return figma;
    return { verb: 'Called', object: `${tool.join('__')} (${server})` };
  }
  return { verb: 'Used', object: name };
}

const nodeOf = (s: (k: string) => string) => (s('nodeId') ? ` ${s('nodeId').replace('-', ':')}` : '');

/** Plain words for Figma tool calls, so a designer reads what happened in the file. */
function figmaLabel(tool: string, s: (k: string) => string): Label | null {
  switch (tool) {
    case 'use_figma': return { verb: 'Worked in', object: s('description') ? `Figma: ${s('description')}` : 'Figma' };
    case 'get_screenshot': return { verb: 'Took', object: `a screenshot of frame${nodeOf(s)}` };
    case 'get_metadata': return { verb: 'Read', object: `the layers of${nodeOf(s) || ' the page'}` };
    case 'get_design_context': return { verb: 'Read', object: `the design of${nodeOf(s) || ' the selection'}` };
    case 'get_variable_defs': return { verb: 'Read', object: 'the variables' };
    case 'search_design_system': return { verb: 'Searched', object: `the design system for "${s('query')}"` };
    case 'get_libraries': return { verb: 'Listed', object: 'the libraries' };
    case 'upload_assets': return { verb: 'Uploaded', object: 'images to Figma' };
    case 'generate_figma_design': return { verb: 'Generated', object: 'a design in Figma' };
    case 'create_new_file': return { verb: 'Created', object: s('fileName') ? `the Figma file "${s('fileName')}"` : 'a Figma file' };
    case 'get_figjam': return { verb: 'Read', object: 'the FigJam board' };
    case 'generate_diagram': return { verb: 'Drew', object: 'a diagram in FigJam' };
    case 'whoami': return { verb: 'Checked', object: 'the Figma account' };
  }
  return null;
}

export function buildTranscript(events: ChatEvent[]): Item[] {
  const results = new Map<string, ToolResult>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const items: Item[] = [];
  const seen = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'tool_use' && e.name.endsWith('__set_status')) {
      const ids = Array.isArray(e.input.nodes) ? e.input.nodes.filter((x): x is string => typeof x === 'string').slice(-3) : [];
      const nodes = ids.map((id): [string, number] => {
        const rev = (seen.get(id) ?? 0) + 1;
        seen.set(id, rev);
        return [id, rev];
      });
      const done = typeof e.input.done === 'string' ? e.input.done.trim() : '';
      const note = typeof e.input.important === 'string' ? e.input.important.trim() : '';
      if (done) items.push({ kind: 'done', id: e.id, text: done, nodes });
      if (note) items.push({ kind: 'note', id: `${e.id}:note`, text: note });
    }
    else if (e.kind === 'user') items.push(e.phase ? { kind: 'phase', id: e.id, text: e.text } : { kind: 'user', id: e.id, text: e.text, at: e.at, stopping: e.stopping });
    else if (e.kind === 'assistant') {
      const report = e.streaming ? null : parseReport(e.text);
      if (report) items.push({ kind: 'report', id: e.id, report });
      else if (e.text.trim()) items.push({ kind: 'assistant', id: e.id, text: e.text, streaming: e.streaming });
    }
    else if (e.kind === 'system') items.push({ kind: 'system', id: e.id, text: e.text });
    else if (e.kind === 'review') items.push({ kind: 'review', id: e.id, runAt: e.runAt });
    else if (e.kind === 'plan') items.push({ kind: 'system', id: e.id, text: e.next.length ? `You changed the next steps (${e.next.length})` : 'You cleared the next steps' });
    else if (e.kind === 'tool_use') {
      const result = results.get(e.id);
      const count = editCount(e.name, e.input);
      const path = typeof e.input.file_path === 'string' ? e.input.file_path : '';
      if (AGENT_TOOLS.has(e.name)) items.push({ kind: 'agent', id: e.id, use: e, result });
      else if (!count || !path) items.push({ kind: 'step', id: e.id, use: e, result });
      else {
        const error = result?.isError ? firstLine(result.text) : undefined;
        const prev = items[items.length - 1];
        if (!error && prev?.kind === 'file' && prev.path === path && !prev.error) {
          prev.uses.push(e);
          prev.count = { add: prev.count.add + count.add, del: prev.count.del + count.del };
        } else items.push({ kind: 'file', id: e.id, path, count: error ? { add: 0, del: 0 } : count, uses: [e], error });
      }
    }
  }
  return items;
}

const isTool = (it: Item) => it.kind === 'step' || it.kind === 'file' || it.kind === 'agent';
const isFable = (it: Item) => it.kind === 'agent' && it.use.input.subagent_type === BIG_BRO;

function span(items: Item[]) {
  const times: number[] = [];
  for (const it of items) {
    if (it.kind === 'file') times.push(...it.uses.map((u) => u.at));
    else if (it.kind === 'step' || it.kind === 'agent') times.push(it.use.at, ...(it.result ? [it.result.at] : []));
  }
  return times.length ? Math.max(...times) - Math.min(...times) : 0;
}

export function groupTurns(items: Item[]): Turn[] {
  const segs: Item[][] = [];
  for (const it of items) {
    if (it.kind === 'user' || it.kind === 'phase' || !segs.length) segs.push([it]);
    else segs[segs.length - 1].push(it);
  }
  return segs.map((seg) => {
    let final = -1;
    let lastTool = -1;
    seg.forEach((it, i) => {
      if (it.kind === 'assistant' || it.kind === 'report') final = i;
      if (isTool(it) && !isFable(it)) lastTool = i;
    });
    const inside = seg.filter((it, i) => (isTool(it) && !isFable(it)) || (it.kind === 'assistant' && i !== final));
    const tools = inside.filter(isTool);
    if (!tools.length) return { id: seg[0].id, blocks: seg };
    const finalItem = final > lastTool ? seg[final] : undefined;
    const blocks: Block[] = seg.filter((it) => !inside.includes(it));
    const group: Block = { kind: 'steps', id: `${tools[0].id}:steps`, items: inside, count: tools.length, ms: span(tools) };
    blocks.splice(finalItem ? blocks.indexOf(finalItem) : blocks.length, 0, group);
    return { id: seg[0].id, blocks };
  });
}

const QUIET = /^(Permission mode:|Session started with|Long run · turn \d+$)/;

/** Per turn: the prompt, done lines, notes, reviews, notices and the latest reply. Tool steps are left out. */
export function timelineTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  for (const it of items) {
    if (it.kind === 'user' || it.kind === 'phase' || !turns.length) turns.push({ id: it.id, blocks: [] });
    const blocks = turns[turns.length - 1].blocks;
    if (isTool(it) || (it.kind === 'system' && QUIET.test(it.text))) continue;
    if (it.kind === 'assistant') {
      const prev = blocks.findIndex((b) => b.kind === 'assistant');
      if (prev >= 0) blocks.splice(prev, 1);
    }
    blocks.push(it);
  }
  return turns.filter((t) => t.blocks.length);
}

/** Where to start so only the last `keep` prompts show, and how many earlier prompts that hides. */
export function recentTurns(turns: Turn[], keep = 3) {
  const starts = turns.flatMap((t, i) => (t.blocks[0]?.kind === 'user' ? [i] : []));
  return starts.length > keep ? { from: starts[starts.length - keep], hidden: starts.length - keep } : { from: 0, hidden: 0 };
}

const ABBR = /\b(e\.g|i\.e|etc|vs|approx|incl)\.$/i;
const URL_RE = /<?https?:\/\/[^\s<>]+/g;

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** One markdown line as plain text: no heading, list or quote marks, no emphasis, links as their words. */
function plainLine(raw: string, frame: (url: string) => string | null) {
  let s = raw.trim();
  if (/^\|.*\|$/.test(s) || /^([-*_]\s*){3,}$/.test(s)) return '';
  s = s.replace(/^#{1,6}\s+/, '').replace(/^(>\s?)+/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_, words: string, url: string) => frame(url) ?? words);
  s = s.replace(URL_RE, (m) => {
    const url = m.replace(/^</, '').replace(/>$/, '');
    const clean = url.replace(/[.,;:!?)]+$/, '');
    return (frame(clean) ?? hostOf(clean)) + url.slice(clean.length);
  });
  s = s.replace(/`+([^`]*)`+/g, '$1').replace(/`/g, '');
  s = s.replace(/\*\*|__|~~/g, '');
  s = s.replace(/(^|[^\w*])\*(\S[^*]*?)\*(?!\w)/g, '$1$2').replace(/(^|\s)\*(?=\S)/g, '$1');
  s = s.replace(/(^|[^\w])_(\S[^_]*?)_(?!\w)/g, '$1$2');
  return s.replace(/\s+/g, ' ').trim();
}

function firstSentence(s: string) {
  const end = /[.!?]+["')\]]*(?=\s|$)/g;
  for (let m = end.exec(s); m; m = end.exec(s)) {
    const head = s.slice(0, m.index + m[0].length);
    if (!ABBR.test(head)) return head;
  }
  return s;
}

function clip(s: string, max: number) {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max - 1);
  return `${s.slice(0, cut > max / 2 ? cut : max - 1).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * Claude's reply in one plain line for the timeline: the first sentence of its first line of text, at most `max`
 * characters. `more` says the full reply has more to show. `frame` names a Figma frame link, so no raw URL shows.
 */
export function replySummary(text: string, frame: (url: string) => string | null = () => null, max = 140): { text: string; more: boolean } {
  const lines: string[] = [];
  let fence = false;
  let code = false;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; code = true; continue; }
    if (fence) continue;
    const line = plainLine(raw, frame);
    if (line) lines.push(line);
  }
  if (!lines.length) return { text: '', more: code };
  const line = clip(firstSentence(lines[0]), max);
  return { text: line, more: code || line !== lines.join(' ') };
}

/**
 * A turn's steps in a few plain words, as the Claude app says them ("Read 3 files, worked in Figma"). Kinds keep the
 * order they first ran in, and at most three are named.
 */
export function stepsSummary(items: Item[]): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    const name = it.kind === 'step' || it.kind === 'agent' ? it.use.name : it.kind === 'file' ? 'Edit' : null;
    if (!name) continue;
    const kind = name === 'Read' ? 'read' : ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name) ? 'edit'
      : ['Grep', 'Glob', 'LS'].includes(name) ? 'search' : name === 'Bash' ? 'run' : name === 'WebFetch' ? 'fetch'
        : name === 'WebSearch' ? 'web' : AGENT_TOOLS.has(name) ? 'agent' : /^mcp__.*figma/i.test(name) ? 'figma' : 'tool';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
  const say: Record<string, (k: number) => string> = {
    read: (k) => `read ${n(k, 'a file', 'files')}`,
    edit: (k) => `edited ${n(k, 'a file', 'files')}`,
    search: () => 'searched the project',
    run: (k) => `ran ${n(k, 'a command', 'commands')}`,
    fetch: (k) => `fetched ${n(k, 'a page', 'pages')}`,
    web: () => 'browsed the web',
    agent: (k) => `asked ${n(k, 'a helper', 'helpers')}`,
    figma: () => 'worked in Figma',
    tool: (k) => `used ${n(k, 'a tool', 'tools')}`,
  };
  const parts = [...counts].slice(0, 3).map(([k, c]) => say[k](c));
  const line = parts.join(', ') + (counts.size > 3 ? ' and more' : '');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
