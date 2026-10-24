import path from 'node:path';
import { createSdkMcpServer, tool, type CanUseTool, type HookCallback, type McpServerConfig, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { userContent } from './attach.js';
import { CHAT_MODEL, type FigmaFile } from '../../shared/design.js';
import { KIT_GUIDE } from './figmaKit.js';
import { isHistoryPath, markFlowEdited, recordChanges } from './history.js';
import { figmaEdits } from './touched.js';
import { FIGMA_MCP_URL, FIGMA_WRITE_MATCHER } from './lean.js';
import { workflowEvent } from './workflow.js';
import { STEP_IDS, WORKFLOW_RULES } from '../../shared/workflow.js';
import { BRAINSTORM_INPUT, BRAINSTORM_TOOL } from './brainstorm.js';
import { claudeMdExcludes, designCore, skillImports } from './designRules.js';

export const STATUS_REMINDER = 'You have not called mcp__designstudio__set_status for a while, so the designer sees no progress. Call it now with what you are doing, what is done and the next steps.';

/**
 * How to edit an existing Figma file in few calls. Shared with subagents, which do not see the system prompt, so for
 * them it also carries the design rules (`rules`); the chat's own prompt has those once, on their own.
 */
export function figmaSpeed(mapFile: string | null, rules = designCore()) {
  return [
    'Working fast in Figma: most of the time goes into round trips, so make each call count.',
    mapFile ? `- File map: ${mapFile} (read in the background when the chat opens; if it is not there yet, call mcp__designstudio__refresh_file_map) lists every page, section and screen (ids, sizes, positions), component sets with their setProperties keys and Hover variants, variables and styles. Grep it for names before reading Figma, and only read Figma for what it does not have (layers inside a screen). If an id from it is gone, call mcp__designstudio__refresh_file_map.` : '',
    '- One call per change: find, edit and check in the same use_figma script. End it with DS.check([changed screen ids]) and DS.shot(screen) so the result carries the checks and a screenshot. Do not read, edit, read again and then call get_screenshot.',
    '- Put independent reads (or edits on different pages) in one message as parallel calls.',
    '- Do not call figma.saveVersionHistoryAsync: use_figma does not support it and the whole call fails. Figma keeps its own version history.',
    '- Load the Figma tools you need in one ToolSearch call, create_session included (Figma wants a session before any file call), for example select:mcp__plugin_figma_figma__create_session,mcp__plugin_figma_figma__use_figma,mcp__plugin_figma_figma__get_screenshot.',
    '- When you start a subagent for Figma work, give it the node ids it needs from the map.',
    KIT_GUIDE,
    rules,
  ].filter(Boolean).join('\n');
}

/**
 * The system prompt. `project` is the flow and iteration block from shared/project.ts for a chat on an adopted
 * file: it replaces the "Design Studio page" rule, which is how files without flows are kept safe.
 */
/** The history file of a flow chat (cwd <root>/flows/NN-slug/iterations/<id>), or null for any other chat. */
export function historyPathFor(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const parts = path.resolve(cwd).split(path.sep);
  return parts.length >= 4 && parts.at(-2) === 'iterations' && parts.at(-4) === 'flows' ? path.join(path.resolve(cwd), '..', '..', 'history.md') : null;
}

export function instructions(figma: FigmaFile | null, rules = '', mapFile: string | null = null, project: string | null = null, history: string | null = null, core = '') {
  return [
    'You work with a product designer in Design Studio. They follow your work on a timeline, often from a phone, and watch the Figma file in their browser. Write for a designer: no code, file paths or tool names in your replies unless they ask.',
    figma ? `This chat belongs to the Figma file "${figma.name}" (${figma.url}, file key ${figma.key}). Use the Figma MCP tools on that file.` : 'No Figma file is linked to this chat yet. If the designer asks for design work, ask them to paste the Figma file link.',
    'Use mcp__designstudio__set_status to report progress. Call it when you begin, when you move to a new step and when you finish. Keep text to one short sentence. Pass done when you finish a meaningful part, next as the remaining steps, important only for a risk, blocker or surprise the designer must know, and nodes with the Figma node ids you are working on so their Figma view follows you.',
    'When you finish a change in Figma, call set_status changes: what changed, on which screens, why. Decisions go on the Decision stickies under each screen, never in set_status.',
    project ? `Projects, flows and iterations:\n${project}` : 'Changing the Figma file: put new work on a page named "Design Studio". Never edit frames on other pages in place unless the designer says so; duplicate them onto the Design Studio page instead.',
    project && history ? `This flow's history is at ${history}. Read it before changing a screen that was decided before. Do not edit it: Design Studio writes it.` : '',
    project && history ? WORKFLOW_RULES : '',
    figma ? figmaSpeed(mapFile, '') : '',
    core,
    'Design quality: use the library components, color variables, text styles and spacing scale from design-system.md when it exists. Do not hard-code colors or build components by hand.',
    // The Fix button on the Steps panel asks in plain words; the file name lives here, out of the designer's message.
    'Review findings and failed house rules the designer closed by hand on the Review tab (fixed, won\'t fix or parked) are listed in triage.json in the chat folder. Skip them when you fix issues from a review. Leave the findings that wait for the designer\'s decision (they have a decide note in review.json): the designer decides those, so do not fix them.',
    'For anything in a web browser, use the Claude in Chrome tools. They drive the designer\'s own Chrome, where they are logged in to Figma.',
    rules,
  ].filter(Boolean).join('\n\n');
}

/** One change in set_status: Design Studio adds it to the flow's history file. Loose limits, so a long line never fails the update. */
export const CHANGE_INPUT = z.object({
  what: z.string().max(400).describe('What changed, in a few words, like "Readiness column added to the table".'),
  why: z.string().max(800).optional().describe('The reason, one short sentence.'),
  screens: z.array(z.string().max(160)).max(20).optional().describe('The screens it changed: names or node ids.'),
});

const OPTION_INPUT = z.object({
  id: z.enum(['A', 'B', 'C']),
  name: z.string().max(60).describe('Its short name, like "Cards".'),
  node: z.string().max(40).describe('The option subsection\'s node id.'),
});

/** The brainstorm_update tool's handler: saves the round and returns what Claude is told (an error when it was not saved). */
export type OnBrainstorm = (input: unknown) => Promise<{ text: string; isError?: boolean }>;

function statusServer(onStatus: (text: string, nodes: string[]) => void, refreshMap?: () => Promise<string>, cwd?: string, onBrainstorm?: OnBrainstorm) {
  return createSdkMcpServer({
    name: 'designstudio',
    alwaysLoad: true,
    tools: [
      tool(
        'set_status',
        'Update the one-line status shown to the designer about what you are doing right now, and optionally flag something important or point their Figma view at nodes.',
        {
          text: z.string().max(200),
          done: z.string().max(160).optional().describe('A part of the task you just finished, a few words. Omit when nothing new is done.'),
          next: z.array(z.string().max(120)).max(12).optional().describe('Remaining steps after the current one, in order. Empty when done.'),
          important: z.string().max(500).optional().describe('A risk, blocker or surprise the designer must know about. Omit when there is none. Decisions go on the Decision stickies in Figma.'),
          changes: z.array(CHANGE_INPUT).max(20).optional().describe('Changes you finished in Figma since the last call, once each: what changed, on which screens, why. Omit when nothing changed.'),
          nodes: z.array(z.string().max(40)).max(10).optional().describe('Figma node ids (like "12:34") you are working on, newest last. Their Figma view moves to the last one.'),
          stepDone: z.enum(STEP_IDS).optional().describe('In a flow chat: the workflow step you just finished (update, hifi or system). Omit otherwise.'),
          options: z.array(OPTION_INPUT).min(1).max(3).optional().describe('From scratch, Explore: the low fidelity options you made, from DS.options (id, name, node of each option subsection). Send once they are all made.'),
          picked: z.object({ id: z.enum(['A', 'B', 'C']), why: z.string().max(160).optional() }).optional().describe('From scratch, Pick: the option the designer chose in the chat, with their reason in their words when they gave one.'),
        },
        async ({ text, nodes, changes, stepDone, options, picked }) => {
          onStatus(text, nodes ?? []);
          // A failed write never fails the status update.
          if (cwd && changes?.length) {
            await recordChanges(cwd, changes).catch((err) => console.error(`history: ${String(err)}`));
            await workflowEvent(cwd, { type: 'changes', count: changes.length, screens: changes.flatMap((c) => c.screens ?? []), at: Date.now() }).catch((err) => console.error(`workflow: ${String(err)}`));
          }
          if (cwd && stepDone) await workflowEvent(cwd, { type: 'done', step: stepDone, at: Date.now() }).catch((err) => console.error(`workflow: ${String(err)}`));
          if (cwd && options?.length) await workflowEvent(cwd, { type: 'options', options, at: Date.now() }).catch((err) => console.error(`workflow: ${String(err)}`));
          if (cwd && picked) await workflowEvent(cwd, { type: 'pick', id: picked.id, why: picked.why, at: Date.now() }).catch((err) => console.error(`workflow: ${String(err)}`));
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      ),
      ...(onBrainstorm
        ? [
            tool('brainstorm_update', BRAINSTORM_TOOL, BRAINSTORM_INPUT, async (input) => {
              const r = await onBrainstorm(input).catch((err: Error) => ({ text: `The round was not saved: ${err.message}`, isError: true }));
              return { content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) };
            }),
          ]
        : []),
      ...(refreshMap
        ? [
            tool(
              'refresh_file_map',
              'Reads the Figma file map again (about 30 seconds) and returns its summary. Use it when ids from the map are gone or the map misses work made since it was read.',
              {},
              async () => {
                const text = await refreshMap().catch((err: Error) => `The map could not be read: ${err.message}`);
                return { content: [{ type: 'text', text }] };
              },
            ),
          ]
        : []),
    ],
  });
}

/** Claude reads a flow's history file but never writes it: Design Studio does, between its markers. */
export function historyGuard(cwd: string): HookCallback {
  return async (input) => {
    const ti = ((input as { tool_input?: Record<string, unknown> }).tool_input ?? {}) as Record<string, unknown>;
    const file = String(ti.file_path ?? ti.notebook_path ?? '');
    if (!file || !isHistoryPath(path.resolve(cwd, file))) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Design Studio writes this file. Report what changed with set_status changes, and put decisions on the Decision stickies in Figma.' } };
  };
}

/**
 * After a use_figma call that edited the file in a flow chat: the history's decisions are out of date until the next
 * sync, and the workflow takes it as feedback (Update becomes current while Review is current or after a done Update).
 */
export function historyAfterFigma(cwd: string): HookCallback {
  return async (input) => {
    const code = String(((input as { tool_input?: { code?: unknown } }).tool_input ?? {}).code ?? '');
    if (code && figmaEdits(code)) {
      void markFlowEdited(cwd).catch(() => {});
      void workflowEvent(cwd, { type: 'edited', at: Date.now() }).catch(() => {});
    }
    return {};
  };
}

/**
 * The MCP servers a chat loads: Design Studio's own, Figma (the plugin, or the server her config names) and Claude in
 * Chrome (from extraArgs chrome; chats use it for anything in a browser). Her other servers (playwright, github,
 * penpot, claude.ai connectors) only added tool names and server instructions to every prompt. An allowlist in the
 * flag settings layer, because strictMcpConfig would also drop the Figma plugin's server.
 */
export function chatMcpAllowlist(figmaServers: Record<string, McpServerConfig>) {
  return [
    { serverName: 'designstudio' },
    { serverName: 'claude-in-chrome' },
    { serverUrl: `${new URL(FIGMA_MCP_URL).origin}/*` },
    ...Object.keys(figmaServers).map((serverName) => ({ serverName })),
  ];
}

/** Design Studio's own tools never ask. */
export const OWN_TOOLS_MATCHER = '^mcp__designstudio__(set_status|refresh_file_map|brainstorm_update)$';
/**
 * Allows Design Studio's own tools on purpose, in a hook. Bare allowedTools entries did the same, but the SDK warned
 * that they shadow canUseTool (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), which reads like a gap in the approvals.
 */
export const allowOwnTools: HookCallback = async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Design Studio\'s own tool' } });

