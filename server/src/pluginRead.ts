import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { MODELS } from '../../shared/design.js';
import { FigmaError } from './figmaError.js';
import { pluginReadCall, readersFor } from './figmaPlugin.js';
import { figmaMcp, lean, type FigmaMcp } from './lean.js';

// Reads a Figma file through the Figma plugin that Claude is logged in to (no REST token).
// One read is one short, cheap Claude run. Claude only makes the calls: hooks on the run put the real script into
// each use_figma call and take every result out before Claude sees it, so the file's content never reaches the model.
//
// When the Design Studio plugin runs in the file (the Figma app's plugin, or figma.com in the Design Studio window),
// a read it knows by name goes to it first: the server sends the name and plain arguments over its socket, never
// code, and the plugin runs the same Plugin API code as the body (figma-plugin/reads.ts). No Claude run, no cost.
// A plugin that is not there, does not know the read, does not start it (the file is not the front tab in Figma) or
// fails, leaves the read to the Claude run.
//
// use_figma caps a return value at 20480 bytes, so a script's value is packed (UTF-8, then LZW, then base64url)
// and returned in pages of PAGE_CHARS characters. Every page call runs the whole script again and returns one slice.

export const PAGE_CHARS = 18000;
const MAX_TRIES = 2;
const MAX_RUNS = 3;

/**
 * Plugin-side packer: UTF-8 bytes, LZW with growing code width (dictionary capped at 2^20), then 6 bits per
 * base64url character. The width for the k-th code is the bit length of min(255 + k, 2^20 - 1) on both sides.
 */
export const PACK_JS = `function __pack(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LIMIT = 1048576;
  const dict = new Map();
  let next = 256, k = 0, w = -1, acc = 0, nbits = 0, out = '';
  const bits = (n) => { let b = 0; while (n > 0) { b++; n = Math.floor(n / 2); } return b; };
  const emit = (code) => {
    const width = bits(Math.min(255 + k, LIMIT - 1));
    k++;
    acc = (acc << width) | code;
    nbits += width;
    while (nbits >= 6) { nbits -= 6; out += A[(acc >> nbits) & 63]; }
    acc &= (1 << nbits) - 1;
  };
  const step = (b) => {
    if (w < 0) { w = b; return; }
    const key = w * 256 + b;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; return; }
    emit(w);
    if (next < LIMIT) dict.set(key, next++);
    w = b;
  };
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) step(c);
    else if (c < 0x800) { step(0xc0 | (c >> 6)); step(0x80 | (c & 63)); }
    else if (c < 0x10000) { step(0xe0 | (c >> 12)); step(0x80 | ((c >> 6) & 63)); step(0x80 | (c & 63)); }
    else { step(0xf0 | (c >> 18)); step(0x80 | ((c >> 12) & 63)); step(0x80 | ((c >> 6) & 63)); step(0x80 | (c & 63)); }
  }
  if (w >= 0) emit(w);
  if (nbits > 0) out += A[(acc << (6 - nbits)) & 63];
  return out;
}`;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LIMIT = 1 << 20;
const bitLength = (n: number) => (n <= 0 ? 0 : 32 - Math.clz32(n));

/** Server side of PACK_JS. */
export function unpack(s: string): string {
  const prefix = new Int32Array(LIMIT);
  const last = new Uint8Array(LIMIT);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; last[i] = i; }
  const out: number[] = [];
  const write = (code: number) => {
    const start = out.length;
    for (let c = code; c >= 0; c = prefix[c]) out.push(last[c]);
    // Codes are read back to front, so the bytes land reversed.
    for (let i = start, j = out.length - 1; i < j; i++, j--) [out[i], out[j]] = [out[j], out[i]];
    return out[start];
  };
  let next = 256;
  let k = 0;
  let acc = 0;
  let nbits = 0;
  let pos = 0;
  let prev = -1;
  for (;;) {
    const width = bitLength(Math.min(255 + k, LIMIT - 1));
    while (nbits < width && pos < s.length) {
      const v = ALPHABET.indexOf(s[pos++]);
      if (v < 0) throw new FigmaError('The Figma plugin sent data Design Studio cannot read', 502);
      acc = ((acc << 6) | v) & 0x3fffffff;
      nbits += 6;
    }
    if (nbits < width) break;
    nbits -= width;
    const code = (acc >> nbits) & ((1 << width) - 1);
    k++;
    let first: number;
    if (code < next) first = write(code);
    else if (code === next && prev >= 0) {
      // The KwKwK case: the code being defined right now is the previous string plus its own first byte.
      const head = write(prev);
      out.push(head);
      first = head;
    } else throw new FigmaError('The Figma plugin sent data Design Studio cannot read', 502);
    if (prev >= 0 && next < LIMIT) {
      prefix[next] = prev;
      last[next] = first;
      next++;
    }
    prev = code;
  }
  return Buffer.from(out).toString('utf8');
}

