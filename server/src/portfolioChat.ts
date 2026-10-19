import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { HookCallback, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { lean } from './lean.js';
import { MODELS } from '../../shared/design.js';
import { DRAFT_LINE_MAX, LONG_WORDS, MAX_SUGGESTIONS, NOTE_BLOCK, SITE_PAGES, stripDashes, type EditPlanItem, type EditRecord, type Suggestion } from '../../shared/portfolio.js';
import { BrowserPending } from './portfolioChrome.js';
import type { FramerText } from './framer.js';

// The portfolio's Claude turns. Each is one restricted query: only the Read tool, no Bash, no WebFetch, no Figma, no
// MCP servers, no settings or skills, and a hook that denies any path outside the run folder (so chat transcripts
// in ~/.claude/projects and chat folders stay out). Claude never gets a write tool: it suggests and plans, and the
// server applies the plan after Richa's Go.

export const DENY_REASON = "The portfolio chat reads only its run folder and edits Framer through Design Studio's tools. Publishing is Richa's click in Framer.";
export const PORTFOLIO_TOOLS = ['Read'];

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    // A file that does not exist yet: resolve its folder.
    try {
      return path.join(realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
};

/** True when `p` (relative to the run folder, or absolute) is inside it after links are followed. */
export function insideRun(runDir: string, p: string): boolean {
  if (!p) return false;
  const root = real(runDir);
  const abs = real(path.isAbsolute(p) ? p : path.join(runDir, p));
  return abs === root || abs.startsWith(root + path.sep);
}

/** Denies every tool but Read (and the browser tools of an edit turn), and any Read outside the run folder. */
export function runGuard(runDir: string, browser: RegExp | null = null): HookCallback {
  return async (input) => {
    const i = input as { tool_name?: string; tool_input?: Record<string, unknown> };
    const deny = { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: DENY_REASON } };
    if (browser && browser.test(String(i.tool_name))) return {};
    if (!PORTFOLIO_TOOLS.includes(String(i.tool_name))) return deny;
    const ti = i.tool_input ?? {};
    const paths = [ti.file_path, ti.path, ti.notebook_path].filter((x): x is string => typeof x === 'string');
    if (!paths.length || paths.some((p) => !insideRun(runDir, p))) return deny;
    return {};
  };
}

export const guardHooks = (runDir: string, browser: RegExp | null = null): Options['hooks'] => ({ PreToolUse: [{ hooks: [runGuard(runDir, browser)] }] });

export type ChatDeps = { run?: typeof lean };

const VOICE = [
  'Voice: write as Richa, in the first person. Plain words, short sentences, direct.',
  `No buzzwords, no metaphors, no poetic openers, no em dashes. Keep sentences under ${LONG_WORDS} words and each line under ${DRAFT_LINE_MAX} characters.`,
  'Match the tone of the page the copy goes on.',
].join(' ');

const NDA = [
  'Confidential work: in each draft, flag client and customer names (kind client), product code names (product),',
  "people's names (person), real numbers and metrics (number), and real data in screens (data). Quote each span exactly as it appears in the draft.",
].join(' ');

/** Her portfolio rules, from how past edits went. */
export const PORTFOLIO_RULES = [
  "Her portfolio rules: text stays editable text and images stay images, never a flattened picture of text. Keep the page's existing fonts and styles, no new font, and match the section's width.",
  'A change that repeats (a heading font on every card) is made once, at the text style or master component, not variant by variant.',
  'Drafts are shown to her first. Invent nothing: no competitors, numbers or claims she did not give. A new point gets its own section, not folded into another block.',
  'Code components use ASCII only. Never use Framer AI (the Agent panel or the AI chat): it spends her credits.',
].join(' ');

/** How to work in the Framer editor in her Chrome, from past runs. */
export const CHROME_RULES = [
  'Work only in the Framer editor tab of this project in her Chrome, and on richadesign.in. Never other tabs.',
  'Never open or type into the Framer Agent or AI chat. Never click Publish. Never press Escape (it flips to preview) and never type without a focused field (it fires shortcuts). Use cmd-click, not shift-click, to select several layers.',
  'Read each layer before you change it and read it back after. Type long text in short chunks.',
  'Images go in by clipboard paste, not the file picker. If a pasted component comes through empty (CMS or code bindings), stop and mark it copy pack.',
].join(' ');

export const SUGGEST_SYSTEM = [
  "You suggest updates to Richa's portfolio, richadesign.in, built in Framer. You only suggest: you cannot edit Framer and you cannot publish.",
  'Read only the files in this folder: candidates.json (her finished work, the decisions screen by screen), note.md (what she asked to change, when there is one), previous.json and revise.md (when she asks to revise suggestions), site/ (the live pages as text) and shots/ (screens as images).',
  'Never read anything else. Never read chat transcripts or chat folders.',
  VOICE,
  NDA,
  PORTFOLIO_RULES,
].join('\n');

const sitePaths = SITE_PAGES.map((p) => p.path).join(', ');

const OUTPUT = [
  `For each: page (one of ${sitePaths}, or "new" for a new case study), section (for example "Results" or "Home card"), kind (add, change, new-case-study, new-image),`,
  'what (one line), why (one line), sources (each a block key from candidates.json with the decision lines it rests on, quoted word for word),',
  'draft (the copy, in her voice), images (screen node ids from those blocks) and flags.',
];

export const suggestPrompt = (n: number, note = false) => [
  n ? `Here are ${n} finished iteration blocks in candidates.json, and the live site in site/. Screens are in shots/, named by node id.`
    : 'There is no finished work this time: candidates.json is empty. Suggest only from her note in note.md and the live site in site/.',
  ...(note ? [`Her note in note.md says what she wants changed on the site. Follow it first. A suggestion that rests on her note has the source block "${NOTE_BLOCK}" with the lines of the note it follows, quoted word for word.`] : []),
  `Suggest at most ${MAX_SUGGESTIONS} portfolio updates, most useful first: rank by how much each changes what a reader learns about her work.`,
  'Skip what the site already says.',
  ...OUTPUT,
].join(' ');

/** Pick step: she asks for changes to the suggestions she has. */
export const revisePrompt = () => [
  'previous.json holds the suggestions she is picking from, each with its id, her choice and her copy. revise.md says what she wants changed in them.',
  'candidates.json, note.md (when there is one) and site/ are the same as before.',
  `Return the whole revised list, at most ${MAX_SUGGESTIONS}, most useful first. Keep the ones her ask does not touch as they are.`,
  'Give was (the id from previous.json) for every suggestion you keep or change, and leave it out for a new one. Use her copy as the draft unless her ask is about that copy.',
  `A suggestion that rests on her ask or her note has the source block "${NOTE_BLOCK}" with the lines it follows, quoted word for word.`,
  ...OUTPUT,
].join(' ');

const FLAG = { type: 'object', properties: { kind: { type: 'string', enum: ['client', 'product', 'person', 'number', 'data'] }, text: { type: 'string' } }, required: ['kind', 'text'] };
export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          section: { type: 'string' },
          kind: { type: 'string', enum: ['add', 'change', 'new-case-study', 'new-image'] },
          what: { type: 'string' },
          why: { type: 'string' },
          sources: { type: 'array', items: { type: 'object', properties: { block: { type: 'string' }, quotes: { type: 'array', items: { type: 'string' } } }, required: ['block', 'quotes'] } },
          draft: { type: 'string' },
          images: { type: 'array', items: { type: 'string' } },
          flags: { type: 'array', items: FLAG },
          was: { type: 'string' },
        },
        required: ['page', 'section', 'kind', 'what', 'why', 'sources', 'draft', 'images', 'flags'],
      },
    },
  },
  required: ['suggestions'],
};

