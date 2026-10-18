import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { query, type McpServerConfig, type Options } from '@anthropic-ai/claude-agent-sdk';
import { readJson } from './mcp.js';

export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

export async function figmaMcp(): Promise<{ servers: Record<string, McpServerConfig>; configured: boolean }> {
  const user = await readJson(path.join(os.homedir(), '.claude.json'));
  const entries = Object.entries((user.mcpServers ?? {}) as Record<string, any>);
  const hit = entries.find(([name, c]) => /figma/i.test(name) || /figma/i.test(String(c?.url ?? c?.command ?? '')));
  if (hit) return { servers: { [hit[0]]: hit[1] as McpServerConfig }, configured: true };
  return { servers: { figma: { type: 'http', url: FIGMA_MCP_URL } }, configured: false };
}

export function addFigmaToClaude() {
  return new Promise<string>((resolve, reject) =>
    execFile('claude', ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'figma', FIGMA_MCP_URL], { timeout: 30_000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim())) : resolve(String(out).trim()),
    ),
  );
}

export const isFigmaTool = (name: string) => /^mcp__[^_].*?figma.*?__/i.test(name) || /__(use_figma|get_design_context|get_screenshot|get_metadata|get_variable_defs|search_design_system|html_to_figma|upload_assets|generate_figma_design)$/.test(name);
export const FIGMA_WRITE = /__(use_figma|html_to_figma|upload_assets|generate_figma_design|create_new_file|generate_diagram|add_code_connect_map)$/;

export type LeanResult<T> = { data: T | null; tokens: number; costUsd: number; error?: string; text: string };

export async function lean<T>(prompt: string, opts: { cwd: string; model: string; system: string; schema: Record<string, unknown>; tools?: string[]; mcp?: Record<string, McpServerConfig>; allowed?: string[]; maxTurns?: number; signal?: AbortSignal }): Promise<LeanResult<T>> {
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
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: opts.maxTurns ?? 16,
    outputFormat: { type: 'json_schema', schema: opts.schema },
    abortController: abort,
    stderr: (d) => process.stderr.write(d),
  };
  let tokens = 0;
  let costUsd = 0;
  try {
    for await (const msg of query({ prompt, options })) {
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