/**
 * Wraps a script body (plain Plugin API code that ends with `return value`) so one call returns one page of the
 * packed value. PAGE is filled in per call by the read hooks.
 */
export function pagedScript(body: string, page: number) {
  return `const __PAGE = ${page};
const __value = await (async () => {
${body}
})();
${PACK_JS}
const __s = __pack(JSON.stringify(__value === undefined ? null : __value));
const __pages = Math.max(1, Math.ceil(__s.length / ${PAGE_CHARS}));
return { ds: 1, page: __PAGE, pages: __pages, len: __s.length, data: __s.slice(__PAGE * ${PAGE_CHARS}, (__PAGE + 1) * ${PAGE_CHARS}) };`;
}

type PageResult = { ds: 1; page: number; pages: number; len: number; data: string };

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return undefined;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      return undefined;
    }
  }
}

/** Finds the first object a test accepts in a tool response, whatever envelope it comes in. */
export function findIn<T>(v: unknown, test: (x: any) => boolean, depth = 0): T | null {
  if (depth > 6 || v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || t.includes('{') ? findIn<T>(tryJson(t), test, depth + 1) : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const p = findIn<T>(x, test, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (typeof v !== 'object') return null;
  if (test(v)) return v as T;
  for (const x of Object.values(v)) {
    const p = findIn<T>(x, test, depth + 1);
    if (p) return p;
  }
  return null;
}

export const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join('\n') : v && typeof v === 'object' ? textOf((v as any).text ?? (v as any).error ?? (v as any).content ?? '') : '');

const isPage = (x: any) => x && x.ds === 1 && typeof x.page === 'number' && typeof x.len === 'number' && typeof x.data === 'string';
const URL_RE = /https:\/\/[^\s"'\\)]+/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const normId = (id: unknown) => String(id ?? '').replace('-', ':');

/** Turns what the plugin said into an error a designer can act on. */
export function figmaFailure(text: string): FigmaError {
  const t = text.replace(/\s+/g, ' ').trim();
  // A call Design Studio's own read did not allow (Figma's create_session, say) is not her login or her access.
  if (/create_session|don.?t.?ask|dontAsk|was denied|denied (by|because)|not allowed here|permission to use/i.test(t)) return new FigmaError(`Design Studio stopped a Figma call its read needed, so nothing was read. This is not a Figma login problem. ${t.slice(0, 160)}`, 502);
  if (/not (logged|signed) in|log ?in|sign ?in|unauthori[sz]ed|authenticat|\b401\b|oauth/i.test(t)) return new FigmaError('Figma is not logged in. Log in to Figma, then try again.', 401);
  if (/\b403\b|forbidden|no access|permission|cannot access|not have access/i.test(t)) return new FigmaError('This Figma account cannot open the file. Log in to Figma with an account that can, then try again.', 403);
  if (/\b404\b|not found|does not exist/i.test(t)) return new FigmaError('Figma could not find that file or frame. Check the link, then try again.', 404);
  if (!t) return new FigmaError('Figma did not answer the read. Try again in a moment.', 502);
  return new FigmaError(`Figma could not read the file: ${t.slice(0, 200)}`, 502);
}

/**
 * The state of one read, driven by the hooks. Kept apart from the SDK so tests can play calls into it.
 * A read has one or more script parts (say, a few frames each), and each part is paged on its own, so a page call
 * only walks its own part.
 */
export class ReadState {
  readonly bodies: string[];
  readonly chunks = new Map<string, string>();
  readonly pages: Array<number | null>;
  readonly lens: Array<number | null>;
  readonly shots = new Map<string, string | null>();
  readonly tries = new Map<string, number>();
  readonly inFlight = new Map<string, [number, number]>();
  errors: string[] = [];
  calls = 0;
  fatal: string | null = null;
  /** The Figma session every file call carries (create_session made it), or null until it is made. */
  sessionId: string | null;

  constructor(readonly opts: { fileKey: string; what: string; body?: string | string[]; shots?: { ids: string[]; maxDimension: number }; use: string; shot: string; session?: string; sessionId?: string | null }) {
    this.sessionId = opts.sessionId ?? null;
    this.bodies = opts.body === undefined ? [] : Array.isArray(opts.body) ? opts.body : [opts.body];
    this.pages = this.bodies.map(() => null);
    this.lens = this.bodies.map(() => null);
  }

  /** Page calls still to make, counting one for each part whose page count is not known yet. */
  get pagesLeft() {
    return this.bodies.reduce((n, _, part) => n + (this.pages[part] ?? 1), 0) - this.chunks.size;
  }

  get pagesDone() {
    return this.pages.every((p) => p !== null) && this.pagesLeft <= 0;
  }

  get shotsLeft() {
    return (this.opts.shots?.ids ?? []).filter((id) => !this.shots.has(id));
  }

  get done() {
    return this.pagesDone && !this.shotsLeft.length;
  }

  private nextPage(): [number, number] | null {
    const busy = new Set([...this.inFlight.values()].map(([a, b]) => `${a}:${b}`));
    for (let part = 0; part < this.bodies.length; part++) {
      const total = this.pages[part] ?? 1;
      for (let p = 0; p < total; p++) if (!this.chunks.has(`${part}:${p}`) && !busy.has(`${part}:${p}`)) return [part, p];
    }
    return null;
  }

  private nextStep(): string {
    if (this.fatal) return `Stop now and reply with ok false and this note: ${this.fatal}`;
    if (!this.pagesDone) {
      const left = Math.max(1, this.pagesLeft);
      return `Saved. Call ${this.opts.use} again with code "PAGE" (${left} more ${left === 1 ? 'call' : 'calls'}).`;
    }
    const left = this.shotsLeft;
    if (left.length) return `Saved. Now call ${this.opts.shot} once for each of these node ids: ${left.join(', ')}.`;
    return 'Saved. Everything is read. Reply with ok true now.';
  }

  private get sid() {
    return this.sessionId ? { sessionId: this.sessionId } : {};
  }

  /** PreToolUse: puts the real arguments into the call, or turns it away when there is nothing left to read. */
  pre(toolName: string, input: any, id: string): HookJSONOutput {
    const deny = (reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (toolName === this.opts.session) {
      // Figma wants a session before any file tool. One is enough for the whole read.
      if (this.sessionId) return deny(`The session is made already. ${this.nextStep()}`);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { fileKey: this.opts.fileKey, description: `Design Studio: ${this.opts.what}` } } };
    }
    if (toolName === this.opts.use) {
      if (!this.bodies.length) return deny(`Do not call ${this.opts.use} for this read. ${this.nextStep()}`);
      if (this.fatal) return deny(this.nextStep());
      const next = this.nextPage();
      if (next === null) return deny(this.nextStep());
      this.inFlight.set(id, next);
      this.calls++;
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { fileKey: this.opts.fileKey, description: this.opts.what, code: pagedScript(this.bodies[next[0]], next[1]), ...this.sid } } };
    }
    if (toolName === this.opts.shot) {
      const nodeId = normId(input?.nodeId);
      if (!this.opts.shots?.ids.includes(nodeId)) return deny(`That node id is not on the list. ${this.nextStep()}`);
      this.calls++;
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { fileKey: this.opts.fileKey, nodeId, maxDimension: this.opts.shots.maxDimension, ...this.sid } } };
    }
    return deny('Only the Figma read tools are allowed here.');
  }

  /** PostToolUse: keeps the result and gives the model only the next step. */
  post(toolName: string, input: any, response: unknown, id: string): HookJSONOutput {
    const reply = (text: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: [{ type: 'text', text }] } });
    if (toolName === this.opts.session) {
      const got = findIn<{ sessionId: string }>(response, (x) => typeof x?.sessionId === 'string' && UUID_RE.test(x.sessionId))?.sessionId ?? UUID_RE.exec(textOf(response))?.[0] ?? null;
      if (got) this.sessionId = got;
      return reply(`Session made. Design Studio adds it to each call. ${this.nextStep()}`);
    }
    if (toolName === this.opts.use) {
      const at = this.inFlight.get(id);
      this.inFlight.delete(id);
      const got = findIn<PageResult>(response, isPage);
      if (!at) return reply(this.nextStep());
      if (!got || got.page !== at[1]) return reply(this.failed(at, textOf(response) || 'The script returned nothing'));
      const [part] = at;
      if (this.lens[part] !== null && got.len !== this.lens[part]) {
        this.fatal = 'The file changed while it was being read. Try again.';
        return reply(this.nextStep());
      }
      this.lens[part] = got.len;
      this.pages[part] = got.pages;
      this.chunks.set(`${part}:${got.page}`, got.data);
      return reply(this.nextStep());
    }
    if (toolName === this.opts.shot) {
      const nodeId = normId(input?.nodeId);
      const json = findIn<any>(response, (x) => typeof x?.image_url === 'string' || typeof x?.imageUrl === 'string' || typeof x?.url === 'string');
      const url = json?.image_url ?? json?.imageUrl ?? json?.url ?? URL_RE.exec(textOf(response))?.[0] ?? null;
      this.shots.set(nodeId, url);
      return reply(this.nextStep());
    }
    return {};
  }

  /** PostToolUseFailure: a page that fails is tried once more, then the read stops. */
  fail(toolName: string, input: any, error: string, id: string): HookJSONOutput {
    const extra = (text: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: text } });
    // Figma reads files without a session too, so a session that fails is noted and the read goes on.
    if (toolName === this.opts.session) {
      this.errors.push(`Figma did not start a session: ${error}`);
      return extra(`Go on without the session. ${this.nextStep()}`);
    }
    if (toolName === this.opts.use) {
      const at = this.inFlight.get(id);
      this.inFlight.delete(id);
      return extra(at ? this.failed(at, error) : this.nextStep());
    }
    if (toolName === this.opts.shot) {
      this.errors.push(error);
      this.shots.set(normId(input?.nodeId), null);
      return extra(this.nextStep());
    }
    return {};
  }

  private failed([part, page]: [number, number], error: string) {
    this.errors.push(error);
    const key = `${part}:${page}`;
    const n = (this.tries.get(key) ?? 0) + 1;
    this.tries.set(key, n);
    if (n >= MAX_TRIES) this.fatal = error.replace(/\s+/g, ' ').slice(0, 300);
    return this.nextStep();
  }

  /** The script's value rebuilt from its pages: one value, or one per part when the body was a list. */
  value(): unknown {
    if (!this.bodies.length) return null;
    if (!this.pagesDone) throw figmaFailure(this.fatal ?? this.errors.at(-1) ?? (this.calls ? 'The read stopped before every page came back' : ''));
    const values = this.bodies.map((_, part) => JSON.parse(unpack([...Array(this.pages[part]!).keys()].map((p) => this.chunks.get(`${part}:${p}`)!).join(''))));
    return Array.isArray(this.opts.body) ? values : values[0];
  }
}

