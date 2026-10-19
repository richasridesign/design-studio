import { MODELS } from './design.js';
import { DEFAULT_WEEKLY_CAP } from './longRun.js';

// A project task runs one prompt across several flows of one iteration: one chat per flow, a few at a time, the
// rest waiting their turn. Pure types and helpers, shared by the server (tasks.ts) and the task card.

export type TaskFlowState = 'waiting' | 'running' | 'needs_you' | 'done' | 'failed' | 'stopped';
export type TaskState = 'running' | 'paused' | 'done' | 'stopped';
export type PauseReason = 'weekly' | 'user' | 'restart' | 'components' | 'section';

export type TaskFlow = {
  slug: string;
  n: number;
  name: string;
  state: TaskFlowState;
  /** The model the chat was asked to use, then the one it reported when it started. */
  model: string;
  cwd?: string;
  /** The live chat while it is open, and Claude's session id so a closed chat can be opened again. */
  chatId?: string;
  sessionId?: string;
  tokens: number;
  costUsd: number;
  startedAt?: number;
  endedAt?: number;
  note?: string;
};

export type Task = {
  id: string;
  /** The project root (the folder with figma.json). */
  root: string;
  key: string;
  iteration: string;
  prompt: string;
  model: string;
  cap: number;
  componentsFirst: boolean;
  /** The serial shared-component step, run before the flows when componentsFirst is on. */
  components: TaskFlow | null;
  flows: TaskFlow[];
  state: TaskState;
  reason?: PauseReason;
  /** The weekly usage when the task paused at the cap. */
  pausedAt?: number;
  /** The iteration has no Figma section yet: flows run one at a time until the map shows one. */
  needsSection?: boolean;
  /** How many of those single runs were checked for the section. */
  leads?: number;
  createdAt: number;
  updatedAt: number;
};

export const COMPONENTS_SLUG = 'components';
export const DEFAULT_PARALLEL = 3;
export const MAX_PARALLEL = 6;
export const TASK_CAP = DEFAULT_WEEKLY_CAP;
export const MAX_TASK_PROMPT = 4000;

/** Models a task chat can run on. Sonnet first: it is the default for runs across flows. */
export const TASK_MODELS = [
  { value: MODELS.work, label: 'Sonnet', hint: 'Default. Faster and uses less of the weekly limit' },
  { value: MODELS.plan, label: 'Opus', hint: 'For harder changes. Uses the weekly limit faster' },
] as const;
export const DEFAULT_TASK_MODEL: string = MODELS.work;

export const taskModel = (m: unknown): string => (TASK_MODELS.some((x) => x.value === m) ? String(m) : DEFAULT_TASK_MODEL);

/** "Sonnet", "Opus" or the id's family name for the card. */
export function modelName(id: string | null | undefined): string {
  const s = String(id ?? '').toLowerCase();
  for (const f of ['opus', 'sonnet', 'haiku', 'fable']) if (s.includes(f)) return f[0].toUpperCase() + f.slice(1);
  return id || 'Unknown';
}

export const parallelChats = (n: unknown) => Math.min(MAX_PARALLEL, Math.max(1, Math.round(Number(n)) || DEFAULT_PARALLEL));

/** The prompt names shared parts, so "Fix the shared component first" starts ticked. */
export const mentionsComponents = (prompt: string) => /\b(components?|variants?|component sets?|main component)\b/i.test(prompt);

export const STATE_TEXT: Record<TaskFlowState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  needs_you: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

export const TASK_STATE_TEXT: Record<TaskState, string> = { running: 'Running', paused: 'Paused', done: 'Done', stopped: 'Stopped' };

export function pauseText(t: Pick<Task, 'reason' | 'pausedAt' | 'cap'>): string {
  switch (t.reason) {
    case 'weekly': return `Weekly usage is at ${Math.round(t.pausedAt ?? t.cap)}%, at or above the ${t.cap}% cap. Resume when it drops.`;
    case 'restart': return 'Design Studio restarted, so the flows that were running stopped. Resume to start the waiting ones.';
    case 'components': return 'The shared component chat did not finish. Check it, then resume to start the flows.';
    case 'section': return 'The iteration section is not in Figma yet. Check the first flow\'s chat, then resume.';
    case 'user': return 'Paused by you. Running chats finish, waiting ones start when you resume.';
    default: return '';
  }
}

export type Rollup = { total: number; done: number; failed: number; running: number; needsYou: number; waiting: number; stopped: number; tokens: number; costUsd: number; line: string };

/** "5 of 8 done", with each state counted and the tokens of every chat (the component step included). */
export function rollup(t: Pick<Task, 'flows' | 'components'>): Rollup {
  const count = (s: TaskFlowState) => t.flows.filter((f) => f.state === s).length;
  const all = [...(t.components ? [t.components] : []), ...t.flows];
  const r = {
    total: t.flows.length,
    done: count('done'),
    failed: count('failed'),
    running: count('running'),
    needsYou: count('needs_you'),
    waiting: count('waiting'),
    stopped: count('stopped'),
    tokens: all.reduce((n, f) => n + (f.tokens || 0), 0),
    costUsd: all.reduce((n, f) => n + (f.costUsd || 0), 0),
  };
  const extra = [r.running && `${r.running} running`, r.needsYou && `${r.needsYou} need you`, r.failed && `${r.failed} failed`].filter(Boolean);
  return { ...r, line: `${r.done} of ${r.total} done${extra.length ? `, ${extra.join(', ')}` : ''}` };
}

export const isOpen = (s: TaskFlowState) => s === 'running' || s === 'needs_you';

/** 12,345 tokens -> "12.3k". */
export function tokenText(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const ASK = 'Do not ask me questions and do not wait for me: other flows run at the same time. When something needs my decision, pick the safe option, note it under "Needs your decision" at the end, and keep going.';

/** What one flow's chat gets: her prompt first (so the chat title is her words), then where it runs. */
export function taskFlowPrompt(prompt: string, flow: Pick<TaskFlow, 'n' | 'name'>, total: number, iteration: string): string {
  return `${prompt.trim()}

This is part of a project task across ${total} flow${total === 1 ? '' : 's'} in iteration ${iteration}. Do only Flow ${flow.n} · ${flow.name}, inside your own flow subsection. Other chats do the other flows. ${ASK} End with a short summary of what changed.`;
}

/** The serial step before the fan-out: shared components only. */
export function componentsPrompt(prompt: string, flows: Array<Pick<TaskFlow, 'n' | 'name'>>, iteration: string): string {
  return `${prompt.trim()}

This is the shared component step of a project task in iteration ${iteration}. Change only the shared main components this needs, as new variants (old variants stay as they are). Do not edit flow screens: after you, one chat per flow (${flows.map((f) => `${f.n} · ${f.name}`).join(', ')}) applies the change in its own flow. ${ASK} End with the list of components and variants you changed, so the flow chats can use them.`;
}

/** Time-sortable id: 20261019-143012-ab12. */
export function taskId(now = new Date(), rand = Math.random().toString(36).slice(2, 6)): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${rand}`;
}

export const taskTitle = (t: Pick<Task, 'prompt'>) => t.prompt.trim().split('\n')[0].slice(0, 80) || 'Task';
