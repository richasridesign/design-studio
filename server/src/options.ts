import { createSdkMcpServer, tool, type CanUseTool, type HookCallback, type McpServerConfig, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { userContent } from './attach.js';
import { MODELS, type FigmaFile } from '../../shared/design.js';
import { KIT_GUIDE } from './figmaKit.js';

export const STATUS_REMINDER = 'You have not called mcp__designstudio__set_status for a while, so the designer sees no progress. Call it now with what you are doing, what is done and the next steps.';

/** How to edit an existing Figma file in few calls. Shared with subagents, which do not see the system prompt. */
export function figmaSpeed(mapFile: string | null) {
  return [
    'Working fast in Figma: most of the time goes into round trips, so make each call count.',
    mapFile ? `- File map: ${mapFile} (read in the background when the chat opens; if it is not there yet, call mcp__designstudio__refresh_file_map) lists every page, section and screen (ids, sizes, positions), component sets with their setProperties keys and Hover variants, variables and styles. Grep it for names before reading Figma, and only read Figma for what it does not have (layers inside a screen). If an id from it is gone, call mcp__designstudio__refresh_file_map.` : '',
    '- One call per change: find, edit and check in the same use_figma script. End it with DS.check([changed screen ids]) and DS.shot(screen) so the result carries the checks and a screenshot. Do not read, edit, read again and then call get_screenshot.',
    '- Put independent reads (or edits on different pages) in one message as parallel calls.',
    '- Do not call figma.saveVersionHistoryAsync: use_figma does not support it and the whole call fails. Figma keeps its own version history.',
    '- Load the Figma tools you need in one ToolSearch call, for example select:mcp__plugin_figma_figma__use_figma,mcp__plugin_figma_figma__get_screenshot.',
    '- When you start a subagent for Figma work, give it the node ids it needs from the map.',
    KIT_GUIDE,
  ].filter(Boolean).join('\n');
}

export function instructions(figma: FigmaFile | null, rules = '', mapFile: string | null = null) {
  return [
    'You work with a product designer in Design Studio. They follow your work on a timeline, often from a phone, and watch the Figma file in their browser. Write for a designer: no code, file paths or tool names in your replies unless they ask.',
    figma ? `This chat belongs to the Figma file "${figma.name}" (${figma.url}, file key ${figma.key}). Use the Figma MCP tools on that file.` : 'No Figma file is linked to this chat yet. If the designer asks for design work, ask them to paste the Figma file link.',
    'Use mcp__designstudio__set_status to report progress. Call it when you begin, when you move to a new step and when you finish. Keep text to one short sentence. Pass done when you finish a meaningful part, next as the remaining steps, important only for a decision, risk or surprise the designer must know, and nodes with the Figma node ids you are working on so their Figma view follows you.',
    'Changing the Figma file: put new work on a page named "Design Studio". Never edit frames on other pages in place unless the designer says so; duplicate them onto the Design Studio page instead.',
    figma ? figmaSpeed(mapFile) : '',
    'Design quality: use the library components, color variables, text styles and spacing scale from design-system.md when it exists. Do not hard-code colors or build components by hand.',
    'For anything in a web browser, use the Claude in Chrome tools. They drive the designer\'s own Chrome, where they are logged in to Figma.',
    rules,
  ].filter(Boolean).join('\n\n');
}

function statusServer(onStatus: (text: string, nodes: string[]) => void, refreshMap?: () => Promise<string>) {
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
          important: z.string().max(500).optional().describe('A decision, risk, blocker or surprise the designer must know about. Omit when there is none.'),
          nodes: z.array(z.string().max(40)).max(10).optional().describe('Figma node ids (like "12:34") you are working on, newest last. Their Figma view moves to the last one.'),
        },
        async ({ text, nodes }) => {
          onStatus(text, nodes ?? []);
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      ),
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

export function agentOptions(o: {
  cwd: string;
  resume?: string;
  figma: FigmaFile | null;
  rules?: string;
  figmaServers: Record<string, McpServerConfig>;
  strictMcp: boolean;
  onStatus: (text: string, nodes: string[]) => void;
  canUseTool: CanUseTool;
  beforeFigma: HookCallback;
  beforeAgent?: HookCallback;
  afterTool: HookCallback;
  mapFile?: string | null;
  refreshMap?: () => Promise<string>;
}): Options {
  return {
    cwd: o.cwd,
    resume: o.resume,
    model: MODELS.work,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: instructions(o.figma, o.rules, o.mapFile ?? null) },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    allowedTools: ['mcp__designstudio__set_status', 'mcp__designstudio__refresh_file_map'],
    disallowedTools: ['mcp__playwright'],
    extraArgs: { chrome: null },
    permissionMode: 'auto',
    mcpServers: { designstudio: statusServer(o.onStatus, o.refreshMap), ...o.figmaServers },
    strictMcpConfig: o.strictMcp,
    toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
    canUseTool: o.canUseTool,
    hooks: {
      PreToolUse: [{ matcher: 'mcp__.*use_figma', hooks: [o.beforeFigma] }, ...(o.beforeAgent ? [{ matcher: '^(Agent|Task)$', hooks: [o.beforeAgent] }] : [])],
      PostToolUse: [{ hooks: [o.afterTool] }],
    },
    stderr: (d) => process.stderr.write(d),
  };
}

export function userMessage(text: string, blocks: Parameters<typeof userContent>[1] = []): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: userContent(text, blocks) }, parent_tool_use_id: null };
}
