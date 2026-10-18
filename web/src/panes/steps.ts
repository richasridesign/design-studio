import { editCount, type EditCount } from '../../../shared/edits';
import type { ChatEvent } from '../../../shared/protocol';

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
  | { kind: 'review'; id: string; runAt: number };

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
    case 'Bash': return { verb: 'Ran', object: firstLine(s('command')), mono: true };
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
    return { verb: 'Called', object: `${tool.join('__')} (${server})` };
  }
  return { verb: 'Used', object: name };
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
    else if (e.kind === 'assistant') { if (e.text.trim()) items.push({ kind: 'assistant', id: e.id, text: e.text, streaming: e.streaming }); }
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
      if (it.kind === 'assistant') final = i;
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