export function agentOptions(o: {
  cwd: string;
  resume?: string;
  /** The model the chat starts on (chatModel.ts picks it). New chats get Opus. */
  model?: string;
  figma: FigmaFile | null;
  rules?: string;
  figmaServers: Record<string, McpServerConfig>;
  strictMcp: boolean;
  onStatus: (text: string, nodes: string[]) => void;
  canUseTool: CanUseTool;
  beforeFigma: HookCallback;
  beforeAgent?: HookCallback;
  afterTool: HookCallback;
  /** PostToolUseFailure on use_figma: releases the file's write lock when a call fails. */
  afterFigmaFailure?: HookCallback;
  mapFile?: string | null;
  /** The flow and iteration block for a chat on an adopted file. */
  project?: string | null;
  refreshMap?: () => Promise<string>;
  onBrainstorm?: OnBrainstorm;
}): Options {
  const skills = skillImports();
  return {
    cwd: o.cwd,
    resume: o.resume,
    model: o.model ?? CHAT_MODEL,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: instructions(o.figma, o.rules, o.mapFile ?? null, o.project ?? null, historyPathFor(o.cwd), designCore(skills)) },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    disallowedTools: ['mcp__playwright'],
    extraArgs: { chrome: null },
    permissionMode: 'auto',
    mcpServers: { designstudio: statusServer(o.onStatus, o.refreshMap, o.cwd, o.onBrainstorm), ...o.figmaServers },
    strictMcpConfig: o.strictMcp,
    // Her CLAUDE.md still loads, without the skill files it imports: the core rules above stand in for them.
    settings: { allowedMcpServers: chatMcpAllowlist(o.figmaServers), claudeMdExcludes: claudeMdExcludes(skills) },
    toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
    canUseTool: o.canUseTool,
    hooks: {
      PreToolUse: [{ matcher: OWN_TOOLS_MATCHER, hooks: [allowOwnTools] }, { matcher: FIGMA_WRITE_MATCHER, hooks: [o.beforeFigma] }, ...(o.beforeAgent ? [{ matcher: '^(Agent|Task)$', hooks: [o.beforeAgent] }] : []), { matcher: '^(Write|Edit|MultiEdit|NotebookEdit)$', hooks: [historyGuard(o.cwd)] }],
      PostToolUse: [{ hooks: [o.afterTool] }, { matcher: 'mcp__.*use_figma', hooks: [historyAfterFigma(o.cwd)] }],
      ...(o.afterFigmaFailure ? { PostToolUseFailure: [{ matcher: 'mcp__.*use_figma', hooks: [o.afterFigmaFailure] }] } : {}),
    },
    stderr: (d) => process.stderr.write(d),
  };
}

export function userMessage(text: string, blocks: Parameters<typeof userContent>[1] = []): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: userContent(text, blocks) }, parent_tool_use_id: null };
}
