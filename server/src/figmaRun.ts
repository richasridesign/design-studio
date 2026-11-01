import { pluginReadCall, readersFor } from './figmaPlugin.js';

// Chats' Figma scripts through Design Studio's plugin (figma-plugin/run.ts) instead of the Figma MCP's use_figma. The
// tool is mcp__designstudio__use_figma, so the scope guard, write lock, DS helpers, brainstorm rule, history and Follow
// Claude, which all match tool names ending in use_figma, apply to it unchanged. Measured on her largest file: a
// whole-page search 0.2 s here against 13 to 15 s through the MCP, a screenshot 0.04 s against 0.6 to 1.3 s.

/** The plugin read that runs a script. */
export const SCRIPT_READ = 'script';
/** A script Figma has started may run this long (DS.check on a big section takes a while). */
const RUN_MS = 120_000;
/** A script with the DS kit in front: the plugin takes far more than the Figma MCP's 50,000 characters. */
export const PLUGIN_MAX_CODE = 200_000;
/** Text over this many characters is cut, so one call cannot flood the context. */
const MAX_TEXT = 40_000;

export const NO_PLUGIN = (fileKey: string) =>
  `Design Studio's plugin is not running in file ${fileKey}, so this call did not run. Run the same call with the Figma MCP's use_figma (create_session first), and tell the designer once that Figma is slower until the file is open in the Figma tab of Design Studio or the Design Studio plugin runs in the Figma app.`;

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type RunResult = { content: Content[]; isError?: boolean };

/** True when a plugin in this file can run scripts: the Figma MCP's slow tools are then refused. */
export const pluginRuns = (fileKey: string) => readersFor(fileKey, SCRIPT_READ).length > 0;

/**
 * Runs one script in the file. The Figma view in the Mac window goes first, then the Figma app's plugin; a plugin
 * whose file is not the front tab never starts the script, so the next one is tried.
 */
export async function runScript(fileKey: string, code: string, signal?: AbortSignal): Promise<RunResult> {
  const conns = readersFor(fileKey, SCRIPT_READ).slice(0, 2);
  if (!conns.length) return { content: [{ type: 'text', text: NO_PLUGIN(fileKey) }], isError: true };
  let last = '';
  for (const conn of conns) {
    const r = await pluginReadCall(conn, SCRIPT_READ, { code }, { ms: RUN_MS, signal });
    if ('value' in r) return toResult(r.value);
    last = r.error;
    // Only a script Figma never started may go to the next plugin: one that ran may have edited already.
    if (r.error !== 'stalled' && r.error !== 'Figma did not start the read') return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
  }
  return { content: [{ type: 'text', text: `${NO_PLUGIN(fileKey)} (${last})` }], isError: true };
}

/** A screenshot of one node, through the same plugin. */
export function screenshot(fileKey: string, nodeId: string, signal?: AbortSignal) {
  const id = JSON.stringify(nodeId);
  return runScript(fileKey, `const n = await figma.getNodeByIdAsync(${id});\nif (!n) throw new Error('No node ' + ${id});\nawait __dsShot(n);\nreturn n.id;`, signal);
}

function toResult(raw: unknown): RunResult {
  const r = (raw ?? {}) as { value?: unknown; shots?: { id: string; png: string }[] };
  let text = JSON.stringify(r.value === undefined ? null : r.value);
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n[cut at ${MAX_TEXT} characters: return fewer fields]`;
  const shots = (r.shots ?? []).filter((s) => typeof s?.png === 'string' && s.png);
  return { content: [{ type: 'text', text }, ...shots.map((s) => ({ type: 'image' as const, data: s.png, mimeType: 'image/png' }))] };
}

/** The Figma MCP's own copies of the two tools, never Design Studio's. */
export const SLOW_FIGMA = /^mcp__(?!designstudio__).*__(use_figma|get_screenshot)$/;
/** The hook matcher for the screenshot alone: use_figma is checked in the chat's own Figma hook, before the write lock. */
export const SLOW_SHOT_MATCHER = '^mcp__(?!designstudio__).*__get_screenshot$';

/** A PreToolUse refusal for the Figma MCP's use_figma or get_screenshot while the plugin runs in the file, else null. */
export function slowFigmaRefusal(toolName: string, input: Record<string, unknown>, chatKey?: string | null) {
  if (!SLOW_FIGMA.test(toolName)) return null;
  const key = typeof input.fileKey === 'string' && input.fileKey ? input.fileKey : chatKey;
  if (!key || !pluginRuns(key)) return null;
  const fast = toolName.endsWith('get_screenshot') ? 'mcp__designstudio__get_screenshot' : 'mcp__designstudio__use_figma';
  return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: `Design Studio's plugin runs in this file: use ${fast} with the same arguments. It takes under a second; this tool takes 5 to 40 s.` } };
}
