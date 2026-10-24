import type { FigmaFile, FlowState } from './design.js';
import type { LongRun } from './longRun.js';
import type { BrainstormRound } from './brainstorm.js';

export type PendingQuestion = {
  id: string;
  kind: 'question';
  questions: Array<{
    question: string;
    header: string;
    multiSelect?: boolean;
    options: Array<{ label: string; description: string; preview?: string }>;
  }>;
};

export type PendingPermission = {
  id: string;
  kind: 'permission';
  toolName: string;
  title: string;
  detail?: string;
  input: Record<string, unknown>;
  canAlwaysAllow: boolean;
  confirmFirst?: boolean;
};

export type PendingRequest = PendingQuestion | PendingPermission;

export type ChatEvent =
  | { id: string; kind: 'user'; text: string; at: number; stopping?: boolean; phase?: string }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean; at: number }
  | { id: string; kind: 'tool_use'; name: string; input: Record<string, unknown>; summary: string; at: number }
  | { id: string; kind: 'tool_result'; toolUseId: string; text: string; isError: boolean; at: number }
  | { id: string; kind: 'result'; text: string; costUsd: number; isError: boolean; at: number }
  | { id: string; kind: 'system'; text: string; at: number }
  | { id: string; kind: 'status'; text: string; at: number }
  | { id: string; kind: 'plan'; next: string[]; at: number }
  | { id: string; kind: 'review'; at: number; runAt: number };

export type SpendPart = { tokens: number; costUsd: number };
export type Spend = SpendPart & { byPhase: Record<string, SpendPart>; byModel: Record<string, SpendPart> };

export type SessionInfo = {
  id: string;
  sessionId: string | null;
  model: string | null;
  cwd: string;
  figma: FigmaFile | null;
  running: boolean;
  permissionMode: string | null;
  apiKeySource: string | null;
  models: Array<{ value: string; displayName: string; description?: string }>;
  commands: Array<{ name: string; description: string }>;
  cache: CacheInfo | null;
  context: number | null;
  compacting: boolean;
  stopping: boolean;
  mcp: McpServer[];
  flow: FlowState;
  spend: Spend;
  limit?: PlanLimit | null;
  /** The latest plan limit per window ("five_hour", "seven_day", ...). */
  limits?: Record<string, PlanLimit>;
  longRun?: LongRun | null;
  /** The scope guard is off for this chat: its edit scripts may touch other flows and iterations. */
  editsAnywhere?: boolean;
  /** Brainstorm mode: Claude reads Figma but every write is denied until she builds. */
  brainstorm?: boolean;
};

export type McpTool = { name: string; description?: string; readOnly?: boolean; destructive?: boolean };

export type McpServer = {
  name: string;
  status: string;
  scope?: string;
  type?: string;
  command?: string;
  env?: string[];
  version?: string;
  error?: string;
  tools?: McpTool[];
};

export type McpConfigEntry = { name: string; scope: 'user' | 'local' | 'project' | 'plugin'; type: string; command?: string; env?: string[] };

export const MCP_BAD = ['failed', 'needs-auth'];

export type PlanLimit = { kind: string; used: number | null; resetsAt: number | null; status: 'allowed' | 'allowed_warning' | 'rejected' };

export type CacheInfo = { at: number; ttlMs: number; readTokens: number; writeTokens: number };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;

export type ServerState = {
  session: SessionInfo;
  status: string;
  events: ChatEvent[];
  pending: PendingRequest[];
  recentFiles: string[];
  /** This chat's brainstorm rounds, oldest first. */
  brainstorm?: BrainstormRound[];
};

export type ServerMessage =
  | { type: 'init'; state: ServerState }
  | { type: 'event'; event: ChatEvent }
  /** More text for a streaming reply: `text` is appended to event `id`, which then has `len` characters. */
  | { type: 'delta'; id: string; text: string; len: number }
  | { type: 'status'; text: string }
  | { type: 'pending'; request: PendingRequest }
  | { type: 'resolved'; id: string }
  | { type: 'file_changed'; path: string; source: 'tool' | 'watcher' }
  | { type: 'focus'; nodeId: string }
  | { type: 'session'; session: SessionInfo }
  | { type: 'live'; chats: LiveChat[] }
  | { type: 'brainstorm'; rounds: BrainstormRound[] }
  | { type: 'error'; text: string };

export type LiveChat = {
  id: string;
  sessionId: string | null;
  cwd: string;
  title: string;
  running: boolean;
  pending: number;
  status: string;
  lastActive: number;
  mcpFailed?: number;
  last?: string;
  edits?: { add: number; del: number };
  file?: string;
  fileUrl?: string;
  /** The project task that started this chat. */
  task?: string;
};

export type SavedSession = {
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  lastModified: number;
};

export const COMPACT_AT = 200_000;

export const STALE_MS = 12 * 60 * 60 * 1000;

export type ClientMessage =
  | { type: 'prompt'; text: string; images?: string[] }
  | { type: 'steer'; text: string; id?: string; images?: string[] }
  | { type: 'plan'; next: string[] }
  | { type: 'answer'; id: string; answers: Record<string, string>; response?: string }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean; note?: string }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_flow'; patch: Partial<Pick<FlowState, 'mode' | 'preset' | 'areas'>> }
  | { type: 'interrupt' }
  | { type: 'long_run_start'; text: string; until: number; cap: number; weeklyCap?: number; rounds?: number; images?: string[] }
  /** Older clients sent the weekly cap and rounds here, just before long_run_start. Still accepted. */
  | { type: 'long_run_options'; weeklyCap: number; rounds: number }
  | { type: 'long_run_stop' }
  | { type: 'long_run_clear' }
  | { type: 'view'; id: string }
  | { type: 'close'; id: string }
  | { type: 'open_session'; sessionId: string }
  /** With flow and iteration, the chat runs in that flow's iteration folder of the project at cwd (made if new). */
  | { type: 'new_session'; cwd?: string; flow?: string; iteration?: string; brainstorm?: boolean }
  | { type: 'new_chat'; url?: string }
  | { type: 'set_figma'; url: string }
  | { type: 'set_edits_anywhere'; on: boolean }
  /** Brainstorm mode on or off (Start building). */
  | { type: 'set_brainstorm'; on: boolean }
  /** Build this: leaves Brainstorm mode, records the option in the round and sends its brief. */
  | { type: 'brainstorm_build'; round: number; option: number }
  // A project, flow or iteration row selected in the sidebar: the Figma tab in Chrome follows it.
  | { type: 'selection'; cwd: string; flow?: string; iteration?: string }
  | { type: 'mcp_status' }
  | { type: 'mcp_reconnect'; name: string; quiet?: boolean }
  | { type: 'mcp_toggle'; name: string; enabled: boolean };
