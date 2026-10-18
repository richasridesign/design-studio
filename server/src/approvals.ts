import { randomUUID } from 'node:crypto';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PendingRequest, ServerMessage, ServerState } from '../../shared/protocol.js';

type Waiting = { resolve: (r: PermissionResult) => void; input: Record<string, unknown>; suggestions?: PermissionUpdate[] };

export type AskOptions = {
  suggestions?: PermissionUpdate[];
  title?: string;
  description?: string;
  decisionReason?: string;
  defaultToNo?: boolean;
  suppressAlwaysAllowRule?: boolean;
  signal: AbortSignal;
};

export function permissionTitle(toolName: string, input: Record<string, unknown>) {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  const file = (s('file_path') || s('notebook_path')).split('/').pop();
  switch (toolName) {
    case 'ExitPlanMode': return 'Approve the plan to start building';
    case 'Bash': return s('description') || 'Run a shell command';
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return file ? `Edit ${file}` : 'Edit a file';
    case 'Write': return file ? `Write ${file}` : 'Write a file';
    case 'Read': return file ? `Read ${file}` : 'Read a file';
    case 'WebSearch': return s('query') ? `Search the web for "${s('query')}"` : 'Search the web';
    case 'WebFetch': try { return `Fetch a page from ${new URL(s('url')).hostname}`; } catch { return 'Fetch a web page'; }
  }
  if (toolName.startsWith('mcp__')) {
    const [, server, tool = ''] = toolName.split('__');
    return `Use ${tool.replace(/_/g, ' ')} from ${server}`;
  }
  return `Use ${toolName}`;
}

/**
 * An approval with words ("go, keep the voice button", "A"): the note rides on the approved plan, so Claude
 * builds with it in the same round instead of asking again. Other tools keep their input as it was.
 */
export function withNote(input: Record<string, unknown>, note?: string): Record<string, unknown> {
  if (!note || typeof input.plan !== 'string') return input;
  return { ...input, plan: `${input.plan}\n\n## Approved with this note from the designer\n${note}` };
}

export class Approvals {
  private waiting = new Map<string, Waiting>();

  constructor(private state: ServerState, private emit: (m: ServerMessage) => void) {}

  ask(toolName: string, input: Record<string, unknown>, opts: AskOptions): Promise<PermissionResult> {
    const id = randomUUID();
    const req: PendingRequest =
      toolName === 'AskUserQuestion'
        ? { id, kind: 'question', questions: (input as any).questions ?? [] }
        : {
            id,
            kind: 'permission',
            toolName,
            title: (toolName !== 'ExitPlanMode' && opts.title) || permissionTitle(toolName, input),
            detail: opts.description || opts.decisionReason || undefined,
            input,
            canAlwaysAllow: Boolean(opts.suggestions?.length) && !opts.suppressAlwaysAllowRule,
            confirmFirst: opts.defaultToNo || undefined,
          };

    this.state.pending.push(req);
    this.emit({ type: 'pending', request: req });

    return new Promise<PermissionResult>((resolve) => {
      this.waiting.set(id, { resolve, input, suggestions: opts.suggestions });
      opts.signal.addEventListener('abort', () => {
        this.finish(id);
        resolve({ behavior: 'deny', message: 'aborted' });
      });
    });
  }

  /**
   * Picked options go in answers. Words she typed instead of picking go in response, the free text field
   * Claude Code's question tool reads: Claude then sees "The user responded: ..." instead of one question's answer.
   */
  answerQuestion(id: string, answers: Record<string, string>, response?: string) {
    const w = this.finish(id);
    const said = response?.trim().slice(0, 4000);
    w?.resolve({ behavior: 'allow', updatedInput: { ...w.input, answers, ...(said ? { response: said } : {}) } });
  }

  answerPermission(id: string, allow: boolean, always?: boolean, note?: string) {
    const w = this.finish(id);
    if (!w) return;
    const said = note?.trim().slice(0, 4000);
    if (!allow) w.resolve({ behavior: 'deny', message: said ? `The designer wants changes before you go on: ${said}` : 'User denied this action in the Design Studio UI.' });
    else w.resolve({ behavior: 'allow', updatedInput: withNote(w.input, said), updatedPermissions: always ? w.suggestions : undefined });
  }

  denyAll() {
    for (const w of this.waiting.values()) w.resolve({ behavior: 'deny', message: 'Session closed' });
    this.waiting.clear();
  }

  private finish(id: string) {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    this.state.pending = this.state.pending.filter((p) => p.id !== id);
    this.emit({ type: 'resolved', id });
    return w;
  }
}
