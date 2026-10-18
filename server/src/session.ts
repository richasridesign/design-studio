import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { query, getSessionMessages, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type HookInput, type HookJSONOutput, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { COMPACT_AT, type ChatEvent, type ServerMessage, type ServerState, type SessionInfo, type SpendPart } from '../../shared/protocol.js';
import { AREAS, FLOW_ACTIVE, FLOW_MODES, MODELS, PRESETS, PRESET_INFO, flowOff, nodeIdsIn, type Area, type FigmaFile, type FlowKind, type FlowPhase, type FlowState, type ReviewPreset, type ReviewRun, type ReviewerState } from '../../shared/design.js';
import { Approvals } from './approvals.js';
import { STATUS_REMINDER, agentOptions, userMessage } from './options.js';
import { mcpFrom } from './mcp.js';
import { advisorEvent, cacheFrom, contextFrom, historyFrom, toolResultText, toolUseEvent, withReviews } from './transcript.js';
import { CHECKPOINT, afterFix, afterReview, designFilePrompt, designPrompt, fixPrompt, parseCommand, planPrompt, sketchFixPrompt, sketchPrompt } from './flow.js';
import { FIGMA_WRITE, figmaMcp, isFigmaTool } from './lean.js';
import { boardNotes, readSketch, renderAll } from './sketch.js';
import { buildProfile, readProfile } from './profile.js';
import { parseTone, runCopy, runCrit } from './crit.js';
import { parseBuildArg, runBuildCheck } from './buildcheck.js';
import { failedAreas, readDesign, readReview, runReview, toFix } from './review.js';
import { settings } from './settings.js';
import { touchedIds } from './touched.js';
import { loadImages, withRefs, type Images } from './attach.js';
import { readRules, rulesBlock } from './rules.js';
import { addDaily, addSpend, emptySpend, loadChatSpend, modelTokens, saveChatSpend } from './spend.js';
import { SAMPLE_KEY } from './figma.js';

type Step = { phase: FlowPhase; model: string; mode: string; label: string; prompt: string };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STATUS_EVERY = 8;

export class AgentSession {
  private q: Query | null = null;
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  id = randomUUID();
  title = '';
  created = Date.now();
  state: ServerState;
  private listeners = new Set<(m: ServerMessage) => void>();
  private approvals: Approvals;

  private turns = 0;
  private planChange: string | null = null;
  private sinceStatus = 0;
  private autoCompact = true;
  private lastResult = '';
  private checkpointed = false;
  private task = '';
  private retried = false;
  private fixesDone = 0;
  private lastRun: ReviewRun | null = null;
  private work: AbortController | null = null;
  onFocus: (nodeId: string) => void = () => {};

  private liveText = new Map<string, string>();
  private edits = new Map<string, string>();
  private figmaUses = new Set<string>();
  private figmaEdited = false;
  private touched = new Set<string>();
  private liveMsgId = '';

  private resumedAuto = false;

  constructor(public cwd: string, private figma: FigmaFile | null, private resume?: string) {
    this.state = {
      session: { id: this.id, sessionId: resume ?? null, model: null, cwd, figma, running: false, permissionMode: 'auto', apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], flow: flowOff(), spend: emptySpend() },
      status: 'Idle',
      events: [],
      pending: [],
      recentFiles: [],
    };
    this.approvals = new Approvals(this.state, (m) => this.emit(m));
  }

  get figmaFile() {
    return this.figma;
  }

  setFigma(figma: FigmaFile) {
    if (this.state.session.running) return this.system('Wait for the current turn to finish before attaching a Figma file');
    this.figma = figma;
    this.setSession({ figma });
    if (this.q) this.figmaNote = `A Figma file is now attached to this chat: "${figma.name}" (${figma.url}, file key ${figma.key}). Use the Figma MCP tools on that file from now on.`;
    this.system(`Attached ${figma.name}`);
    if (this.state.session.flow.phase === 'file') void this.toDesign();
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
    const { events, context, cache } = historyFrom(await getSessionMessages(this.resume, { dir: this.cwd }));
    this.state.events.push(...withReviews(events, (await readReview(this.cwd)).runs));
    Object.assign(this.state.session, { context, cache });
  }

  async init() {
    const s = await settings();
    this.rules = rulesBlock(await readRules(this.cwd));
    this.state.session.flow = flowOff(s);
    if (this.resume) this.state.session.spend = await loadChatSpend(this.cwd, this.resume);
    const { servers, configured } = await figmaMcp();
    this.figmaServers = servers;
    this.strictMcp = configured;
  }

  private rules = '';
  private rulesNote = '';
  private figmaNote = '';

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
        figma: this.figma,
        rules: this.rules,
        figmaServers: this.figmaServers,
        strictMcp: this.strictMcp,
        onStatus: (text, nodes) => {
          this.setStatus(text);
          const last = nodes.at(-1);
          if (last) this.onFocus(last);
        },
        canUseTool: (toolName, input, opts) => this.flowTool(toolName, input) ?? this.figmaTool(toolName, input) ?? this.approvals.ask(toolName, input, opts),
        beforeFigma: async (input) => this.beforeFigma(input),
        afterTool: async (input) => this.afterTool(input),
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
        { name: 'design', description: 'Plan, sketch, design in Figma and review' },
        { name: 'sketch', description: 'Plan and sketch directions only' },
        { name: 'review', description: 'Review frames: /review [check|quick|focused|full] [frame links]' },
        { name: 'audit', description: 'Design system check across the whole file, no model calls' },
        { name: 'crit', description: 'Design crit from four viewpoints: /crit [frame links]' },
        { name: 'buildcheck', description: 'Compare a live page with a frame: /buildcheck <url> [frame link]' },
        { name: 'copy', description: 'Copy pass: /copy [frame links] [tone:friendly|neutral|formal]' },
        { name: 'system', description: 'Rebuild the design system profile' },
      ];
      this.setSession({
        models: models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })),
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

  async reconnectMcp(name: string) {
    await this.q?.reconnectMcpServer(name).catch((err) => this.system(`Reconnecting ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.q?.toggleMcpServer(name, enabled).catch((err) => this.system(`${enabled ? 'Enabling' : 'Disabling'} ${name} failed: ${err instanceof Error ? err.message : String(err)}`));
    await this.refreshMcp();
  }

  async setModel(model: string) {
    this.start();
    await this.q?.setModel(model);
    this.setSession({ model });
  }

  async setPermissionMode(mode: string, quiet = false) {
    this.start();
    await this.q?.setPermissionMode(mode as PermissionMode);
    this.setSession({ permissionMode: mode });
    if (!quiet) this.system(`Permission mode: ${mode}`);
  }

  private beforeFigma(input: HookInput): HookJSONOutput {
    if (input.hook_event_name !== 'PreToolUse' || !/use_figma$/.test(input.tool_name)) return {};
    const code = JSON.stringify(input.tool_input ?? {});
    if (code.includes(CHECKPOINT)) {
      if (!this.checkpointed) this.system(`Checkpoint saved in Figma version history${this.figma ? `: ${this.figma.url}` : ''}`);
      this.checkpointed = true;
      return {};
    }
    if (this.checkpointed) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Save a version before you use use_figma in this turn: call use_figma with \`await figma.${CHECKPOINT}("Design Studio: <what you are about to do>")\` first, then continue.`,
      },
    };
  }

  private figmaTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> | null {
    if (!isFigmaTool(toolName)) return null;
    if (FIGMA_WRITE.test(toolName) && this.askBeforeEdit) return null;
    return Promise.resolve({ behavior: 'allow', updatedInput: input });
  }

  private askBeforeEdit = false;

  answerQuestion(id: string, answers: Record<string, string>) {
    this.approvals.answerQuestion(id, answers);
  }

  answerPermission(id: string, allow: boolean, always?: boolean) {
    this.approvals.answerPermission(id, allow, always);
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
    this.enqueue(full, images.blocks);
  }

  private enqueue(text: string, blocks: Parameters<typeof userMessage>[1] = []) {
    this.start();
    this.turns++;
    this.checkpointed = false;
    this.setSession({ running: true });
    if (/^\/compact\b/.test(text.trim())) this.startCompacting();
    if (this.rulesNote) {
      text = `${this.rulesNote}\n\n${text}`;
      this.rulesNote = '';
    }
    if (this.figmaNote) {
      text = `${this.figmaNote}\n\n${text}`;
      this.figmaNote = '';
    }
    this.inputQueue.push(userMessage(text, blocks));
    this.wake?.();
  }

  async interrupt() {
    if (this.state.session.flow.phase === 'file') return this.endFlow('stopped', 'Design run stopped');
    if (this.work && this.turns === 0) {
      this.work.abort();
      this.endFlow('stopped', 'Design run stopped');
      this.setSession({ running: false });
      return;
    }
    if (!this.q || !this.state.session.running || this.state.session.stopping) return;
    this.planChange = null;
    if (this.flowActive()) this.endFlow('stopped', 'Design run stopped');
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
    } catch (err) {
      this.setSession({ stopping: false });
      this.system(`Stop failed: ${String(err)}`);
    }
  }

  async prompt(text: string, refs?: unknown) {
    if (this.sampleBlocked()) return;
    const rules = rulesBlock(await readRules(this.cwd));
    if (rules !== this.rules) {
      if (this.q) this.rulesNote = rules ? `House rules updated, follow these from now on:\n${rules}` : 'House rules updated: there are no house rules now.';
      this.rules = rules;
    }
    const images = await loadImages(this.cwd, refs);
    const st = await settings();
    this.askBeforeEdit = st.askBeforeEdit;
    const cmd = parseCommand(text);
    if (cmd && !this.state.session.running) return this.command(cmd.cmd, cmd.arg, text);
    const { mode, phase } = this.state.session.flow;
    if (mode !== 'chat' && !this.state.session.running && !text.trim().startsWith('/') && phase !== 'pick' && phase !== 'file') {
      if (mode === 'design') return this.startFlow(withRefs(text, images.refs), 'design');
      return this.command('review', text.trim(), text.trim());
    }
    this.sendPrompt(text, images);
  }

  private flowActive() {
    const p = this.state.session.flow.phase;
    return p !== null && (FLOW_ACTIVE.includes(p) || p === 'pick' || p === 'file');
  }

  private onArea = (area: ReviewerState['area'], state: ReviewerState['state']) => {
    const list = this.state.session.flow.reviewers ?? [];
    this.setFlow({ reviewers: list.some((r) => r.area === area) ? list.map((r) => (r.area === area ? { area, state } : r)) : [...list, { area, state }] });
  };

  private setFlow(patch: Partial<FlowState>) {
    this.setSession({ flow: { ...this.state.session.flow, ...patch } });
  }

  updateFlow(patch: Partial<Pick<FlowState, 'mode' | 'preset' | 'areas' | 'stopAfterSketch'>>) {
    const next: Partial<FlowState> = {};
    if (patch.mode && FLOW_MODES.includes(patch.mode)) next.mode = patch.mode;
    if (patch.preset && PRESETS.includes(patch.preset)) next.preset = patch.preset;
    if (Array.isArray(patch.areas)) next.areas = AREAS.filter((a) => patch.areas!.includes(a));
    if (typeof patch.stopAfterSketch === 'boolean') next.stopAfterSketch = patch.stopAfterSketch;
    this.setFlow(next);
  }

  private async command(cmd: 'design' | 'sketch' | 'review' | 'audit' | 'system' | 'crit' | 'copy' | 'buildcheck', arg: string, raw: string) {
    if (this.sampleBlocked()) return;
    if (cmd === 'design' || cmd === 'sketch') {
      if (!arg) return this.system(`Describe what to ${cmd} after /${cmd}`);
      return this.startFlow(arg, cmd);
    }
    this.pushEvent({ id: randomUUID(), kind: 'user', text: raw, at: Date.now() });
    if (!this.figma) return this.system('Link a Figma file to this chat first: start a new chat from a Figma link');
    if (cmd === 'system') return this.background('Building the design system profile', async (signal) => {
      const r = await buildProfile(this.cwd, this.figma!, signal);
      this.recordBackground('system', r);
      this.system(`Design system profile built: ${r.ds.colors.length} colors, ${r.ds.text.length} text styles, ${r.ds.components.length} components (${Math.round(r.tokens / 1000)}k tokens)`);
    });
    if (cmd === 'audit') return this.background('Checking the whole file', async () => {
      const { fileOutline } = await import('./figma.js');
      const frames = (await fileOutline(this.figma!.key)).pages.flatMap((p) => p.frames.map((f) => f.id));
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
    if (!frames.length) frames = (await readDesign(this.cwd))?.frames.map((f) => f.nodeId) ?? [];
    if (!frames.length) return this.system('Review: paste frame links after /review, or run /design first');
    return this.background(`Reviewing ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} (${PRESET_INFO[preset].label})`, async (signal) => {
      const run = await runReview({ dir: this.cwd, fileKey: this.figma!.key, frames, preset, areas: this.state.session.flow.areas, round: 1, kind: 'review', signal, onProgress: (t) => this.setStatus(t), onArea: this.onArea });
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

  private async startFlow(task: string, kind: FlowKind) {
    if (this.sampleBlocked()) return;
    this.pushEvent({ id: randomUUID(), kind: 'user', text: task, at: Date.now() });
    this.task = task;
    this.retried = false;
    this.fixesDone = 0;
    this.lastRun = null;
    this.setFlow({ kind, phase: 'plan', round: 0, tokens: 0 });
    await this.runStep({ phase: 'plan', model: MODELS.plan, mode: 'plan', label: 'Plan · Opus', prompt: planPrompt(task, this.figma, kind) }, false);
  }

  private async runStep(step: Step, marker = true) {
    this.turns++;
    this.setSession({ running: true });
    try {
      if (this.state.session.model !== step.model) await this.setModel(step.model);
      if (this.state.session.permissionMode !== step.mode) await this.setPermissionMode(step.mode, true);
    } finally {
      this.turns--;
    }
    this.setFlow({ phase: step.phase });
    if (marker) this.pushEvent({ id: randomUUID(), kind: 'user', text: step.label, at: Date.now(), phase: step.phase });
    this.enqueue(step.prompt);
  }

  private flowTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> | null {
    if (toolName.endsWith('__set_status')) return Promise.resolve({ behavior: 'allow', updatedInput: input });
    if (toolName !== 'ExitPlanMode' || this.state.session.flow.phase !== 'plan') return null;
    const plan = typeof input.plan === 'string' ? input.plan : '';
    return writeFile(path.join(this.cwd, 'plan.md'), plan).then(() => {
      this.planSaved = true;
      return { behavior: 'deny' as const, message: 'The plan is saved. Stop here and end your turn; the sketch phase starts automatically.' };
    });
  }

  private planSaved = false;

  continueFlow() {
    if (this.state.session.flow.phase !== 'pick' || this.state.session.running) return;
    void this.toDesign();
  }

  private endFlow(phase: 'done' | 'stopped', note: string) {
    this.work?.abort();
    this.setFlow({ phase, reviewers: [] });
    this.system(note);
    if (this.state.session.model !== MODELS.work) void this.setModel(MODELS.work);
    if (this.state.session.permissionMode === 'plan') void this.setPermissionMode('auto', true);
  }

  private async advanceFlow() {
    const flow = this.state.session.flow;
    try {
      switch (flow.phase) {
        case 'plan': {
          if (!this.planSaved && this.lastResult.trim()) await writeFile(path.join(this.cwd, 'plan.md'), this.lastResult);
          this.planSaved = false;
          return this.runStep({ phase: 'sketch', model: MODELS.work, mode: 'auto', label: 'Sketch · Sonnet', prompt: sketchPrompt(flow.stopAfterSketch) });
        }
        case 'sketch': {
          let sketch;
          try {
            sketch = await readSketch(this.cwd);
            if (!sketch) throw new Error('sketch.json was not written');
          } catch (err) {
            if (this.retried) return this.endFlow('stopped', `Design run stopped: ${(err as Error).message}`);
            this.retried = true;
            return this.runStep({ phase: 'sketch', model: MODELS.work, mode: 'auto', label: 'Sketch fix', prompt: sketchFixPrompt((err as Error).message) });
          }
          this.retried = false;
          await renderAll(this.cwd, sketch);
          this.system(`Sketches ready: ${sketch.screens.map((s) => `${s.name} (${s.directions.length})`).join(', ')}. See the Sketch tab.`);
          if (flow.kind === 'sketch') return this.endFlow('done', 'Sketch run finished');
          if (flow.stopAfterSketch && sketch.screens.some((s) => !s.chosen)) {
            this.setFlow({ phase: 'pick' });
            this.setSession({ running: false });
            this.system('Pick a direction for each screen on the Sketch tab, then press Continue');
            return;
          }
          return this.toDesign();
        }
        case 'design': {
          const design = await readDesign(this.cwd);
          if (!design?.frames?.length) {
            if (this.retried) return this.endFlow('stopped', 'Design run stopped: Claude did not list the frames it made, so there is nothing to review');
            this.retried = true;
            return this.runStep({ phase: 'design', model: MODELS.work, mode: 'auto', label: 'Design list', prompt: designFilePrompt });
          }
          this.retried = false;
          return this.review(design.frames.map((f) => f.nodeId), 1, null, 'review');
        }
        case 'fix': {
          this.fixesDone++;
          const design = await readDesign(this.cwd);
          const frames = design?.frames.map((f) => f.nodeId) ?? this.lastRun?.frames ?? [];
          if (afterFix(flow.preset, this.fixesDone) === 'review' && this.lastRun) return this.review(frames, flow.round + 1, failedAreas(this.lastRun), 'review');
          return this.review(frames, flow.round + 1, [], 'verify');
        }
      }
    } catch (err) {
      this.endFlow('stopped', `Design run stopped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async toDesign() {
    if (!this.figma) {
      this.setFlow({ phase: 'file' });
      this.setSession({ running: false });
      this.system('Attach a Figma file to continue the design run');
      return;
    }
    if (!(await readProfile(this.cwd))) {
      this.setFlow({ phase: 'system' });
      this.pushEvent({ id: randomUUID(), kind: 'user', text: 'Design system · Sonnet', at: Date.now(), phase: 'system' });
      await this.background('Building the design system profile', async (signal) => {
        const r = await buildProfile(this.cwd, this.figma!, signal);
        this.addTokens(r.tokens);
        this.recordBackground('system', r);
        this.system(`Design system profile built: ${r.ds.colors.length} colors, ${r.ds.text.length} text styles, ${r.ds.components.length} components`);
      });
      if (this.state.session.flow.phase !== 'system') return;
    }
    const sketch = await readSketch(this.cwd).catch(() => null);
    const hasProfile = Boolean(await readProfile(this.cwd));
    return this.runStep({ phase: 'design', model: MODELS.work, mode: 'auto', label: 'Design · Sonnet', prompt: designPrompt(sketch, hasProfile, this.task, await boardNotes(this.cwd)) });
  }

  private async review(frames: string[], round: number, onlyFailed: Area[] | null, kind: 'review' | 'verify') {
    const flow = this.state.session.flow;
    const preset = kind === 'verify' ? 'check' : flow.preset;
    this.setFlow({ phase: 'review', round, reviewers: [] });
    this.pushEvent({ id: randomUUID(), kind: 'user', text: kind === 'verify' ? 'Final check' : `Review ${round} · ${PRESET_INFO[preset].label}`, at: Date.now(), phase: 'review' });
    let run: ReviewRun | null = null;
    await this.background(kind === 'verify' ? 'Checking the fixes' : 'Reviewing the design', async (signal) => {
      run = await runReview({ dir: this.cwd, fileKey: this.figma!.key, frames, preset, areas: flow.areas, round, kind, onlyFailed, signal, onProgress: (t) => this.setStatus(t), onArea: this.onArea });
    });
    if (this.state.session.flow.phase !== 'review') return;
    this.setFlow({ reviewers: [] });
    if (!run) return this.endFlow('stopped', 'Design run stopped: the review could not run');
    const done: ReviewRun = run;
    this.lastRun = done;
    this.addTokens(done.tokens);
    this.recordBackground('review', done);
    this.reviewDone(done);
    const pending = toFix(done);
    if (kind === 'verify') return this.finish(pending.length);
    const next = afterReview(preset, this.fixesDone, pending);
    if (next.next === 'fix') return this.runStep({ phase: 'fix', model: MODELS.work, mode: 'auto', label: `Fix ${this.fixesDone + 1} · Sonnet`, prompt: fixPrompt(next.fixes, this.fixesDone + 1) });
    return this.finish(pending.length);
  }

  private finish(left: number) {
    const tokens = this.state.session.flow.tokens;
    this.endFlow('done', `Design run finished${left ? `, ${left} issues left for you to look at` : ', review passed'} · ${Math.round(tokens / 1000)}k tokens`);
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

  private recordBackground(phase: 'review' | 'system', r: { tokens: number; costUsd: number }) {
    this.recordSpend(phase, MODELS.work, r.tokens, r.costUsd);
  }

  private recordResult(msg: Extract<SDKMessage, { type: 'result' }>) {
    const p = this.state.session.flow.phase;
    const phase = this.flowActive() && p ? (p === 'fix' ? 'design' : p === 'pick' ? 'sketch' : p === 'file' ? 'design' : p) : 'chat';
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

  private addTokens(n: number) {
    if (this.flowActive() || this.state.session.flow.phase === 'system') this.setFlow({ tokens: this.state.session.flow.tokens + n });
  }

  async steer(text: string, id: string = randomUUID(), refs?: unknown) {
    if (this.sampleBlocked()) return;
    const images = Array.isArray(refs) && refs.length ? await loadImages(this.cwd, refs) : { refs: [], blocks: [] };
    text = withRefs(text, images.refs);
    const running = this.state.session.running;
    const ev: Extract<ChatEvent, { kind: 'user' }> = { id, kind: 'user', text, at: Date.now(), stopping: running };
    this.pushEvent(ev);
    if (running) {
      this.turns++;
      await this.q?.interrupt().catch(() => {});
      this.turns--;
      ev.stopping = false;
      this.emit({ type: 'event', event: ev });
    }
    this.enqueue(text, images.blocks);
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
    if (input.agent_id || input.hook_event_name !== 'PostToolUse') return {};
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
    const flowing = idle && this.flowActive() && this.state.session.flow.phase !== 'pick' && this.state.session.flow.phase !== 'file';
    const next = idle && !flowing ? this.followUp() : null;
    this.setSession({ running: this.turns > 0 || next !== null || flowing, compacting: false, stopping: false });
    if (flowing) void this.advanceFlow();
    else if (next) this.sendPrompt(next);
    if (idle) this.autoCheck(flowing);
  }

  private autoCheck(flowing: boolean) {
    const edited = this.figmaEdited;
    const touched = [...this.touched];
    this.figmaEdited = false;
    this.touched.clear();
    this.figmaUses.clear();
    const key = this.figma?.key;
    if (!edited || flowing || !key || key === SAMPLE_KEY || this.state.session.flow.mode !== 'chat' || this.flowActive() || this.work) return;
    void this.checkEdited(key, touched);
  }

  private async checkEdited(key: string, touched: string[]) {
    if (!(await settings().catch(() => null))?.autoCheck) return;
    try {
      this.setStatus('Checking edited frames');
      const { fileOutline, framesContaining } = await import('./figma.js');
      const all = (await fileOutline(key)).pages.flatMap((p) => p.frames.map((f) => f.id));
      const hit = await framesContaining(key, all, touched).catch(() => all.filter((id) => touched.includes(id)));
      const frames = hit.length ? hit : all;
      if (!frames.length) return;
      const run = await runReview({ dir: this.cwd, fileKey: key, frames, preset: 'check', areas: [], round: 0, kind: 'audit' });
      this.reviewDone(run);
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
    if (this.autoCompact && (this.state.session.context ?? 0) >= COMPACT_AT) {
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
      this.setSession({ running: false, stopping: false });
    }
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          const changed = msg.model !== this.state.session.model;
          this.setSession({ sessionId: msg.session_id, model: msg.model, permissionMode: msg.permissionMode, apiKeySource: msg.apiKeySource, mcp: mcpFrom(msg.mcp_servers, msg.tools) });
          if (changed) this.system(`Session started with ${msg.model}`);
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
          this.turnEnded();
        }
        return;

      case 'stream_event': {
        if (msg.parent_tool_use_id) return;
        const ev = msg.event;
        if (ev.type === 'message_start') this.liveMsgId = ev.message.id;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          const key = `${this.liveMsgId}:${ev.index}`;
          const text = (this.liveText.get(key) ?? '') + ev.delta.text;
          this.liveText.set(key, text);
          const existing = this.state.events.find((e) => e.id === key);
          if (existing && existing.kind === 'assistant') {
            existing.text = text;
            this.emit({ type: 'event', event: existing });
          } else {
            this.pushEvent({ id: key, kind: 'assistant', text, streaming: true, at: Date.now() });
          }
        }
        if (ev.type === 'content_block_stop') {
          const key = `${this.liveMsgId}:${ev.index}`;
          const existing = this.state.events.find((e) => e.id === key);
          if (existing && existing.kind === 'assistant') {
            existing.streaming = false;
            this.emit({ type: 'event', event: existing });
          }
          this.liveText.delete(key);
        }
        return;
      }

      case 'assistant': {
        if (msg.parent_tool_use_id) return;
        this.setSession({ cache: cacheFrom(msg.message.usage, Date.now(), this.state.session.cache), context: contextFrom(msg.message.usage) ?? this.state.session.context });
        for (const block of msg.message.content) {
          if (block.type === 'server_tool_use' && block.name === 'advisor') this.pushEvent(advisorEvent(block.id, Date.now()));
          if (block.type === 'tool_use') {
            this.pushEvent(toolUseEvent(block.id, block.name, block.input, Date.now()));
            const file = (block.input as { file_path?: unknown })?.file_path;
            if (EDIT_TOOLS.has(block.name) && typeof file === 'string') this.edits.set(block.id, file);
            if (/use_figma$/.test(block.name)) {
              this.figmaUses.add(block.id);
              for (const id of touchedIds(JSON.stringify(block.input ?? {}))) this.touched.add(id);
            } else if (block.name.endsWith('__set_status')) {
              for (const id of touchedIds(JSON.stringify((block.input as { nodes?: unknown })?.nodes ?? []))) this.touched.add(id);
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
          if (this.figmaUses.delete(block.tool_use_id) && !block.is_error) {
            this.figmaEdited = true;
            for (const id of touchedIds(toolResultText(block))) this.touched.add(id);
          }
          this.pushEvent({ id: randomUUID(), kind: 'tool_result', toolUseId: block.tool_use_id, text: toolResultText(block).slice(0, 4000), isError: Boolean(block.is_error), at: Date.now() });
        }
        return;
      }

      case 'result': {
        this.liveText.clear();
        this.recordResult(msg);
        const u = msg.usage as any;
        this.addTokens((u?.input_tokens ?? 0) + (u?.output_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0));
        this.lastResult = msg.subtype === 'success' ? msg.result : '';
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
