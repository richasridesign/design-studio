import type { FigmaFile, FlowPhase, FlowState } from './design.js';

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
  | { id: string; kind: 'user'; text: string; at: number; stopping?: boolean; phase?: FlowPhase }
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

export type McpConfigEntry = { name: string; scope: 'user' | 'local' | 'project'; type: string; command?: string; env?: string[] };

export const MCP_BAD = ['failed', 'needs-auth'];

export type CacheInfo = { at: number; ttlMs: number; readTokens: number; writeTokens: number };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;

export type ServerState = {
  session: SessionInfo;
  status: string;
  events: ChatEvent[];
  pending: PendingRequest[];
  recentFiles: string[];
};

export type ServerMessage =
  | { type: 'init'; state: ServerState }
  | { type: 'event'; event: ChatEvent }
  | { type: 'status'; text: string }
  | { type: 'pending'; request: PendingRequest }
  | { type: 'resolved'; id: string }
  | { type: 'file_changed'; path: string; source: 'tool' | 'watcher' }
  | { type: 'focus'; nodeId: string }
  | { type: 'session'; session: SessionInfo }
  | { type: 'live'; chats: LiveChat[] }
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
  | { type: 'answer'; id: string; answers: Record<string, string> }
  | { type: 'permission'; id: string; allow: boolean; always?: boolean }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'set_flow'; patch: Partial<Pick<FlowState, 'mode' | 'preset' | 'areas' | 'stopAfterSketch'>> }
  | { type: 'flow_continue' }
  | { type: 'flow_pick'; screen: string; direction: string }
  | { type: 'interrupt' }
  | { type: 'view'; id: string }
  | { type: 'close'; id: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'new_session'; cwd?: string }
  | { type: 'new_chat'; url?: string }
  | { type: 'set_figma'; url: string }
  | { type: 'mcp_status' }
  | { type: 'mcp_reconnect'; name: string }
  | { type: 'mcp_toggle'; name: string; enabled: boolean };
