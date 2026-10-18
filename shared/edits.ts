import type { ChatEvent } from './protocol.js';

export type EditCount = { add: number; del: number };

const lines = (v: unknown) => (typeof v === 'string' && v.length ? v.split('\n').length : 0);

export function editCount(name: string, input: Record<string, unknown>): EditCount | null {
  if (name === 'Write') return { add: lines(input.content), del: 0 };
  if (name === 'Edit') return { add: lines(input.new_string), del: lines(input.old_string) };
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
    return edits.reduce<EditCount>((n, e) => ({ add: n.add + lines(e.new_string), del: n.del + lines(e.old_string) }), { add: 0, del: 0 });
  }
  return null;
}

export function failedTools(events: ChatEvent[]) {
  const failed = new Set<string>();
  for (const e of events) if (e.kind === 'tool_result' && e.isError) failed.add(e.toolUseId);
  return failed;
}

export function sumEdits(events: ChatEvent[]): EditCount | undefined {
  const failed = failedTools(events);
  let total: EditCount | undefined;
  for (const e of events) {
    if (e.kind !== 'tool_use' || failed.has(e.id)) continue;
    const c = editCount(e.name, e.input);
    if (c) total = { add: (total?.add ?? 0) + c.add, del: (total?.del ?? 0) + c.del };
  }
  return total;
}

export function replyLine(events: ChatEvent[], max = 60): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'assistant' || !e.text.trim()) continue;
    const line = e.text.trim().split('\n')[0].replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return undefined;
}