export type ReadSpec = {
  fileKey: string;
  dir: string;
  /** Shown in Figma as the call's description. */
  what: string;
  /**
   * Plugin API code ending with `return value`. Read only: no setters, no page switches, no version saves.
   * A list is read part by part, and the value is then a list too.
   */
  body?: string | string[];
  shots?: { ids: string[]; maxDimension: number };
  signal?: AbortSignal;
  /** Reads with the same key share one run while it is in flight. */
  key?: string;
  /** The plugin's own read that gives the same value as `body` (figma-plugin/reads.ts), tried first. Reads only. */
  socket?: SocketRead;
};

/** A read the plugin runs itself: its name in figma-plugin/reads.ts and its plain arguments. `ms`: the longest it may take once Figma started it. */
export type SocketRead = { name: string; args?: Record<string, unknown>; ms?: number };

export type ReadResult = { value: unknown; shots: Record<string, string | null>; costUsd: number; tokens: number; ms: number };

export type ReadDeps = { run?: typeof lean; mcp?: FigmaMcp };

let running = 0;
const queue: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNS) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

const inFlight = new Map<string, Promise<ReadResult>>();

/** Design Studio's background reads of a file are one piece of work to Figma: one session per file, new after an hour without reads. */
const SESSION_MS = 60 * 60_000;
const sessions = new Map<string, { id: string; at: number }>();
const sessionFor = (fileKey: string) => {
  const s = sessions.get(fileKey);
  return s && Date.now() - s.at < SESSION_MS ? s.id : null;
};

