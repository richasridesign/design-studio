import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { query, getSessionMessages, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type HookInput, type HookJSONOutput, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { compactAt } from '../../shared/models.js';
import { type ChatEvent, type PlanLimit, type ServerMessage, type ServerState, type SessionInfo, type SpendPart } from '../../shared/protocol.js';
import { AREAS, MODELS, PRESETS, PRESET_INFO, flowOff, nodeIdsIn, type Area, type FigmaFile, type FlowState, type ReviewPreset, type ReviewRun, type ReviewerState } from '../../shared/design.js';
import { Approvals } from './approvals.js';
import { STATUS_REMINDER, agentOptions, figmaSpeed, userMessage } from './options.js';
import { mcpFrom } from './mcp.js';
import { advisorEvent, cacheFrom, contextFrom, limitFrom, historyFrom, toolResultText, toolUseEvent, withReviews } from './transcript.js';
import { DESIGN_MOVED, parseCommand } from './flow.js';
import { FIGMA_WRITE, figmaMcp, isFigmaTool } from './lean.js';
import { buildProfile, readProfile } from './profile.js';
import { reviewAreas } from '../../shared/dsProfiles.js';
import { parseTone, runCopy, runCrit } from './crit.js';
import { parseBuildArg, runBuildCheck } from './buildcheck.js';
import { readDesign, readReview, runReview } from './review.js';
import { settings } from './settings.js';
import { TouchedIds, figmaEdits, touchedIds } from './touched.js';
import { loadImages, withRefs, type Images } from './attach.js';
import { readRules, rulesBlock } from './rules.js';
import { readWorkflow, reviewFrames, takeAsk, workflowEvent } from './workflow.js';
import { stepPrompt, workflowNote } from '../../shared/workflow.js';
import { addDaily, addSpend, emptySpend, loadChatSpend, modelTokens, saveChatSpend } from './spend.js';
import { buildMap, cachedMap, ensureMapSoon, locate, mapFiles, mapSummary, type FileMap } from './fileMap.js';
import { prepareFigmaCall, type FigmaCall } from './figmaKit.js';
import { SAMPLE_KEY } from './figma.js';
import { acquireWrite } from './figmaLock.js';
import { chatContext, readProject } from './project.js';
import { checkScope, frozenChat } from './scopeGuard.js';
import { markTurn, scheduleRestack } from './iterations.js';
import { latestOf, projectInstructions, type ChatContext } from '../../shared/project.js';
import { ASK_DENIED, AWAKE_GRACE, CONTINUE_TEXT, DEFAULT_ROUNDS, DEFAULT_WEEKLY_CAP, LONG_RUN_STEER, MAX_ROUNDS, REASON_TEXT, decide, isActive, longRunPrompt, parseReport, reportAsk, reportQuestions, roundFrom, windowPct, withLimit, type Limits, type LongRun, type LongRunReason, type Report } from '../../shared/longRun.js';
import { keepAwake } from './awake.js';
import { awaitQuestions } from './awaiting.js';
import { awaitKey, openCount, waitText } from '../../shared/awaiting.js';
import { BRAINSTORM_NOTE, BUILD_NOTE, brainstormDeny, chooseOption, listRounds, parseRound, readMode, saveMode, saveRound } from './brainstorm.js';
import { buildPrompt } from '../../shared/brainstorm.js';
import { modelId, readChatModel, saveChatModel, startModel } from './chatModel.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STATUS_EVERY = 8;

let lastLimit: PlanLimit | null = null;
let lastLimits: Limits = {};

/** The highest weekly plan window in percent, from the latest limit events of any chat. Null before the first one. */
export const weeklyPct = () => windowPct(lastLimits, 'weekly');

/** Most screens the auto check after an edit reads. */
export const AUTO_CHECK_MAX = 20;

/** What the project block depends on for a flow chat: its iteration's node and state, its subsection and states. */
function projectKeyOf(ctx: ChatContext | null): string {
  if (!ctx || ctx.scope !== 'flow' || !ctx.iteration || !ctx.flow) return '';
  const f = ctx.iteration.flows?.[ctx.flow.slug];
  const latest = latestOf(ctx.project, ctx.flow.slug)?.flows?.[ctx.flow.slug];
  return [ctx.iteration.node, ctx.iteration.state, f?.node, f?.states, latest?.node].join('|');
}

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  id = randomUUID();
  title = '';
  /** The project task (run across flows) that started this chat, if any. */
  taskId: string | null = null;
  created = Date.now();
  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();
  private approvals: Approvals;

  private turns = 0;
  private planChange: string | null = null;
  private sinceStatus = 0;
  private autoCompact = true;
  private lastResult = '';
  private work: AbortController | null = null;
  /**
   * Node ids to show in her Figma tab: the frame set_status names, the nodes an edit script names as it starts
   * (`start`), and the nodes it changed or created once it is done.
   */
  onFocus: (nodeIds: string[], start?: boolean) => void = () => {};
  /** A Figma edit script started (true) or the last running one ended (false): her Figma follows changes live meanwhile. */
  onEditing: (on: boolean) => void = () => {};

  /** Text of a reply block before its first visible word, and the event of each block streaming now, by block key. */
  private liveText = new Map<string, string>();
  private liveEvents = new Map<string, Extract<ChatEvent, { kind: 'assistant' }>>();
  /** When the prompt arrived, for the turn timing line in the server log. */
  private promptAt = 0;
  private timing: { at: number; queued: number; first: number; text: number; deltas: number; tools: number } | null = null;
  private edits = new Map<string, string>();
  /** Figma calls waiting for their result, by tool use id: true when the call's script creates or changes nodes. */
  /** Each running use_figma call: whether its script edits, and the node ids it names. */
  private figmaUses = new Map<string, { edits: boolean; ids: string[] }>();
  private figmaEdited = false;
  private touched = new TouchedIds();
  private liveMsgId = '';

  private resumedAuto = false;
  /** The model picked for a resumed chat, saved in models.json: it starts on that, else on Opus. */
  private savedModel: string | null = null;
  /** The model she picked in this chat (an alias like "opus[1m]" or "default" stays as picked, never the id it runs as). */
  private pickedModel: string | null = null;
  private lastError = false;
  private lrErrors = 0;
  /** The long run report seen in this turn's text, if any. */
  private lrReport: Report | null = null;
  /** Weekly cap and rounds from an older client's long_run_options message; long_run_start now carries them itself. */
  private lrOpts: { weeklyCap?: number; rounds?: number } = {};
  /** Lets the Mac sleep again; set while a long run keeps it awake. */
  private lrAwake: (() => void) | null = null;

  constructor(public cwd: string, private figma: FigmaFile | null, private resume?: string) {
    this.state = {
      session: { id: this.id, sessionId: resume ?? null, model: null, cwd, figma, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], flow: flowOff(), spend: emptySpend(), limit: lastLimit, limits: lastLimits },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
      brainstorm: [],
    };
    this.approvals = new Approvals(this.state, (m) => this.emit(m));
  }

  get figmaFile() {
    return this.figma;
  }

  setFigma(figma: FigmaFile) {
    if (this.state.session.running) return this.system('Wait for the current turn to finish before attaching a Figma file');
    if (this.figma && this.figma.key !== figma.key) markTurn(this.figma.key, this.id, false);
    this.figma = figma;
    this.map = null;
    this.mapRead = 0;
    void ensureMapSoon(this.cwd, figma.key);
    this.setSession({ figma });
    if (this.q) this.figmaNote = `A Figma file is now attached to this chat: "${figma.name}" (${figma.url}, file key ${figma.key}). Use the Figma MCP tools on that file from now on.`;
    this.system(`Attached ${figma.name}`);
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ServerMessage) {
    for (const l of this.listeners) l(m);
  }

  private pushEvent(ev: ChatEvent) {
    this.state.events.push(ev);
    this.emit({ type: 'event', event: ev });
  }

  private system(text: string) {
    this.pushEvent({ id: randomUUID(), kind: 'system', text, at: Date.now() });
  }

  private setStatus(text: string) {
    this.state.status = text;
    this.emit({ type: 'status', text });
    this.pushEvent({ id: randomUUID(), kind: 'status', text, at: Date.now() });
  }

  private setSession(patch: Partial<SessionInfo>) {
    // A chat mid-turn on a file holds off the restack of its iterations (iterations.ts scheduleRestack).
    if ('running' in patch && this.figma) markTurn(this.figma.key, this.id, Boolean(patch.running));
    this.state.session = { ...this.state.session, ...patch };
    this.emit({ type: 'session', session: this.state.session });
  }

  private noteFile(rel: string, source: 'tool' | 'watcher') {
    this.state.recentFiles = [rel, ...this.state.recentFiles.filter((f) => f !== rel)].slice(0, 30);
    this.emit({ type: 'file_changed', path: rel, source });
  }

  fileChangedExternally(rel: string) {
    this.noteFile(rel, 'watcher');
  }

  close() {
    this.closed = true;
    this.unlock();
    if (this.figma) markTurn(this.figma.key, this.id, false);
    this.endLongRun('stopped', 'ended');
    this.work?.abort();
    this.listeners.clear();
    this.approvals.denyAll();
    this.wake?.();
    this.q?.close();
  }

  async loadHistory() {
    if (!this.resume) {
      if (this.figma?.key === SAMPLE_KEY) this.state.events.push(...withReviews([], (await readReview(this.cwd)).runs));
      return;
    }
    const msgs = await getSessionMessages(this.resume, { dir: this.cwd });
    const { events, context, cache } = historyFrom(msgs);
    this.state.events.push(...withReviews(events, (await readReview(this.cwd)).runs));
    Object.assign(this.state.session, { context, cache, model: startModel(this.savedModel) });
  }

  async init() {
    const s = await settings();
    this.rules = rulesBlock(await readRules(this.cwd));
    // A chat on an adopted file knows its flow and iteration; the prompt block replaces the "Design Studio page" rule.
    this.projectCtx = await chatContext(this.cwd).catch(() => null);
    this.projectKey = projectKeyOf(this.projectCtx);
    // The profile's review areas (a starter's) are this chat's ticks until she changes them.
    this.defaultAreas = s.areas;
    this.state.session.flow = { ...flowOff(s), areas: reviewAreas(s.areas, false, (await readProfile(this.cwd))?.areas) };
    if (this.resume) this.state.session.spend = await loadChatSpend(this.cwd, this.resume);
    if (this.resume) this.savedModel = this.pickedModel = await readChatModel(this.cwd, this.resume).catch(() => null);
    // A resumed chat keeps its Brainstorm mode, so a restart never lifts the write lock, and shows its rounds.
    if (this.resume) {
      this.state.session.brainstorm = await readMode(this.cwd, this.resume).catch(() => false);
      this.state.brainstorm = await listRounds(this.cwd, this.resume).catch(() => []);
    }
    // The Figma plugin loads from the user's Claude settings, like in the Claude CLI
    const { servers, via } = await figmaMcp();
    this.figmaServers = servers;
    this.strictMcp = via === 'config';
    if (this.figma) void ensureMapSoon(this.cwd, this.figma.key);
  }

  private rules = '';
  private rulesNote = '';
  private projectCtx: ChatContext | null = null;
  /** The node ids and state the prompt's project block was written with, and a note when they changed since. */
  private projectKey = '';
  private projectNote = '';
  /** The file's write lock, held per use_figma call that edits (keyed by tool_use_id) and released after it. */
  private locks = new Map<string, () => void>();
  /** The workflow line Claude was last told, and the note (with a step button's prompt) for the next message. */
  private workflowKey = '';
  private workflowNote = '';
  /** From scratch: the Design system step finished after this rebuilds the profile once (older marks never do). */
  private profileAt = Date.now();
  private figmaNote = '';
  /** The file map, and the read time of the one Claude was last told about. */
  private map: FileMap | null = null;
  private mapRead = 0;
  private mapNote = '';

  private sampleBlocked() {
    if (this.figma?.key !== SAMPLE_KEY) return false;
    this.system('This is the sample chat. It is read-only, so it never spends tokens. Start a chat from a Figma link to run Claude.');
    return true;
  }
  private figmaServers: Record<string, any> = {};
  private strictMcp = false;

  start() {
    if (this.q || this.closed) return;
    this.q = query({
      prompt: this.inputStream(),
      options: agentOptions({
        cwd: this.cwd,
        resume: this.resume,
        model: startModel(this.savedModel),
        figma: this.figma,
        rules: this.rules,
        figmaServers: this.figmaServers,
        strictMcp: this.strictMcp,
        onStatus: (text, nodes) => {
          this.setStatus(text);
          const last = nodes.at(-1);
          if (last) this.onFocus([last]);
        },
        canUseTool: (toolName, input, opts) => this.longRunTool(toolName) ?? this.figmaTool(toolName, input) ?? this.approvals.ask(toolName, input, opts),
        beforeFigma: (input) => this.beforeFigma(input),
        beforeAgent: async (input) => this.beforeAgent(input),
        afterTool: async (input) => this.afterTool(input),
        afterFigmaFailure: async (input) => {
          if (input.hook_event_name === 'PostToolUseFailure') this.unlock(input.tool_use_id);
          return {};
        },
        project: this.projectCtx ? projectInstructions(this.projectCtx) : null,
        // The path is fixed per file, so Claude gets it even when the background read has not finished yet.
        mapFile: this.figma && this.figma.key !== SAMPLE_KEY ? mapFiles(this.cwd, this.figma.key).md : null,
        refreshMap: () => this.readMapNow(),
        onBrainstorm: (input) => this.postRound(input),
      }),
    });
    void this.consume();
    void this.loadMeta();
  }

  private async loadMeta() {
    if (!this.q) return;
    try {
      const [models, commands] = await Promise.all([this.q.supportedModels(), this.q.supportedCommands()]);
      const own = [
        { name: 'review', description: 'Review frames: /review [check|quick|focused|full] [frame links]' },
        { name: 'audit', description: 'Code scan across the whole file. Reads every frame through the Figma plugin, a few minutes on a large file' },
        { name: 'crit', description: 'Design crit from four viewpoints: /crit [frame links]' },
        { name: 'buildcheck', description: 'Compare a live page with a frame: /buildcheck <url> [frame link]' },
        { name: 'copy', description: 'Copy pass: /copy [frame links] [tone:friendly|neutral|formal]' },
        { name: 'system', description: 'Rebuild the design system profile' },
      ];
      this.setSession({
        models: models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description, resolvedModel: m.resolvedModel })),
        commands: [...own, ...commands.filter((c) => !own.some((o) => o.name === c.name)).map((c) => ({ name: c.name, description: c.description }))],
      });
    } catch (err) {
      process.stderr.write(`loadMeta failed: ${String(err)}\n`);
    }
  }

  async refreshMcp() {
    const list = await this.q?.mcpServerStatus().catch(() => null);
    if (list) this.setSession({ mcp: mcpFrom(list) });
  }

  async reconnectMcp(name: string, quiet = false) {
    await this.q?.reconnectMcpServer(name).catch((err) => quiet || this.system(`Reconnecting ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.q?.toggleMcpServer(name, enabled).catch((err) => this.system(`${enabled ? 'Enabling' : 'Disabling'} ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  /** "Allow edits anywhere" in the chat header: turns the scope guard off for this chat until turned on again. */
  setEditsAnywhere(on: boolean) {
    if (Boolean(this.state.session.editsAnywhere) === on) return;
    this.setSession({ editsAnywhere: on });
    this.system(on ? 'Allow edits anywhere: on. This chat can edit other flows and iterations.' : 'Allow edits anywhere: off. This chat edits only its own flow.');
  }

  /** Applies from the next request, and is saved for this chat so a reload, restart or resume keeps it. */
  async setModel(model: string) {
    const id = modelId(model);
    if (!id) return this.system(`Unknown model: ${model.slice(0, 80)}`);
    this.start();
    await this.q?.setModel(id);
    this.setSession({ model: id });
    this.pickedModel = id;
    const sid = this.state.session.sessionId;
    if (sid) void saveChatModel(this.cwd, sid, id).catch((err) => console.error(`model: ${String(err)}`));
  }

  async setPermissionMode(mode: string, quiet = false) {
    this.start();
    await this.q?.setPermissionMode(mode as PermissionMode);
    this.setSession({ permissionMode: mode });
    if (!quiet) this.system(`Permission mode: ${mode}`);
  }

  /**
   * Every use_figma call that uses the DS helpers gets them added. No version is saved: use_figma does not support
   * figma.saveVersionHistoryAsync, it fails the whole call.
   */
  private async beforeFigma(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const call = (input.tool_input ?? {}) as FigmaCall;
    const script = /use_figma$/.test(input.tool_name);
    // A brainstorming chat only reads Figma, in any chat (with or without a project), until she builds.
    const thinking = brainstormDeny(Boolean(this.state.session.brainstorm), input.tool_name, call as Record<string, unknown>);
    if (thinking) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: thinking } };
    // A chat on a frozen iteration is read only: no edit script and no other Figma write tool, checked before the
    // scope guard and "Allow edits anywhere", on a fresh project.json.
    if (this.projectCtx && FIGMA_WRITE.test(input.tool_name) && (!script || (typeof call.code === 'string' && figmaEdits(call.code)))) {
      const frozen = frozenChat(this.projectCtx, await readProject(this.cwd).catch(() => null));
      if (frozen) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: frozen } };
    }
    if (!script) return {};
    // An edit waits for the file's write lock, so two chats on one file never run their scripts at the same time.
    const key = this.figma?.key;
    if (key && key !== SAMPLE_KEY && typeof call.code === 'string' && figmaEdits(call.code)) {
      // The scope guard runs before the lock, so a denied script never waits: a flow chat edits only its own flow.
      if (this.projectCtx && !this.state.session.editsAnywhere) {
        const map = this.map ?? (await cachedMap(this.cwd, key));
        const v = checkScope(map, this.projectCtx, await readProject(this.cwd), touchedIds(call.code));
        if (!v.allow) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: v.reason } };
      }
      try {
        this.locks.set(input.tool_use_id, await acquireWrite(key));
        this.onEditing(true);
      } catch (err) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: (err as Error).message } };
      }
      // Her Figma tab moves to the screen as the edit starts, then again to what it returns (new frames).
      const named = touchedIds(call.code).slice(0, 20);
      if (named.length) this.onFocus(named, true);
    }
    const next = prepareFigmaCall(call);
    return next ? { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: next } } : {};
  }

  /** Brainstorm mode on or off. Leaving it tells Claude once, with her next message, that it may build. */
  setBrainstorm(on: boolean, quiet = false) {
    if (Boolean(this.state.session.brainstorm) === on) return;
    this.setSession({ brainstorm: on });
    this.buildNote = on ? '' : BUILD_NOTE;
    const sid = this.state.session.sessionId;
    if (sid) void saveMode(this.cwd, sid, on).catch((err) => console.error(`brainstorm: ${String(err)}`));
    if (!quiet) this.system(on ? 'Brainstorm: on. Claude reads Figma but does not change it.' : 'Building: Claude can change Figma again.');
  }

  private buildNote = '';

  /** The brainstorm_update tool: checks the round, saves it in the chat's folder and shows it on the Brainstorm tab. */
  private async postRound(input: unknown) {
    const parsed = parseRound(input);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const chat = this.state.session.sessionId ?? this.id;
    const round = await saveRound(this.cwd, chat, parsed.round);
    await this.sendRounds(chat);
    return { text: `Round ${round.n} is on the Brainstorm tab. Keep your chat reply to one or two lines.` };
  }

  private async sendRounds(chat = this.state.session.sessionId ?? this.id) {
    this.state.brainstorm = await listRounds(this.cwd, chat);
    this.emit({ type: 'brainstorm', rounds: this.state.brainstorm });
  }

  /** Build this: leaves Brainstorm mode, records the option in its round, then sends the option's brief as her message. */
  async buildOption(n: number, option: number) {
    if (this.sampleBlocked()) return;
    if (this.state.session.running) return this.system('Wait for this turn to finish, then click Build this again.');
    const chat = this.state.session.sessionId ?? this.id;
    const round = await chooseOption(this.cwd, chat, n, option);
    await this.sendRounds(chat);
    this.setBrainstorm(false, true);
    await this.prompt(buildPrompt(round, option));
  }

  private unlock(toolUseId?: string) {
    const had = this.locks.size;
    if (toolUseId === undefined) {
      for (const release of this.locks.values()) release();
      this.locks.clear();
    } else {
      this.locks.get(toolUseId)?.();
      this.locks.delete(toolUseId);
    }
    if (had && !this.locks.size) this.onEditing(false);
  }

  /** Subagents do not see the system prompt, so a subagent doing Figma work gets the map and the helpers in its prompt. */
  private async beforeAgent(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== 'PreToolUse' || !this.figma || this.figma.key === SAMPLE_KEY) return {};
    const tool = (input.tool_input ?? {}) as Record<string, unknown>;
    if (typeof tool.prompt !== 'string' || !/figma|frame|screen|section|component|\d+[:-]\d+/i.test(tool.prompt)) return {};
    const map = await cachedMap(this.cwd, this.figma.key);
    const extra = `\n\nFigma file: "${this.figma.name}", file key ${this.figma.key}.\n${figmaSpeed(map ? mapFiles(this.cwd, this.figma.key).md : null)}`;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...tool, prompt: tool.prompt + extra } } };
  }

  private figmaTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> | null {
    if (!isFigmaTool(toolName)) return null;
    if (FIGMA_WRITE.test(toolName) && this.askBeforeEdit) return null;
    return Promise.resolve({ behavior: 'allow', updatedInput: input });
  }

  private askBeforeEdit = false;

  answerQuestion(id: string, answers: Record<string, string>, response?: string) {
    this.approvals.answerQuestion(id, answers, response);
  }

  answerPermission(id: string, allow: boolean, always?: boolean, note?: string) {
    this.approvals.answerPermission(id, allow, always, note);
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      if (this.inputQueue.length === 0) {
        await new Promise<void>((r) => (this.wake = r));
        this.wake = null;
        continue;
      }
      yield this.inputQueue.shift()!;
    }
  }

  sendPrompt(text: string, images: Images = { refs: [], blocks: [] }) {
    if (this.sampleBlocked()) return;
    const full = withRefs(text, images.refs);
    this.pushEvent({ id: randomUUID(), kind: 'user', text: full, at: Date.now() });
    this.enqueue(full + this.whereNote(text), images.blocks);
  }

  /** Where the nodes in pasted links sit, from the map, so Claude does not spend a call finding out. */
  private whereNote(text: string) {
    if (!this.map) return '';
    const linked = new Set([...text.matchAll(/node-id=([0-9]+[-:][0-9]+)/g)].map((m) => m[1].replace('-', ':')));
    const lines = locate(this.map, nodeIdsIn(text).slice(0, 8)).filter((l) => l.found || linked.has(l.id));
    return lines.length ? `\n\nFrom the file map: ${lines.map((l) => l.text).join(' ')}` : '';
  }

  /** Notes Claude about the file map when there is a newer one than it knows: the summary once, then only that it changed. */
  private async refreshMapNote() {
    const key = this.figma?.key;
    if (!key || key === SAMPLE_KEY) return;
    void ensureMapSoon(this.cwd, key);
    const map = await cachedMap(this.cwd, key);
    if (!map) return;
    this.map = map;
    if (map.readAt === this.mapRead) return;
    const file = mapFiles(this.cwd, key).md;
    this.mapNote = this.mapRead ? `The file map has been read again (${file}). Grep it again for anything made since you last looked.` : mapSummary(map, file, this.mapScope());
    this.mapRead = map.readAt;
  }

  /**
   * project.json read again before each prompt: the guard and the map scope use the fresh one, and Claude is told once
   * when its iteration's section or its flow subsection got a node id (Retry, another chat) or the iteration froze, so
   * it never makes a second section.
   */
  private async refreshProject() {
    const ctx = await chatContext(this.cwd);
    if (!ctx) return;
    this.projectCtx = ctx;
    const key = projectKeyOf(ctx);
    if (key === this.projectKey) return;
    this.projectKey = key;
    if (this.q) this.projectNote = `The project changed since this chat started (a section was made or tagged, or the iteration was frozen or reopened). Follow this from now on:\n${projectInstructions(ctx)}`;
  }

  /** The refresh_file_map tool: reads the map now and returns its summary. */
  private async readMapNow() {
    const key = this.figma?.key;
    if (!key || key === SAMPLE_KEY) return 'No Figma file is attached to this chat.';
    const map = await buildMap(this.cwd, key);
    this.map = map;
    this.mapRead = map.readAt;
    return mapSummary(map, mapFiles(this.cwd, key).md, this.mapScope());
  }

  /** A flow chat's map summary lists only its own sections: the iteration, its flow subsection, the flow's latest
   * section (where the prompt points it) and the baseline. */
  private mapScope() {
    const c = this.projectCtx;
    if (!c || c.scope !== 'flow' || !c.iteration || !c.flow) return undefined;
    const inIt = c.iteration.flows?.[c.flow.slug];
    const latest = latestOf(c.project, c.flow.slug)?.flows?.[c.flow.slug];
    const sections = [c.iteration.node, inIt?.node, inIt?.states, latest?.node, latest?.states, c.flow.baseline].filter((x): x is string => Boolean(x));
    return sections.length ? { sections } : undefined;
  }

  private enqueue(text: string, blocks: Parameters<typeof userMessage>[1] = []) {
    this.start();
    const now = Date.now();
    this.timing ??= { at: this.promptAt || now, queued: now, first: 0, text: 0, deltas: 0, tools: 0 };
    this.promptAt = 0;
    this.turns++;
    this.setSession({ running: true });
    if (/^\/compact\b/.test(text.trim())) this.startCompacting();
    if (this.rulesNote) {
      text = `${this.rulesNote}\n\n${text}`;
      this.rulesNote = '';
    }
    if (this.workflowNote) {
      text = `${this.workflowNote}\n\n${text}`;
      this.workflowNote = '';
    }
    if (this.figmaNote) {
      text = `${this.figmaNote}\n\n${text}`;
      this.figmaNote = '';
    }
    if (this.mapNote) {
      text = `${this.mapNote}\n\n${text}`;
      this.mapNote = '';
    }
    if (this.projectNote) {
      text = `${this.projectNote}\n\n${text}`;
      this.projectNote = '';
    }
    // The mode note goes in its own block on every brainstorm turn (a compaction can drop a one-time note), and the
    // history leaves it out of her bubble.
    const mode = this.state.session.brainstorm ? BRAINSTORM_NOTE : this.buildNote;
    this.buildNote = '';
    if (mode) blocks = [...blocks, { type: 'text', text: `<design-studio-mode>\n${mode}\n</design-studio-mode>` }];
    this.inputQueue.push(userMessage(text, blocks));
    this.wake?.();
  }

  async interrupt() {
    if (isActive(this.state.session.longRun)) this.endLongRun('stopped', 'user');
    if (this.work && this.turns === 0) {
      this.work.abort();
      this.setFlow({ reviewers: [] });
      this.system('Stopped');
      this.setSession({ running: false });
      return;
    }
    if (!this.q || !this.state.session.running || this.state.session.stopping) return;
    this.planChange = null;
    this.turns -= this.inputQueue.length;
    this.inputQueue = [];
    if (this.turns <= 0) {
      this.turns = 0;
      this.setSession({ running: false, compacting: false });
      return;
    }
    this.setSession({ stopping: true });
    try {
      await this.q.interrupt();
      this.unlock();
    } catch (err) {
      this.setSession({ stopping: false });
      this.system(`Stop failed: ${String(err)}`);
    }
  }

  private async refreshRules() {
    const rules = rulesBlock(await readRules(this.cwd));
    if (rules !== this.rules) {
      if (this.q) this.rulesNote = rules ? `House rules or scope updated, follow these from now on:\n${rules}` : 'House rules and scope cleared: there are none now.';
      this.rules = rules;
    }
    this.askBeforeEdit = (await settings()).askBeforeEdit;
    await this.refreshProject().catch(() => {});
    await this.refreshMapNote().catch(() => {});
    // On a flow chat, tell Claude where the workflow stands when the step changes (a status line, never a gate), and
    // once the step prompt a step button asked for in this chat.
    const c = this.projectCtx;
    if (c?.scope === 'flow' && c.flow && c.iteration) {
      const state = await readWorkflow(this.cwd).catch(() => null);
      const note = state ? workflowNote(state, c.flow, c.iteration.id) : '';
      const ask = await takeAsk(this.cwd, this.id).catch(() => null);
      const step = ask && state ? stepPrompt(ask.step, c.flow, c.iteration.id, state) : '';
      if (note !== this.workflowKey || step) {
        this.workflowNote = [note !== this.workflowKey ? note : '', step].filter(Boolean).join('\n');
        this.workflowKey = note;
      }
    }
  }

  async prompt(text: string, refs?: unknown) {
    if (this.sampleBlocked()) return;
    this.promptAt = Date.now();
    await this.refreshRules();
    const images = await loadImages(this.cwd, refs);
    if (this.state.session.longRun && !isActive(this.state.session.longRun)) this.setSession({ longRun: null });
    const cmd = parseCommand(text);
    if (cmd && !this.state.session.running) return this.command(cmd.cmd, cmd.arg, text);
    this.sendPrompt(text, images);
  }

  /** The weekly cap and rounds for the next long run, from an older client that sent them in long_run_options. */
  setLongRunOptions(o: { weeklyCap?: unknown; rounds?: unknown }) {
    const n = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
    this.lrOpts = { weeklyCap: n(o.weeklyCap), rounds: n(o.rounds) };
  }

  async startLongRun(text: string, until: number, cap: number, refs?: unknown, opts?: { weeklyCap?: unknown; rounds?: unknown }) {
    if (opts && (opts.weeklyCap !== undefined || opts.rounds !== undefined)) this.setLongRunOptions(opts);
    const { weeklyCap = DEFAULT_WEEKLY_CAP, rounds = DEFAULT_ROUNDS } = this.lrOpts;
    this.lrOpts = {};
    if (this.sampleBlocked()) return;
    const task = text.trim();
    if (!task) return this.system('Write the task for the long run in the message box first');
    if (this.state.session.running || isActive(this.state.session.longRun)) return this.system('Wait for the current turn to finish before starting a long run');
    const now = Date.now();
    if (!Number.isFinite(until) || until <= now) return this.system('Pick a time later than now for the long run');
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) return this.system('Set the 5-hour usage cap between 1 and 100%');
    if (!Number.isFinite(weeklyCap) || weeklyCap < 1 || weeklyCap > 100) return this.system('Set the weekly usage cap between 1 and 100%');
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) return this.system(`Set the rounds between 1 and ${MAX_ROUNDS}`);
    const limits = this.limits();
    const used = windowPct(limits, 'five_hour') ?? 0;
    if (used >= cap) return this.system(`5-hour usage is already at ${Math.round(used)}%, above the ${Math.round(cap)}% cap`);
    const week = windowPct(limits, 'weekly') ?? 0;
    if (week >= weeklyCap) return this.system(`Weekly usage is already at ${Math.round(week)}%, above the ${Math.round(weeklyCap)}% cap`);
    await this.refreshRules();
    const images = await loadImages(this.cwd, refs);
    const run: LongRun = { until: Math.min(until, now + 24 * 3600_000), cap: Math.round(cap), weeklyCap: Math.round(weeklyCap), rounds, startedAt: now, turns: 1, state: 'running' };
    this.lrErrors = 0;
    this.lrReport = null;
    this.lrAwake?.();
    this.lrAwake = keepAwake(run.until + AWAKE_GRACE, { now });
    if (this.lrAwake) run.awakeUntil = run.until;
    this.setSession({ longRun: run });
    this.pushEvent({ id: randomUUID(), kind: 'user', text: withRefs(task, images.refs), at: now });
    const mapFile = this.figma && this.figma.key !== SAMPLE_KEY ? mapFiles(this.cwd, this.figma.key).md : null;
    this.enqueue(withRefs(longRunPrompt(task, run.until, { cap: run.cap, weeklyCap: run.weeklyCap, rounds, mapFile }), images.refs), images.blocks);
  }

  async stopLongRun() {
    if (!isActive(this.state.session.longRun)) return;
    this.endLongRun('stopped', 'user');
    if (this.state.session.running) await this.interrupt();
  }

  clearLongRun() {
    if (this.state.session.longRun && !isActive(this.state.session.longRun)) this.setSession({ longRun: null });
  }

  private setLongRun(patch: Partial<LongRun>) {
    const run = this.state.session.longRun;
    if (run) this.setSession({ longRun: { ...run, ...patch } });
  }

  /** The latest plan limit per window, with the latest single event folded in. */
  private limits(): Limits {
    const l = this.state.session.limit;
    return l ? withLimit(this.state.session.limits, l) : { ...(this.state.session.limits ?? {}) };
  }

  private endLongRun(state: 'done' | 'stopped', reason: LongRunReason) {
    this.lrAwake?.();
    this.lrAwake = null;
    const run = this.state.session.longRun;
    if (!isActive(run)) return;
    this.setLongRun({ state, reason });
    const turns = `${run!.turns} ${run!.turns === 1 ? 'turn' : 'turns'}`;
    this.system(state === 'done' ? `Long run finished · ${turns}` : `Long run stopped: ${REASON_TEXT[reason]} · ${turns}`);
  }

  /** After an idle turn end: the next long run message, or null when the run is over. */
  private longRunNext(): string | null {
    const run = this.state.session.longRun;
    if (!run || !isActive(run)) return null;
    this.lrErrors = this.lastError ? this.lrErrors + 1 : 0;
    const report = this.lrReport ?? (this.lastError ? null : parseReport(this.lastResult));
    this.lrReport = null;
    const d = decide(run, { now: Date.now(), limit: this.state.session.limit, limits: this.limits(), errorStreak: this.lrErrors, reported: report !== null });
    switch (d.action) {
      case 'continue':
        this.setLongRun({ turns: run.turns + 1 });
        this.system(`Long run · turn ${run.turns + 1}`);
        return CONTINUE_TEXT;
      case 'ask_report':
        this.setLongRun({ state: 'reporting', reason: d.reason, turns: run.turns + 1 });
        this.system(`Long run: ${REASON_TEXT[d.reason]}, asking Claude for the report`);
        return reportAsk(d.reason);
      case 'done':
        this.endLongRun('done', 'reported');
        if (report) void this.awaitReport(report);
        return null;
      case 'stop':
        this.endLongRun('stopped', d.reason);
        return null;
      default:
        return null;
    }
  }

  /** The report's "Needs your decision" items go to the Awaiting your decision list, so they outlast the chat. */
  private async awaitReport(report: Report) {
    const key = this.figma && this.figma.key !== SAMPLE_KEY ? this.figma.key : '';
    const items = reportQuestions(report.decide, key);
    if (!items.length) return;
    try {
      const saved = await awaitQuestions(this.cwd, key, items);
      this.setLongRun({ awaiting: items.length });
      const n = saved ? openCount(saved, items.map((q) => awaitKey(q.fileKey, { rule: q.text, node: q.node }))) : items.length;
      if (n) this.system(`Long run: ${n === 1 ? '1 question' : `${n} questions`} ${waitText(n).replace(/^\d+ /, '')} on the Review tab`);
    } catch (err) {
      console.error('could not save long run questions', err);
    }
  }

  private onArea = (area: ReviewerState['area'], state: ReviewerState['state']) => {
    const list = this.state.session.flow.reviewers ?? [];
    this.setFlow({ reviewers: list.some((r) => r.area === area) ? list.map((r) => (r.area === area ? { area, state } : r)) : [...list, { area, state }] });
  };

  private setFlow(patch: Partial<FlowState>) {
    this.setSession({ flow: { ...this.state.session.flow, ...patch } });
  }

  updateFlow(patch: Partial<Pick<FlowState, 'mode' | 'preset' | 'areas'>>) {
    const next: Partial<FlowState> = {};
    // The mode pill is gone: a saved Design or Review mode reads as Chat, so typed text never starts a run.
    if (patch.mode) next.mode = 'chat';
    if (patch.preset && PRESETS.includes(patch.preset)) next.preset = patch.preset;
    if (Array.isArray(patch.areas)) {
      next.areas = AREAS.filter((a) => patch.areas!.includes(a));
      this.areasChosen = true;
    }
    this.setFlow(next);
  }

  /** True once she ticks review areas in this chat; until then the profile's areas are the default. */
  private areasChosen = false;

  /** The Settings default, for a chat with neither her ticks nor a profile with areas. */
  private defaultAreas: Area[] = [...AREAS];

  /** A new starter's areas become this chat's ticks, and a removed profile gives the default back. She can tick others on the Review tab. */
  useProfileAreas(ds: { areas?: unknown } | null) {
    this.areasChosen = false;
    this.setFlow({ areas: reviewAreas(this.defaultAreas, false, ds?.areas) });
  }

  /** The areas a review covers now, shown on the Review tab too. */
  private async areasForReview(): Promise<Area[]> {
    const flow = this.state.session.flow.areas;
    const areas = this.areasChosen ? flow : reviewAreas(this.defaultAreas, false, (await readProfile(this.cwd))?.areas);
    if (areas.join() !== flow.join()) this.setFlow({ areas });
    return areas;
  }

  private async command(cmd: 'design' | 'sketch' | 'review' | 'audit' | 'system' | 'crit' | 'copy' | 'buildcheck', arg: string, raw: string) {
    if (this.sampleBlocked()) return;
    this.pushEvent({ id: randomUUID(), kind: 'user', text: raw, at: Date.now() });
    // Design runs became the From scratch workflow: the typed commands say where they went.
    if (cmd === 'design' || cmd === 'sketch') return this.system(DESIGN_MOVED);
    if (!this.figma) return this.system('Link a Figma file to this chat first: start a new chat from a Figma link');
    if (cmd === 'system') return this.background('Building the design system profile', async (signal) => {
      const r = await buildProfile(this.cwd, this.figma!, signal);
      this.recordBackground('system', r);
      this.system(`Design system profile built: ${r.ds.colors.length} colors, ${r.ds.text.length} text styles, ${r.ds.components.length} components (${Math.round(r.tokens / 1000)}k tokens)`);
    });
    if (cmd === 'audit') return this.background('Checking the whole file', async () => {
      const { fileOutline } = await import('./figmaCache.js');
      const frames = (await fileOutline(this.cwd, this.figma!.key, { fresh: true })).pages.flatMap((p) => p.frames.map((f) => f.id));
      if (!frames.length) return this.system('Audit: the file has no top-level frames');
      const run = await runReview({ dir: this.cwd, fileKey: this.figma!.key, frames, preset: 'check', areas: [], round: 0, kind: 'audit' });
      this.recordBackground('review', run);
      this.reviewDone(run);
    });
    if (cmd === 'buildcheck') {
      const parsed = parseBuildArg(arg);
      if ('error' in parsed) return this.system(`/buildcheck: ${parsed.error}`);
      const frame = parsed.frames[0] ?? (await readDesign(this.cwd))?.frames[0]?.nodeId;
      if (!frame) return this.system('/buildcheck: paste a frame link after the address, or run /design first');
      return this.background('Checking the build', async (signal) => {
        const run = await runBuildCheck({ dir: this.cwd, fileKey: this.figma!.key, frame, url: parsed.url, width: parsed.width, signal, onProgress: (t) => this.setStatus(t) });
        this.recordBackground('review', run);
        this.system(`Build check done: ${run.matchScore}% match, ${run.diffs.length} differences · ${Math.round(run.tokens / 1000)}k tokens. See the Review tab.`);
      });
    }
    if (cmd === 'crit' || cmd === 'copy') {
      let frames = nodeIdsIn(arg);
      if (!frames.length) frames = (await readDesign(this.cwd))?.frames.map((f) => f.nodeId) ?? [];
      if (!frames.length) return this.system(`/${cmd}: paste frame links after /${cmd}, or run /design first`);
      const n = `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'}`;
      if (cmd === 'crit') return this.background(`Critiquing ${n}`, async (signal) => {
        const run = await runCrit({ dir: this.cwd, fileKey: this.figma!.key, frames, signal, onProgress: (t) => this.setStatus(t) });
        this.recordBackground('review', run);
        this.system(`Crit done for ${n} · ${Math.round(run.tokens / 1000)}k tokens. See the Review tab.`);
      });
      return this.background(`Reading copy in ${n}`, async (signal) => {
        const run = await runCopy({ dir: this.cwd, fileKey: this.figma!.key, frames, tone: parseTone(arg), signal, onProgress: (t) => this.setStatus(t) });
        this.recordBackground('review', run);
        this.system(`Copy pass done: ${run.items.length} suggested changes · ${Math.round(run.tokens / 1000)}k tokens. See the Review tab.`);
      });
    }
    const words = arg.split(/\s+/);
    const preset = (PRESETS as readonly string[]).includes(words[0]) ? (words[0] as ReviewPreset) : this.state.session.flow.preset;
    let frames = nodeIdsIn(arg);
    // A flow chat reviews its flow's screens: this iteration's subsection, else the newest older one, else the baseline.
    const onFlow = this.projectCtx?.scope === 'flow';
    if (!frames.length && onFlow) frames = await reviewFrames(this.cwd).catch(() => []);
    if (!frames.length && !onFlow) frames = (await readDesign(this.cwd))?.frames.map((f) => f.nodeId) ?? [];
    if (!frames.length) return this.system(onFlow ? 'Review: this flow has no screens yet. Paste frame links after /review' : 'Review: paste frame links after /review, or run /design first');
    return this.background(`Reviewing ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} (${PRESET_INFO[preset].label})`, async (signal) => {
      const run = await runReview({ dir: this.cwd, fileKey: this.figma!.key, frames, preset, areas: await this.areasForReview(), round: 1, kind: 'review', signal, onProgress: (t) => this.setStatus(t), onArea: this.onArea }).catch(async (err: unknown) => {
        // The step card says the review stopped and offers Try again.
        if (onFlow && !signal.aborted) await workflowEvent(this.cwd, { type: 'failed', reason: err instanceof Error ? err.message : String(err), at: Date.now() }).catch(() => {});
        throw err;
      });
      this.setFlow({ reviewers: [] });
      this.recordBackground('review', run);
      this.reviewDone(run);
    });
  }

  private async background(label: string, job: (signal: AbortSignal) => Promise<void>) {
    this.work = new AbortController();
    this.setSession({ running: true });
    this.setStatus(label);
    try {
      await job(this.work.signal);
    } catch (err) {
      if (!this.work?.signal.aborted) this.system(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.work = null;
      this.setSession({ running: this.turns > 0 });
      this.setStatus('Idle');
    }
  }

  private reviewDone(run: ReviewRun) {
    this.pushEvent({ id: randomUUID(), kind: 'review', at: Date.now(), runAt: run.at });
  }

  /** Reads a long run's turn text: the round Claude says it is on, and the report. */
  private longRunText(text: string) {
    const run = this.state.session.longRun;
    const round = roundFrom(text);
    if (run && round !== null && round !== run.round && round <= (run.rounds ?? MAX_ROUNDS)) this.setLongRun({ round });
    const report = parseReport(text);
    if (report) this.lrReport = report;
  }

  private longRunTool(toolName: string): Promise<PermissionResult> | null {
    if (toolName !== 'AskUserQuestion' || !isActive(this.state.session.longRun)) return null;
    return Promise.resolve({ behavior: 'deny', message: ASK_DENIED });
  }

  private recordSpend(phase: string, model: string, tokens: number, costUsd: number) {
    if (!tokens && !costUsd) return;
    this.setSession({ spend: addSpend(this.state.session.spend, phase, model, tokens, costUsd) });
    addDaily(tokens, costUsd).catch(() => {});
    this.saveSpend();
  }

  private spendTimer: NodeJS.Timeout | null = null;
  private saveSpend() {
    this.spendTimer ??= setTimeout(() => {
      this.spendTimer = null;
      const { sessionId, spend } = this.state.session;
      if (sessionId) saveChatSpend(this.cwd, sessionId, spend).catch(() => {});
    }, 2000);
  }

  private recordBackground(phase: 'review' | 'system', r: { tokens: number; costUsd: number; results?: Array<{ costUsd: number }> }) {
    // Plugin reads are counted by recordRead as they finish, so a review counts only its reviewers here.
    this.recordSpend(phase, MODELS.work, r.tokens, r.results ? r.results.reduce((n, x) => n + x.costUsd, 0) : r.costUsd);
  }

  /** A plugin read (thumbnails, outline, map, checks) made for this chat: a short Haiku run. */
  recordRead(costUsd: number, tokens: number) {
    this.recordSpend('read', MODELS.read, tokens, costUsd);
  }

  private recordResult(msg: Extract<SDKMessage, { type: 'result' }>) {
    const phase = 'chat';
    const cumulative = msg.total_cost_usd >= this.lastCost;
    const prev = cumulative ? this.lastModels : {};
    const next: Record<string, SpendPart> = {};
    for (const [model, u] of Object.entries(msg.modelUsage ?? {})) {
      next[model] = { tokens: modelTokens(u), costUsd: u.costUSD };
      this.recordSpend(phase, model, Math.max(0, next[model].tokens - (prev[model]?.tokens ?? 0)), Math.max(0, u.costUSD - (prev[model]?.costUsd ?? 0)));
    }
    this.lastCost = msg.total_cost_usd;
    this.lastModels = next;
  }

  private lastCost = 0;
  private lastModels: Record<string, SpendPart> = {};

  async steer(text: string, id: string = randomUUID(), refs?: unknown) {
    if (this.sampleBlocked()) return;
    const images = Array.isArray(refs) && refs.length ? await loadImages(this.cwd, refs) : { refs: [], blocks: [] };
    text = withRefs(text, images.refs);
    const running = this.state.session.running;
    // During a long run the "keep going" nudge after each turn would override what she just said: the message
    // carries a note, so Claude ends the run (with its report) when she asks to stop, and otherwise works it in.
    const note = isActive(this.state.session.longRun) ? `\n\n${LONG_RUN_STEER}` : '';
    const ev: Extract<ChatEvent, { kind: 'user' }> = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.pushEvent(ev);
    if (running) {
      this.turns++;
      await this.q?.interrupt().catch(() => {});
      this.turns--;
      ev.stopping = false;
      this.emit({ type: 'event', event: ev });
    }
    this.enqueue(text + note, images.blocks);
  }

  changePlan(next: string[]) {
    if (this.sampleBlocked()) return;
    this.pushEvent({ id: randomUUID(), kind: 'plan', next, at: Date.now() });
    const text = next.length
      ? `I changed your plan. The remaining steps are now:\n${next.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nFollow this plan from here and update set_status to match.`
      : 'I removed the remaining steps of your plan. Finish the current step, then stop and tell me where things stand.';
    if (this.state.session.running) this.planChange = text;
    else this.sendPrompt(text);
  }

  afterTool(input: HookInput): HookJSONOutput {
    if (input.hook_event_name !== 'PostToolUse') return {};
    this.unlock(input.tool_use_id);
    if (input.agent_id) return {};
    const notes: string[] = [];
    if (this.planChange) notes.push(this.planChange);
    this.planChange = null;
    if (input.tool_name.endsWith('__set_status')) this.sinceStatus = 0;
    else if (++this.sinceStatus >= STATUS_EVERY) {
      this.sinceStatus = 0;
      notes.push(STATUS_REMINDER);
    }
    return notes.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') } } : {};
  }

  private startCompacting() {
    this.setSession({ compacting: true });
    this.setStatus('Compacting the conversation');
  }

  private turnEnded() {
    this.turns = Math.max(0, this.turns - 1);
    const idle = this.turns === 0 && !this.state.session.stopping;
    const next = idle ? this.followUp() : null;
    const nudge = idle && next === null ? this.longRunNext() : null;
    this.setSession({ running: this.turns > 0 || next !== null || nudge !== null, compacting: false, stopping: false });
    if (next) this.sendPrompt(next);
    else if (nudge) this.enqueue(nudge);
    if (idle) this.autoCheck();
  }

  private autoCheck() {
    const edited = this.figmaEdited;
    const touched = this.touched.ranked();
    this.figmaEdited = false;
    this.touched.clear();
    this.figmaUses.clear();
    const key = this.figma?.key;
    if (!edited || !key || key === SAMPLE_KEY) return;
    // The file map (and the outline, from the same read) is read again after any run that edited the file. The auto
    // check waits for this same read instead of starting a second one.
    const mapRead = buildMap(this.cwd, key).catch((err) => {
      console.error('file map:', (err as Error).message);
      return null;
    });
    // A flow chat's edited turn restacks its iteration's flows (800px apart), 20s after the last edit and only while
    // no chat on the file is mid-turn.
    const it = this.projectCtx?.scope === 'flow' ? this.projectCtx.iteration : null;
    if (it?.node && it.state === 'working') void mapRead.then(() => scheduleRestack(this.cwd, key, it.id));
    if (it) void this.profileAfterSystem(mapRead);
    if (isActive(this.state.session.longRun) || this.state.session.flow.mode !== 'chat' || this.work) return;
    void this.checkEdited(key, touched, mapRead);
  }

  /** From scratch: a turn that finished the Design system step rebuilds the file's profile, as /system does. */
  private async profileAfterSystem(mapRead: Promise<unknown>) {
    const done = (await readWorkflow(this.cwd).catch(() => null))?.marks.system;
    if (done?.state !== 'done' || done.at <= this.profileAt || !this.figma) return;
    this.profileAt = done.at;
    await mapRead;
    if (this.work || this.turns > 0) return;
    await this.background('Updating the design system profile', async (signal) => {
      const r = await buildProfile(this.cwd, this.figma!, signal);
      this.recordBackground('system', r);
      this.system(`Design system profile updated: ${r.ds.colors.length} colors, ${r.ds.text.length} text styles, ${r.ds.components.length} components.`);
    });
  }

  /**
   * The free check on the screens Claude touched. With no touched screen it checks nothing: never the whole file,
   * and never a whole section, only the screens inside it that were edited.
   */
  private async checkEdited(key: string, touched: string[], mapRead: Promise<FileMap | null>) {
    if (!touched.length) return;
    if (!(await settings().catch(() => null))?.autoCheck) return;
    try {
      this.setStatus('Checking edited frames');
      const { framesContaining, mapScreens } = await import('./figmaCache.js');
      const map = await mapRead;
      const screens = map ? mapScreens(map.raw.pages) : [];
      // A read that lists every screen of a section marks them all touched, so the check stops at AUTO_CHECK_MAX.
      const frames = (await framesContaining(this.cwd, key, touched, screens).catch(() => touched.filter((id) => screens.includes(id)))).slice(0, AUTO_CHECK_MAX);
      if (!frames.length) return;
      // An auto check shows only in the Review tab: no card in the chat and nothing in Awaiting. Reviews she starts
      // (/review, /audit) still post their card.
      await runReview({ dir: this.cwd, fileKey: key, frames, preset: 'check', areas: [], round: 0, kind: 'audit', awaiting: false });
    } catch (err) {
      console.error('auto check failed', err);
      this.system('Could not check the edited frames');
    } finally {
      if (!this.state.session.running) this.setStatus('Idle');
    }
  }

  private followUp() {
    if (this.planChange) {
      const text = this.planChange;
      this.planChange = null;
      return text;
    }
    if (this.autoCompact && (this.state.session.context ?? 0) >= compactAt(this.state.session.model)) {
      this.autoCompact = false;
      return '/compact';
    }
    return null;
  }

  private async consume() {
    if (!this.q) return;
    try {
      for await (const msg of this.q) this.handle(msg);
    } catch (err) {
      this.system(`Session error: ${String(err)}`);
    } finally {
      this.turns = 0;
      this.endLongRun('stopped', 'ended');
      this.setSession({ running: false, stopping: false });
    }
  }

  /** A streaming reply block ended: the full text goes out once, marked done. */
  private endLive(key: string) {
    const event = this.liveEvents.get(key);
    this.liveEvents.delete(key);
    if (!event) return;
    event.streaming = false;
    this.emit({ type: 'event', event });
  }

  /** One line per turn in the server log: time to get ready, to the SDK's first event, to the first word, and done. */
  private logTiming(sdkTurns: number) {
    const t = this.timing;
    this.timing = null;
    if (!t) return;
    const now = Date.now();
    const s = (to: number) => (to ? `${((to - t.at) / 1000).toFixed(1)}s` : 'none');
    console.log(`turn timing: ready ${t.queued - t.at}ms, first event ${s(t.first)}, first word ${s(t.text)}, done ${s(now)}, ${t.tools} tools, ${sdkTurns} model calls, ${t.deltas} deltas`);
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          const before = this.state.session.model;
          const changed = msg.model !== before;
          this.setSession({ sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource, mcp: mcpFrom(msg.mcp_servers, msg.tools) });
          // Only a pick is saved (it can come before the session has an id), so a chat she never switched starts on Opus.
          if (this.pickedModel) void saveChatModel(this.cwd, msg.session_id, this.pickedModel).catch((err) => console.error(`model: ${String(err)}`));
          if (this.state.session.brainstorm) void saveMode(this.cwd, msg.session_id, true).catch((err) => console.error(`brainstorm: ${String(err)}`));
          if (changed) this.system(before ? `Model: ${msg.model}` : `Session started with ${msg.model}`);
          if (this.resume && msg.permissionMode !== 'auto' && !this.resumedAuto) {
            this.resumedAuto = true;
            void this.q?.setPermissionMode('auto').then(() => this.setSession({ permissionMode: 'auto' }));
          }
          if (this.state.session.commands.length === 0) void this.loadMeta();
        } else if (msg.subtype === 'status') {
          if (msg.permissionMode) this.setSession({ permissionMode: msg.permissionMode });
          if (msg.status === 'compacting') this.startCompacting();
          if (msg.compact_result) this.setSession({ compacting: false });
          if (msg.compact_result === 'failed') this.system(`Compact failed: ${msg.compact_error || 'no reason given'}`);
        } else if (msg.subtype === 'compact_boundary') {
          const { pre_tokens, post_tokens } = msg.compact_metadata;
          this.setSession({ context: post_tokens ?? null, compacting: false });
          this.setStatus('Compacted');
          this.autoCompact = true;
          this.system(`Compacted from ${Math.round(pre_tokens / 1000)}k${post_tokens ? ` to ${Math.round(post_tokens / 1000)}k` : ''} tokens`);
        } else if (msg.subtype === 'local_command_output') {
          this.pushEvent({ id: msg.uuid, kind: 'assistant', text: msg.content, streaming: false, at: Date.now() });
          this.timing = null;
          this.turnEnded();
        }
        return;

      case 'rate_limit_event':
        lastLimit = limitFrom(msg.rate_limit_info);
        lastLimits = withLimit(lastLimits, lastLimit);
        this.setSession({ limit: lastLimit, limits: withLimit(this.state.session.limits, lastLimit) });
        if (lastLimit.status === 'rejected') this.endLongRun('stopped', 'rejected');
        return;
      case 'stream_event': {
        if (msg.parent_tool_use_id) return;
        const ev = msg.event;
        if (ev.type === 'message_start') {
          this.liveMsgId = ev.message.id;
          if (this.timing && !this.timing.first) this.timing.first = Date.now();
        }
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          const key = `${this.liveMsgId}:${ev.index}`;
          if (this.timing) {
            this.timing.text ||= Date.now();
            this.timing.deltas++;
          }
          const live = this.liveEvents.get(key);
          if (live) {
            // Only the new words go to the page, never the whole reply again.
            live.text += ev.delta.text;
            this.emit({ type: 'delta', id: key, text: ev.delta.text, len: live.text.length });
          } else {
            // The reply shows from its first visible word; whitespace before it waits here.
            const text = (this.liveText.get(key) ?? '') + ev.delta.text;
            if (!text.trim()) this.liveText.set(key, text);
            else {
              this.liveText.delete(key);
              const event: Extract<ChatEvent, { kind: 'assistant' }> = { id: key, kind: 'assistant', text, streaming: true, at: Date.now() };
              this.liveEvents.set(key, event);
              this.pushEvent(event);
            }
          }
        }
        if (ev.type === 'content_block_stop') {
          const key = `${this.liveMsgId}:${ev.index}`;
          this.endLive(key);
          this.liveText.delete(key);
        }
        return;
      }

      case 'assistant': {
        if (msg.parent_tool_use_id) return;
        this.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache), context: contextFrom(msg.message.usage) ?? this.state.session.context });
        for (const block of msg.message.content) {
          if (block.type === 'text' && isActive(this.state.session.longRun)) this.longRunText(block.text);
          if (block.type === 'server_tool_use' && block.name === 'advisor') this.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') {
            if (this.timing) this.timing.tools++;
            this.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now()));
            const file = (block.input as { file_path?: unknown })?.file_path;
            if (EDIT_TOOLS.has(block.name) && typeof file === 'string') this.edits.set(block.id, file);
            if (/use_figma$/.test(block.name)) {
              const code = (block.input as { code?: unknown })?.code;
              const edits = typeof code === 'string' && figmaEdits(code);
              const ids = touchedIds(JSON.stringify(block.input ?? {}));
              this.figmaUses.set(block.id, { edits, ids });
              this.touched.add(ids, edits ? 'edited' : 'named');
            } else if (block.name.endsWith('__set_status')) {
              this.touched.add(touchedIds(JSON.stringify((block.input as { nodes?: unknown })?.nodes ?? [])), 'edited');
            }
          }
        }
        return;
      }

      case 'user': {
        if (msg.parent_tool_use_id) return;
        const content = msg.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const edited = this.edits.get(block.tool_use_id);
          this.edits.delete(block.tool_use_id);
          if (edited && !block.is_error) this.noteFile(path.relative(this.cwd, edited), 'tool');
          const use = this.figmaUses.get(block.tool_use_id);
          if (this.figmaUses.delete(block.tool_use_id) && !block.is_error && use) {
            this.figmaEdited = true;
            // A call that created or changed nodes returns their ids (new frames have no id in the script): they rank as edited.
            const returned = touchedIds(toolResultText(block));
            this.touched.add(returned, use.edits ? 'edited' : 'returned');
            // Her Figma tab moves to what this edit changed, so she sees it happen. Reads do not move it.
            if (use.edits) {
              const ids = [...new Set([...use.ids, ...returned])].slice(0, 20);
              if (ids.length) this.onFocus(ids);
            }
          }
          this.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: toolResultText(block).slice(0, 4000), isError: Boolean(block.is_error), at: Date.now() });
        }
        return;
      }

      case 'result': {
        // A block cut off by Stop never gets its block end: its reply stops streaming here.
        for (const key of [...this.liveEvents.keys()]) this.endLive(key);
        this.liveText.clear();
        this.logTiming(msg.num_turns);
        this.recordResult(msg);
        this.lastResult = msg.subtype === 'success' ? msg.result : '';
        this.lastError = msg.is_error;
        this.pushEvent({
          id: msg.uuid,
          kind: 'result',
          text: msg.subtype === 'success' ? msg.result : `Turn ended: ${msg.subtype}`,
          costUsd: msg.total_cost_usd,
          isError: msg.is_error,
          at: Date.now(),
        });
        this.turnEnded();
        return;
      }

      default:
        return;
    }
  }
}