function runner(deps: ChatDeps) {
  if (deps.run) return deps.run;
  if (process.env.VITEST) throw new Error('Tests must not start a Claude turn');
  return lean;
}

/** One Opus turn: the run folder in, raw suggestions out (cleaned by the caller). */
export async function suggest(runDir: string, blocks: number, deps: ChatDeps = {}, signal?: AbortSignal, note = false, revise = false) {
  const r = await runner(deps)<{ suggestions: unknown[] }>(revise ? revisePrompt() : suggestPrompt(blocks, note), {
    cwd: runDir,
    model: MODELS.plan,
    system: SUGGEST_SYSTEM,
    schema: SUGGEST_SCHEMA,
    tools: PORTFOLIO_TOOLS,
    mcp: {},
    maxTurns: 24,
    hooks: guardHooks(runDir),
    signal,
  });
  if (!r.data) throw new Error(r.error ?? 'Claude did not suggest anything');
  return { raw: r.data.suggestions ?? [], costUsd: r.costUsd };
}

// ---------- Edit plan (Phase 2) ----------

export const PLAN_SYSTEM = [
  "You plan edits to Richa's portfolio in Framer. You cannot edit or publish: the edits start only after she says Go, and publishing is her click in Framer.",
  'Read only the files in this folder: picked.json (the picked suggestions with her final copy) and site/ (the live pages as text).',
  'Never read anything else. Never read chat transcripts or chat folders.',
  'Use her copy word for word. Never rewrite it.',
  PORTFOLIO_RULES,
].join('\n');