export type ReadCost = { dir: string; costUsd: number; tokens: number };
let costSink: ((c: ReadCost) => void) | null = null;

/** Where the cost of every read goes, failed ones too: each read is a short Claude run that counts toward spend. */
export function onReadCost(fn: ((c: ReadCost) => void) | null) {
  costSink = fn;
}

/** Sends the cost of another short Figma run (New project's whoami and create file) to the same place. */
export function reportCost(c: ReadCost) {
  try {
    if (c.costUsd || c.tokens) costSink?.(c);
  } catch (err) {
    console.error('read cost:', err);
  }
}

const SYSTEM = 'You make Figma read calls for Design Studio exactly as told. The tools fill in their own code and settings, so pass the arguments as given. You never edit the file, never load skills and never call other tools.';

function hookFor(state: ReadState, tools: string[]): Partial<Record<'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure', HookCallbackMatcher[]>> {
  const matcher = tools.join('|');
  const on = (fn: (input: any, id: string) => HookJSONOutput) => [{ matcher, hooks: [async (input: HookInput, id?: string) => fn(input, String(id ?? (input as any).tool_use_id ?? ''))] }];
  return {
    PreToolUse: on((i, id) => state.pre(i.tool_name, i.tool_input, id)),
    PostToolUse: on((i, id) => state.post(i.tool_name, i.tool_input, i.tool_response, id)),
    PostToolUseFailure: on((i, id) => state.fail(i.tool_name, i.tool_input, String(i.error ?? ''), id)),
  };
}

