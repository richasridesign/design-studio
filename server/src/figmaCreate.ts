import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { MODELS, parseFigmaUrl } from '../../shared/design.js';
import { isPlanKey, type FigmaTeam } from '../../shared/newProject.js';
import { FigmaError } from './figmaError.js';
import { figmaMcp, lean } from './lean.js';
import { findIn, reportCost, textOf, type ReadDeps } from './pluginRead.js';

// The two Figma calls behind New project's "Create a new Figma file": whoami (her teams) and create_new_file.
// The Figma sign-in lives inside Claude, so each call is one short Claude run with only that one tool allowed.
// Hooks pin the exact arguments, allow the tool once, and take the result out before the model sees it, so her
// email and handle never reach the model and a retry inside the run can never make a second file.
// Both run only when the designer clicks, never on a timer.

const SYSTEM = 'You make one Figma call for Design Studio exactly as told. The tool fills in its own arguments. You never call other tools and never load skills.';

type Hooks = Partial<Record<'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure', HookCallbackMatcher[]>>;

export class OneCall {
  calls = 0;
  response: unknown = undefined;
  error = '';
  constructor(readonly tool: string, readonly input: Record<string, unknown>) {}

  pre(toolName: string): HookJSONOutput {
    const deny = (reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (toolName !== this.tool) return deny('Only the one Figma call is allowed here. Reply now.');
    if (this.calls >= 1) return deny('The call was made already. Reply now with ok true.');
    this.calls++;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: this.input } };
  }

  post(toolName: string, response: unknown): HookJSONOutput {
    if (toolName !== this.tool) return {};
    this.response = response;
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: [{ type: 'text', text: 'Saved. Reply with ok true now.' }] } };
  }

  fail(toolName: string, error: string): HookJSONOutput {
    if (toolName === this.tool) this.error = error;
    return { hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: 'Reply with ok false now.' } };
  }

  hooks(): Hooks {
    const on = (fn: (i: any) => HookJSONOutput) => [{ hooks: [async (i: HookInput) => fn(i)] }];
    return {
      PreToolUse: on((i) => this.pre(i.tool_name)),
      PostToolUse: on((i) => this.post(i.tool_name, i.tool_response)),
      PostToolUseFailure: on((i) => this.fail(i.tool_name, String(i.error ?? ''))),
    };
  }
}

/** One line a designer can act on, for the error step: "Figma is not connected." */
export function createFailure(text: string): FigmaError {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/not connected|not configured/i.test(t)) return new FigmaError('Figma is not connected.', 412);
  if (/not (logged|signed) in|log ?in|sign ?in|unauthori[sz]ed|authenticat|\b401\b|oauth/i.test(t)) return new FigmaError('Figma is not logged in.', 401);
  if (/\b403\b|forbidden|permission|not allowed|cannot (create|add)/i.test(t)) return new FigmaError('Your Figma account cannot add files there.', 403);
  if (/\b404\b|not found|does not exist/i.test(t)) return new FigmaError('Figma could not find that project.', 404);
  if (/rate.?limit|\b429\b/i.test(t)) return new FigmaError('Figma is busy. Wait a minute.', 429);
  return new FigmaError(t ? `Figma said: ${t.slice(0, 120)}` : 'Figma did not answer.', 502);
}

async function once(tool: 'whoami' | 'create_new_file', input: Record<string, unknown>, prompt: string, dir: string, deps: ReadDeps): Promise<unknown> {
  // A test that reaches a real call would touch her Figma account: only fakes run under vitest.
  if (process.env.VITEST && !deps.run) throw new FigmaError('Tests never call Figma for real', 412);
  const { servers, plugins, name, configured } = deps.mcp ?? (await figmaMcp());
  if (!configured) throw createFailure('not connected');
  const full = `mcp__${name}__${tool}`;
  const call = new OneCall(full, input);
  const r = await (deps.run ?? lean)<{ ok: boolean }>(`Call ${full} once. ${prompt} Then reply with ok true.`, {
    cwd: dir,
    model: MODELS.read,
    system: SYSTEM,
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    tools: [],
    mcp: servers,
    plugins,
    allowed: [full],
    maxTurns: 4,
    hooks: call.hooks(),
  });
  reportCost({ dir, costUsd: r.costUsd, tokens: r.tokens });
  if (call.response === undefined) throw createFailure(call.error || r.error || '');
  return call.response;
}

/** Her Figma teams and organizations from whoami: key and name only. */
export function teamsFrom(response: unknown): FigmaTeam[] {
  const holder = findIn<{ plans: unknown[] }>(response, (x) => Array.isArray(x?.plans));
  const out: FigmaTeam[] = [];
  for (const p of holder?.plans ?? []) {
    const o = p as Record<string, unknown>;
    const key = o?.key ?? o?.plan_key ?? o?.planKey;
    if (!isPlanKey(key) || out.some((t) => t.key === key)) continue;
    out.push({ key: key as string, name: String(o.name ?? o.plan_name ?? key).slice(0, 80) });
  }
  return out;
}

/** The new file's key from what create_new_file sent back, else null. */
export function fileFrom(response: unknown): { key: string; url: string } | null {
  const raw = typeof response === 'string' ? response : `${textOf(response)}\n${JSON.stringify(response ?? null)}`;
  const parsed = parseFigmaUrl(raw);
  if (parsed) return { key: parsed.key, url: `https://www.figma.com/design/${parsed.key}` };
  const o = findIn<Record<string, unknown>>(response, (x) => typeof (x?.file_key ?? x?.fileKey ?? x?.key) === 'string');
  const key = String(o?.file_key ?? o?.fileKey ?? o?.key ?? '');
  return /^[A-Za-z0-9]{10,}$/.test(key) ? { key, url: `https://www.figma.com/design/${key}` } : null;
}

const TEAMS_TTL = 10 * 60_000;
let teamsCache: { at: number; teams: FigmaTeam[] } | null = null;

export async function figmaTeams(dir: string, deps: ReadDeps = {}): Promise<FigmaTeam[]> {
  if (teamsCache && Date.now() - teamsCache.at < TEAMS_TTL && !deps.run) return teamsCache.teams;
  const teams = teamsFrom(await once('whoami', {}, 'It takes no arguments.', dir, deps));
  if (!teams.length) throw new FigmaError('Figma did not list any team for this account.', 502);
  if (!deps.run) teamsCache = { at: Date.now(), teams };
  return teams;
}

export type CreateInput = { fileName: string; planKey: string; projectId?: string };

export async function createFigmaFile(dir: string, input: CreateInput, deps: ReadDeps = {}): Promise<{ key: string; url: string }> {
  if (!isPlanKey(input.planKey)) throw new FigmaError('Pick a Figma team.', 400);
  if (input.projectId !== undefined && !/^\d{1,24}$/.test(input.projectId)) throw new FigmaError('That is not a Figma project link.', 400);
  const args = { fileName: input.fileName.slice(0, 120), planKey: input.planKey, editorType: 'design', ...(input.projectId ? { projectId: input.projectId } : {}) };
  const file = fileFrom(await once('create_new_file', args, 'Its arguments are filled in for you.', dir, deps));
  if (!file) throw new FigmaError('Figma did not send back the new file.', 502);
  return file;
}