export const PLAN_PROMPT = [
  'Plan exactly these picked edits, nothing else.',
  'For a change to an existing text, give kind "text" with the page path, node (the layer as it reads in the Layers panel, or the section and line it sits in), its current text as old (copied exactly from site/) and the new text.',
  'Anything a single plain text cannot hold (a new section, a new case study, an image, text with mixed styles, a component bound to CMS or code) is kind "copy" with a one line reason: Richa pastes it herself.',
].join(' ');

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { suggestion: { type: 'string' }, kind: { type: 'string', enum: ['text', 'copy'] }, page: { type: 'string' }, node: { type: 'string' }, old: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' } },
        required: ['suggestion', 'kind'],
      },
    },
  },
  required: ['items'],
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Claude's plan for the Chrome route, checked against the live site: a text edit must quote text the page really
 * shows, or it becomes copy and paste. Every picked suggestion ends up in the plan.
 */
export function cleanChromePlan(raw: unknown, site: Record<string, string>, used: Array<Pick<Suggestion, 'id'>>): EditPlanItem[] {
  const items = Array.isArray((raw as any)?.items) ? (raw as any).items : [];
  const ids = new Set(used.map((s) => s.id));
  const out: EditPlanItem[] = [];
  for (const r of items) {
    if (!r || !ids.has(String(r.suggestion))) continue;
    const id = `e${out.length + 1}`;
    const page = String(r.page ?? '');
    const old = typeof r.old === 'string' ? r.old : '';
    if (r.kind === 'text' && old.trim() && site[page] && norm(site[page]).includes(norm(old)) && typeof r.text === 'string' && r.text.trim()) {
      out.push({ id, suggestion: String(r.suggestion), kind: 'text', page, node: stripDashes(String(r.node ?? '')).slice(0, 120) || 'Text layer', old, text: stripDashes(r.text).slice(0, 4000) });
    } else {
      const reason = r.kind === 'text' ? 'The text was not found on the live page, paste it by hand' : String(r.reason ?? 'Paste it by hand');
      out.push({ id, suggestion: String(r.suggestion), kind: 'copy', reason: stripDashes(reason).slice(0, 160) });
    }
  }
  for (const s of used) if (!out.some((e) => e.suggestion === s.id)) out.push({ id: `e${out.length + 1}`, suggestion: s.id, kind: 'copy', reason: 'Not in the plan, paste it by hand' });
  return out;
}

/**
 * API route (on hold until Phase 0). Claude's plan, checked against what the server read from Framer: a text edit must name a real, plain node and
 * quote its text exactly, or it becomes copy and paste. Every picked suggestion ends up in the plan.
 */
export function cleanPlan(raw: unknown, texts: FramerText[], used: Array<Pick<Suggestion, 'id'>>): EditPlanItem[] {
  const items = Array.isArray((raw as any)?.items) ? (raw as any).items : [];
  const byId = new Map(texts.map((t) => [t.id, t]));
  const ids = new Set(used.map((s) => s.id));
  const out: EditPlanItem[] = [];
  for (const r of items) {
    if (!r || !ids.has(String(r.suggestion))) continue;
    const id = `e${out.length + 1}`;
    const node = byId.get(String(r.node ?? ''));
    if (r.kind === 'text' && node && !node.mixed && node.text === r.old && typeof r.text === 'string' && r.text.trim()) {
      out.push({ id, suggestion: String(r.suggestion), kind: 'text', page: node.page, node: node.id, old: node.text, text: stripDashes(r.text).slice(0, 4000) });
    } else {
      const reason = r.kind === 'text' ? (node?.mixed ? 'Mixed styles, paste it by hand' : 'The text in Framer did not match, paste it by hand') : String(r.reason ?? 'Paste it by hand');
      out.push({ id, suggestion: String(r.suggestion), kind: 'copy', reason: stripDashes(reason).slice(0, 160) });
    }
  }
  for (const s of used) if (!out.some((e) => e.suggestion === s.id)) out.push({ id: `e${out.length + 1}`, suggestion: s.id, kind: 'copy', reason: 'Not in the plan, paste it by hand' });
  return out;
}