async function readOnce(spec: ReadSpec, deps: ReadDeps): Promise<ReadResult> {
  // A test that reaches a real read would spend money and touch Figma: only fakes run under vitest.
  if (process.env.VITEST && !deps.run) throw new FigmaError('Tests never read Figma for real', 412);
  const { servers, plugins, name, configured } = deps.mcp ?? (await figmaMcp());
  if (!configured) throw new FigmaError('Figma is not connected to Claude yet. Log in to Figma, then try again.', 412);
  const use = `mcp__${name}__use_figma`;
  const shot = `mcp__${name}__get_screenshot`;
  const session = `mcp__${name}__create_session`;
  const ids = [...new Set((spec.shots?.ids ?? []).map(normId))];
  const known = sessionFor(spec.fileKey);
  const state = new ReadState({ fileKey: spec.fileKey, what: spec.what, body: spec.body, shots: spec.shots ? { ids, maxDimension: spec.shots.maxDimension } : undefined, use, shot, session, sessionId: known });
  const steps = [
    // Figma's instructions ask for a session before any file tool. Left out, the model asks for it anyway, and a
    // run that may not make one stops before reading anything. The file's last session is reused, which saves a turn.
    known
      ? `The Figma session for this file is made already (sessionId ${known}), and Design Studio adds it to each call, so do not call ${session}.`
      : `First call ${session} with fileKey "${spec.fileKey}" and description "Design Studio: ${spec.what}". Design Studio adds the session to each later call.`,
    state.bodies.length ? `Call ${use} with fileKey "${spec.fileKey}", description "${spec.what}" and code "PAGE". Each result says whether to call it again; keep calling until it says so no more.` : '',
    ids.length ? `${state.bodies.length ? 'Then call' : 'Call'} ${shot} once for each of these node ids, with fileKey "${spec.fileKey}": ${ids.join(', ')}. You may put several of these calls in one message.` : '',
    'When a result says everything is read, reply with ok true. If a result tells you to stop, reply with ok false and the note it gives.',
  ].filter(Boolean);
  const t0 = Date.now();
  const r = await (deps.run ?? lean)<{ ok: boolean; note?: string }>(steps.join('\n'), {
    cwd: spec.dir,
    model: MODELS.read,
    system: SYSTEM,
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['ok'], additionalProperties: false },
    tools: [],
    mcp: servers,
    plugins,
    allowed: [session, use, shot],
    // One turn for the session, one per page or batch of shots, plus room for retries and the reply.
    maxTurns: 12 + ids.length + (state.bodies.length ? 24 + 2 * state.bodies.length : 0),
    signal: spec.signal,
    hooks: hookFor(state, [session, use, shot]),
  });
  try {
    if (r.costUsd || r.tokens) costSink?.({ dir: spec.dir, costUsd: r.costUsd, tokens: r.tokens });
  } catch (err) {
    console.error('read cost:', err);
  }
  if (spec.signal?.aborted) throw new FigmaError('Stopped', 499);
  if (!state.done && !state.fatal && !state.errors.length && r.error) state.errors.push(r.error);
  // A run that stopped before any file call says why in its note (a call it could not make, say).
  if (!state.done && !state.fatal && !state.calls && r.data?.note) state.errors.push(r.data.note);
  if (state.sessionId && !/session/i.test(state.fatal ?? state.errors.at(-1) ?? '')) sessions.set(spec.fileKey, { id: state.sessionId, at: Date.now() });
  else sessions.delete(spec.fileKey);
  const value = state.value();
  if (ids.length && !state.bodies.length && ![...state.shots.values()].some(Boolean)) throw figmaFailure(state.errors.at(-1) ?? r.data?.note ?? '');
  return { value, shots: Object.fromEntries(ids.map((id) => [id, state.shots.get(id) ?? null])), costUsd: r.costUsd, tokens: r.tokens, ms: Date.now() - t0 };
}

