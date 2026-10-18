import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { query, type McpServerConfig, type Options, type SDKMessage, type SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';
import { readJson } from './mcp.js';

export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';
export const FIGMA_PLUGIN = 'figma@claude-plugins-official';
export const FIGMA_PLUGIN_SERVER = 'plugin:figma:figma';

export type FigmaMcp = {
  servers: Record<string, McpServerConfig>;
  plugins: SdkPluginConfig[];
  configured: boolean;
  via: 'plugin' | 'config' | 'none';
  /** Tool prefix name, as in mcp__<name>__use_figma */
  name: string;
};

/** The enabled Figma plugin for Claude Code (the same one the Claude CLI uses), if installed. */
export function figmaPluginPath(installed: any, settings: any): string | null {
  const key = Object.keys(installed?.plugins ?? {}).find((k) => /^figma@/.test(k) && settings?.enabledPlugins?.[k] !== false);
  const entry = key ? installed.plugins[key]?.[0] : null;
  return entry?.installPath ?? null;
}

export async function figmaMcp(): Promise<FigmaMcp> {
  const home = os.homedir();
  const [installed, claudeSettings, user] = await Promise.all([
    readJson(path.join(home, '.claude/plugins/installed_plugins.json')),
    readJson(path.join(home, '.claude/settings.json')),
    readJson(path.join(home, '.claude.json')),
  ]);
  const plugin = figmaPluginPath(installed, claudeSettings);
  if (plugin) return { servers: {}, plugins: [{ type: 'local', path: plugin }], configured: true, via: 'plugin', name: 'plugin_figma_figma' };
  const entries = Object.entries((user.mcpServers ?? {}) as Record<string, any>);
  const hit = entries.find(([name, c]) => /figma/i.test(name) || /figma/i.test(String(c?.url ?? c?.command ?? '')));
  if (hit) return { servers: { [hit[0]]: hit[1] as McpServerConfig }, plugins: [], configured: true, via: 'config', name: hit[0] };
  return { servers: { figma: { type: 'http', url: FIGMA_MCP_URL } }, plugins: [], configured: false, via: 'none', name: 'figma' };
}

const claude = (args: string[], timeout = 60_000) =>
  new Promise<string>((resolve, reject) =>
    execFile('claude', args, { timeout }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim())) : resolve(String(out).trim()))),
  );

/** Installs the official Figma plugin, the same way the Claude CLI connects to Figma. */
export const addFigmaToClaude = () => claude(['plugin', 'install', FIGMA_PLUGIN]);

/** Live status of the plugin's Figma server, read from the Claude CLI (it holds the sign-in). */
export async function figmaPluginStatus(): Promise<'connected' | 'needs-auth' | 'failed'> {
  const out = await claude(['mcp', 'get', FIGMA_PLUGIN_SERVER], 30_000).catch((e: Error) => e.message);
  if (/Status:.*Connected/i.test(out)) return 'connected';
  if (/auth/i.test(out)) return 'needs-auth';
  return 'failed';
}

export const isFigmaTool = (name: string) => /^mcp__[^_].*?figma.*?__/i.test(name) || /__(use_figma|get_design_context|get_screenshot|get_metadata|get_variable_defs|search_design_system|html_to_figma|upload_assets|generate_figma_design)$/.test(name);
export const FIGMA_WRITE = /__(use_figma|html_to_figma|upload_assets|generate_figma_design|create_new_file|generate_diagram|add_code_connect_map)$/;

export type LeanResult<T> = { data: T | null; tokens: number; costUsd: number; error?: string; text: string };

export async function lean<T>(prompt: string, opts: { cwd: string; model: string; system: string; schema: Record<string, unknown>; tools?: string[]; mcp?: Record<string, McpServerConfig>; plugins?: SdkPluginConfig[]; allowed?: string[]; maxTurns?: number; signal?: AbortSignal; onMessage?: (msg: SDKMessage) => void; env?: Record<string, string> }): Promise<LeanResult<T>> {
  const abort = new AbortController();
  opts.signal?.addEventListener('abort', () => abort.abort());
  const options: Options = {
    cwd: opts.cwd,
    model: opts.model,
    systemPrompt: opts.system,
    tools: opts.tools ?? ['Read'],
    allowedTools: [...(opts.tools ?? ['Read']), ...(opts.allowed ?? [])],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: opts.mcp ?? {},
    plugins: opts.plugins,
    // Strict mode drops plugin MCP servers, so the Figma plugin needs it off
    strictMcpConfig: !opts.plugins?.length,
    persistSession: false,
    maxTurns: opts.maxTurns ?? 16,
    outputFormat: { type: 'json_schema', schema: opts.schema },
    abortController: abort,
    stderr: (d) => process.stderr.write(d),
    // The SDK does not merge env with process.env, so extra variables are added on top of it.
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  };
  let tokens = 0;
  let costUsd = 0;
  try {
    for await (const msg of query({ prompt, options })) {
      opts.onMessage?.(msg);
      if (msg.type !== 'result') continue;
      costUsd = msg.total_cost_usd;
      tokens = Object.values(msg.modelUsage ?? {}).reduce((n, u) => n + u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0);
      if (msg.subtype === 'success') return { data: (msg.structured_output as T) ?? null, tokens, costUsd, text: msg.result, error: msg.structured_output ? undefined : 'No structured output' };
      return { data: null, tokens, costUsd, text: '', error: `Ended: ${msg.subtype}` };
    }
  } catch (err) {
    return { data: null, tokens, costUsd, text: '', error: err instanceof Error ? err.message : String(err) };
  }
  return { data: null, tokens, costUsd, text: '', error: 'No result' };
}