export async function plan(runDir: string, deps: ChatDeps = {}, signal?: AbortSignal) {
  const r = await runner(deps)<{ items: unknown[] }>(PLAN_PROMPT, {
    cwd: runDir,
    model: MODELS.plan,
    system: PLAN_SYSTEM,
    schema: PLAN_SCHEMA,
    tools: PORTFOLIO_TOOLS,
    mcp: {},
    maxTurns: 16,
    hooks: guardHooks(runDir),
    signal,
  });
  if (!r.data) throw new Error(r.error ?? 'Claude did not plan the edits');
  return { raw: r.data, costUsd: r.costUsd };
}

// ---------- Edits in Chrome (Phase 2, waits for Phase 0) ----------

/** The browser tools the edit turn may use: an MCP server config and a pattern for its tool names. Phase 0 picks it. */
export type BrowserTools = { mcp: Record<string, McpServerConfig>; names: string[]; pattern: RegExp };

export const EDIT_SYSTEM = [
  "You make the planned edits to Richa's portfolio in the Framer editor, in her signed-in Chrome. You cannot publish; never ask her to let you.",
  'Read only plan.json in this folder (the edits she approved). Never read anything else. Never read chat transcripts or chat folders.',
  'Make exactly these edits, nothing else. Use her copy word for word.',
  CHROME_RULES,
  PORTFOLIO_RULES,
].join('\n');

export const EDIT_PROMPT = 'Make the edits in plan.json, in order. For each, report its id, state (done, failed, or copy when it cannot be done in the editor), the text you read before the change as old, the text you read back after it as now, and a one line error when it failed. Stop at the first failure.';

export const EDIT_SCHEMA = {
  type: 'object',
  properties: { edits: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['done', 'failed', 'copy'] }, old: { type: 'string' }, now: { type: 'string' }, error: { type: 'string' } }, required: ['id', 'state'] } } },
  required: ['edits'],
};

/** Claude's report on the edits, joined to the plan. Old text read in the editor is kept for Undo all. */
export function cleanEditReport(raw: unknown, plan: EditPlanItem[]): EditRecord[] {
  const rows = new Map<string, any>((Array.isArray((raw as any)?.edits) ? (raw as any).edits : []).map((e: any) => [String(e?.id), e]));
  return plan.map((p) => {
    const r = rows.get(p.id);
    if (p.kind === 'copy') return { ...p, state: 'copy' as const };
    if (!r) return { ...p, state: 'waiting' as const };
    const state = r.state === 'done' ? 'done' : r.state === 'copy' ? 'copy' : 'failed';
    const old = typeof r.old === 'string' && r.old ? r.old : p.old;
    return { ...p, old, state, ...(state !== 'done' && r.error ? { error: stripDashes(String(r.error)).slice(0, 160) } : {}) } as EditRecord;
  });
}

export async function editInChrome(runDir: string, tools: BrowserTools | null, deps: ChatDeps = {}, signal?: AbortSignal) {
  if (!tools) throw new BrowserPending();
  const r = await runner(deps)<{ edits: unknown[] }>(EDIT_PROMPT, {
    cwd: runDir,
    model: MODELS.work,
    system: EDIT_SYSTEM,
    schema: EDIT_SCHEMA,
    tools: PORTFOLIO_TOOLS,
    allowed: tools.names,
    mcp: tools.mcp,
    maxTurns: 400,
    hooks: guardHooks(runDir, tools.pattern),
    signal,
  });
  if (!r.data) throw new Error(r.error ?? 'Claude did not report the edits');
  return r.data;
}