/** The read through the plugin's socket, or null when no plugin in the file can give it: the Claude run reads it then. */
async function socketRead(spec: ReadSpec): Promise<ReadResult | null> {
  const want = spec.socket;
  if (!want || spec.shots || typeof spec.body !== 'string') return null;
  const t0 = Date.now();
  // At most two tries (the Figma view, then the Figma app), so a file Figma holds back costs seconds, not minutes.
  for (const conn of readersFor(spec.fileKey, want.name).slice(0, 2)) {
    if (spec.signal?.aborted) throw new FigmaError('Stopped', 499);
    const r = await pluginReadCall(conn, want.name, want.args ?? {}, { ms: want.ms, signal: spec.signal });
    if (spec.signal?.aborted) throw new FigmaError('Stopped', 499);
    const via = conn.embed ? 'the Figma view' : 'the Figma app plugin';
    if ('value' in r) {
      console.log(`figma read: ${want.name} through ${via} in ${Date.now() - t0} ms, no Claude run`);
      return { value: r.value, shots: {}, costUsd: 0, tokens: 0, ms: Date.now() - t0 };
    }
    console.log(`figma read: ${want.name} through ${via} failed after ${Date.now() - t0} ms (${r.error})`);
  }
  return null;
}

/** Runs one read through the Figma plugin, at most MAX_RUNS at a time, sharing in-flight reads with the same key. */
export function pluginRead(spec: ReadSpec, deps: ReadDeps = {}): Promise<ReadResult> {
  const key = spec.key ? `${spec.fileKey}|${spec.key}` : null;
  const hit = key ? inFlight.get(key) : undefined;
  if (hit) return hit;
  // A session Figma no longer takes is dropped in readOnce, so the one retry makes a new one.
  const claude = () => slot(() => readOnce(spec, deps).catch((err: Error) => (/session/i.test(err.message) && !spec.signal?.aborted ? readOnce(spec, deps) : Promise.reject(err))));
  const p = socketRead(spec).catch((err: Error) => (spec.signal?.aborted ? Promise.reject(err) : null)).then((r) => r ?? claude());
  if (key) {
    inFlight.set(key, p);
    const clear = () => inFlight.delete(key);
    p.then(clear, clear);
  }
  return p;
}

/** Runs a read-only script and returns its value. */
export async function pluginScript<T = unknown>(fileKey: string, body: string, what: string, opts: { dir: string; signal?: AbortSignal; key?: string; socket?: SocketRead } & ReadDeps): Promise<{ value: T; costUsd: number; ms: number }> {
  const r = await pluginRead({ fileKey, body, what, dir: opts.dir, signal: opts.signal, key: opts.key, socket: opts.socket }, opts);
  return { value: r.value as T, costUsd: r.costUsd, ms: r.ms };
}

/** Screenshot URLs (short lived, fetch them soon) for node ids, longest edge at most maxDimension pixels. */
export async function pluginShots(fileKey: string, ids: string[], maxDimension: number, opts: { dir: string; signal?: AbortSignal } & ReadDeps): Promise<Record<string, string | null>> {
  if (!ids.length) return {};
  const key = `shots:${maxDimension}:${[...ids].sort().join(',')}`;
  return (await pluginRead({ fileKey, what: 'Take screenshots (read only)', shots: { ids, maxDimension }, dir: opts.dir, signal: opts.signal, key }, opts)).shots;
}
