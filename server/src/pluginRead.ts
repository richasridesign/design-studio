import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { MODELS } from '../../shared/design.js';
import { FigmaError } from './figmaError.js';
import { figmaMcp, lean, type FigmaMcp } from './lean.js';

// Reads a Figma file through the Figma plugin that Claude is logged in to (no REST token).
// One read is one short, cheap Claude run. Claude only makes the calls: hooks on the run put the real script into
// each use_figma call and take every result out before Claude sees it, so the file's content never reaches the model.
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

const isPage = (x: any) => x && x.ds === 1 && typeof x.page === 'number' && typeof x.data === 'string';
const URL_RE = /https:\/\/[^\s"'\\)]+/;
const normId = (id: unknown) => String(id ?? '').replace('-', ':');

/** Turns what the plugin said into an error a designer can act on. */
export function figmaFailure(text: string): FigmaError {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/not (logged|signed) in|log ?in|sign ?in|unauthori[sz]ed|authenticat|\b401\b|oauth/i.test(t)) return new FigmaError('Figma is not logged in. Log in to Figma, then try again.', 401);
  if (/\b403\b|forbidden|no access|permission|cannot access|not have access/i.test(t)) return new FigmaError('This Figma account cannot open the file. Log in to Figma with an account that can, then try again.', 403);
  if (/\b404\b|not found|does not exist/i.test(t)) return new FigmaError('Figma could not find that file or frame. Check the link, then try again.', 404);
  if (!t) return new FigmaError('Design Studio could not reach Figma. Log in to Figma, then try again.', 502);
  return new FigmaError(`Figma could not read the file: ${t.slice(0, 200)}`, 502);
}

/** The state of one read, driven by the hooks. Kept apart from the SDK so tests can play calls into it. */
export class ReadState {
  readonly chunks = new Map<number, string>();
  pages: number | null = null;
  len: number | null = null;
  readonly shots = new Map<string, string | null>();
  readonly tries = new Map<number, number>();
  readonly inFlight = new Map<string, number>();
  errors: string[] = [];
  calls = 0;
  fatal: string | null = null;

  constructor(readonly opts: { fileKey: string; what: string; body?: string; shots?: { ids: string[]; maxDimension: number }; use: string; shot: string }) {}

  get pagesDone() {
    return !this.opts.body || (this.pages !== null && this.chunks.size >= this.pages);
  }

  get shotsLeft() {
    return (this.opts.shots?.ids ?? []).filter((id) => !this.shots.has(id));
  }

  get done() {
    return this.pagesDone && !this.shotsLeft.length;
  }

  private nextPage(): number | null {
    const busy = new Set(this.inFlight.values());
    const total = this.pages ?? 1;
    for (let p = 0; p < total; p++) if (!this.chunks.has(p) && !busy.has(p)) return p;
    return null;
  }

  private nextStep(): string {
    if (this.fatal) return `Stop now and reply with ok false and this note: ${this.fatal}`;
    if (!this.pagesDone) {
      const left = (this.pages ?? 1) - this.chunks.size;
      return `Saved. Call ${this.opts.use} again with code "PAGE" (${left} more ${left === 1 ? 'call' : 'calls'}).`;
    }
    const left = this.shotsLeft;
    if (left.length) return `Saved. Now call ${this.opts.shot} once for each of these node ids: ${left.join(', ')}.`;
    return 'Saved. Everything is read. Reply with ok true now.';
  }

  /** PreToolUse: puts the real arguments into the call, or turns it away when there is nothing left to read. */
  pre(toolName: string, input: any, id: string): HookJSONOutput {
    const deny = (reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (toolName === this.opts.use) {
      if (!this.opts.body) return deny(`Do not call ${this.opts.use} for this read. ${this.nextStep()}`);
      const page = this.nextPage();
      if (page === null) return deny(this.nextStep());
      this.inFlight.set(id, page);
      this.calls++;
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { fileKey: this.opts.fileKey, description: this.opts.what, code: pagedScript(this.opts.body, page) } } };
    }
    if (toolName === this.opts.shot) {
      const nodeId = normId(input?.nodeId);
      if (!this.opts.shots?.ids.includes(nodeId)) return deny(`That node id is not on the list. ${this.nextStep()}`);
      this.calls++;
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { fileKey: this.opts.fileKey, nodeId, maxDimension: this.opts.shots.maxDimension } } };
    }
    return deny('Only the Figma read tools are allowed here.');
  }

  /** PostToolUse: keeps the result and gives the model only the next step. */
  post(toolName: string, input: any, response: unknown, id: string): HookJSONOutput {
    const reply = (text: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: [{ type: 'text', text }] } });
    if (toolName === this.opts.use) {
      const page = this.inFlight.get(id);
      this.inFlight.delete(id);
      const got = findIn<PageResult>(response, isPage);
      if (!got || page === undefined) return reply(this.failed(page ?? 0, textOf(response) || 'The script returned nothing'));
      if (this.len !== null && got.len !== this.len) {
        this.fatal = 'The file changed while it was being read. Try again.';
        return reply(this.nextStep());
      }
      this.len = got.len;
      this.pages = got.pages;
      this.chunks.set(got.page, got.data);
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
    if (toolName === this.opts.use) {
      const page = this.inFlight.get(id) ?? 0;
      this.inFlight.delete(id);
      return extra(this.failed(page, error));
    }
    if (toolName === this.opts.shot) {
      this.errors.push(error);
      this.shots.set(normId(input?.nodeId), null);
      return extra(this.nextStep());
    }
    return {};
  }

  private failed(page: number, error: string) {
    this.errors.push(error);
    const n = (this.tries.get(page) ?? 0) + 1;
    this.tries.set(page, n);
    if (n >= MAX_TRIES) this.fatal = error.replace(/\s+/g, ' ').slice(0, 300);
    return this.nextStep();
  }

  /** The script's value, rebuilt from its pages. */
  value(): unknown {
    if (!this.opts.body) return null;
    if (!this.pagesDone) throw figmaFailure(this.fatal ?? this.errors.at(-1) ?? (this.calls ? 'The read stopped before every page came back' : ''));
    const packed = [...Array(this.pages!).keys()].map((p) => this.chunks.get(p)!).join('');
    return JSON.parse(unpack(packed));
  }
}

export type ReadSpec = {
  fileKey: string;
  dir: string;
  /** Shown in Figma as the call's description. */
  what: string;
  /** Plugin API code ending with `return value`. Read only: no setters, no page switches, no version saves. */
  body?: string;
  shots?: { ids: string[]; maxDimension: number };
  signal?: AbortSignal;
  /** Reads with the same key share one run while it is in flight. */
  key?: string;
};

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
  const { servers, plugins, name, configured } = deps.mcp ?? (await figmaMcp());
  if (!configured) throw new FigmaError('Figma is not connected to Claude yet. Log in to Figma, then try again.', 412);
  const use = `mcp__${name}__use_figma`;
  const shot = `mcp__${name}__get_screenshot`;
  const ids = [...new Set((spec.shots?.ids ?? []).map(normId))];
  const state = new ReadState({ fileKey: spec.fileKey, what: spec.what, body: spec.body, shots: spec.shots ? { ids, maxDimension: spec.shots.maxDimension } : undefined, use, shot });
  const steps = [
    spec.body ? `Call ${use} with fileKey "${spec.fileKey}", description "${spec.what}" and code "PAGE". Each result says whether to call it again; keep calling until it says so no more.` : '',
    ids.length ? `${spec.body ? 'Then call' : 'Call'} ${shot} once for each of these node ids, with fileKey "${spec.fileKey}": ${ids.join(', ')}. You may put several of these calls in one message.` : '',
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
    allowed: [use, shot],
    // One turn per page or batch of shots, plus room for a retry and the reply.
    maxTurns: 8 + ids.length + (spec.body ? 30 : 0),
    signal: spec.signal,
    hooks: hookFor(state, [use, shot]),
  });
  if (spec.signal?.aborted) throw new FigmaError('Stopped', 499);
  if (!state.done && !state.fatal && !state.errors.length && r.error) state.errors.push(r.error);
  const value = state.value();
  if (ids.length && !spec.body && ![...state.shots.values()].some(Boolean)) throw figmaFailure(state.errors.at(-1) ?? r.data?.note ?? '');
  return { value, shots: Object.fromEntries(ids.map((id) => [id, state.shots.get(id) ?? null])), costUsd: r.costUsd, tokens: r.tokens, ms: Date.now() - t0 };
}

/** Runs one read through the Figma plugin, at most MAX_RUNS at a time, sharing in-flight reads with the same key. */
export function pluginRead(spec: ReadSpec, deps: ReadDeps = {}): Promise<ReadResult> {
  const key = spec.key ? `${spec.fileKey}|${spec.key}` : null;
  const hit = key ? inFlight.get(key) : undefined;
  if (hit) return hit;
  const p = slot(() => readOnce(spec, deps));
  if (key) {
    inFlight.set(key, p);
    const clear = () => inFlight.delete(key);
    p.then(clear, clear);
  }
  return p;
}

/** Runs a read-only script and returns its value. */
export async function pluginScript<T = unknown>(fileKey: string, body: string, what: string, opts: { dir: string; signal?: AbortSignal; key?: string } & ReadDeps): Promise<{ value: T; costUsd: number; ms: number }> {
  const r = await pluginRead({ fileKey, body, what, dir: opts.dir, signal: opts.signal, key: opts.key }, opts);
  return { value: r.value as T, costUsd: r.costUsd, ms: r.ms };
}

/** Screenshot URLs (short lived, fetch them soon) for node ids, longest edge at most maxDimension pixels. */
export async function pluginShots(fileKey: string, ids: string[], maxDimension: number, opts: { dir: string; signal?: AbortSignal } & ReadDeps): Promise<Record<string, string | null>> {
  if (!ids.length) return {};
  const key = `shots:${maxDimension}:${[...ids].sort().join(',')}`;
  return (await pluginRead({ fileKey, what: 'Take screenshots (read only)', shots: { ids, maxDimension }, dir: opts.dir, signal: opts.signal, key }, opts)).shots;
}
