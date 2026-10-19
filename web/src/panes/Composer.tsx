import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, notice, send, steer, useStore } from '../store';
import { Icon } from '../Icon';
import { Voice, useDictation } from './Voice';
import { FileIcon } from './Explorer';
import { match } from './FileSwitcher';
import { COMPACT_AT, type ChatEvent } from '../../../shared/protocol';
import { FLOW_MODES, TONES, figmaNodeUrl, type FlowMode, type Settings } from '../../../shared/design';
import { DepthLink } from './ReviewSetup';
import { recipeText, useCustomRecipes } from '../recipes';
import { RECIPES, toRecipe, type Recipe } from '../../../shared/recipes';
import { imageProblem, imagesIn } from './attach';
import { useThumbs } from '../useThumbs';
import { useOutline } from '../outline';
import { LongRunButton, LongRunHint, type LongRunStart } from './LongRun';
import { ModelPicker } from './ModelPicker';
import { usePopAbove } from './abovePop';
import { focusChecked, menuKeys } from '../press';
import { useTip } from '../Tip';
import { waitingPlaceholder } from './typedAnswer';
import { markSent, publishDraft, readInserted, routeMessage, sentItems } from './awaitingSent';
import '../composer.css';

export type Trigger = { kind: 'command' | 'file' | 'frame'; start: number; query: string } | { kind: 'shell' } | null;

export type Ranked<T> = { item: T; hits: number[]; score: number };

export const MODE_INFO: Record<FlowMode, { label: string; detail: string; placeholder: string; icon: string }> = {
  chat: { label: 'Chat', detail: 'Talk to Claude at any step. Edits Figma when you ask.', placeholder: 'Ask Claude anything, or paste a Figma link', icon: 'comment' },
  design: { label: 'Design', detail: 'Claude plans, sketches, builds and reviews in Figma for you.', placeholder: 'Describe the screens you need. Claude plans, builds and reviews them.', icon: 'sparkle' },
  review: { label: 'Review', detail: 'Reviewers check the frames. No edits.', placeholder: 'What should the reviewers look at?', icon: 'checklist' },
};

export const nextMode = (m: FlowMode): FlowMode => FLOW_MODES[(FLOW_MODES.indexOf(m) + 1) % FLOW_MODES.length];

export const MAX_ROWS = 8;
const MAX_COMMANDS = 30;
export const MAX_STORED = 50;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function triggerAt(text: string, caret: number): Trigger {
  if (text.startsWith('!')) return { kind: 'shell' };
  const before = text.slice(0, Math.min(caret, text.length));
  const m = /(?:^|\s)([/@#])(\S*)$/.exec(before);
  if (!m) return null;
  return { kind: m[1] === '/' ? 'command' : m[1] === '@' ? 'file' : 'frame', start: before.length - 1 - m[2].length, query: m[2] };
}

function rank<T>(items: T[], key: (t: T) => string, query: string, limit: number): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = match(key(item), query);
    if (m) out.push({ item, hits: m.hits, score: m.score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const rankCommands = <T extends { name: string }>(commands: T[], query: string, limit = MAX_ROWS) => rank(commands, (c) => c.name, query, limit);

export const rankFiles = (files: string[], query: string, limit = MAX_ROWS) => rank(files, (f) => f, query, limit);

export type FrameRef = { id: string; name: string; page: string };

const ATTACH_ROW: FrameRef = { id: '', name: 'Attach a Figma file to list its frames', page: '' };

export const rankFrames = (frames: FrameRef[], query: string, limit = MAX_ROWS) => rank(frames, (f) => f.name, query, limit);

export function recentFrameIds(events: ChatEvent[]): string[] {
  const ids: string[] = [];
  for (const e of [...events].reverse()) {
    if (e.kind !== 'tool_use' || !/figma|set_status/i.test(e.name)) continue;
    for (const m of JSON.stringify(e.input).matchAll(/(?<![\w:.-])(\d+:\d+)(?![\w:.-])/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export function recentFirst(frames: FrameRef[], recent: string[]): FrameRef[] {
  const pos = (f: FrameRef) => { const i = recent.indexOf(f.id); return i < 0 ? recent.length : i; };
  return [...frames].sort((a, b) => pos(a) - pos(b));
}

export type SlashCommand = { name: string; description: string; recipe?: Recipe };

// Slash menu order: recipes, then installed skills, each keeping its match order.
export const recipesFirst = <T extends { item: { recipe?: unknown } }>(rows: T[]) => [...rows.filter((r) => r.item.recipe), ...rows.filter((r) => !r.item.recipe)];

// One short line for a skill description: the first sentence, no dashes used as punctuation.
export function shortLine(text: string, max = 72) {
  const first = text.trim().replace(/^\(\w+\)\s*/, '').replace(/\*\*|`/g, '').split(/(?<=[.!?])\s/)[0].replace(/\s+[\u2014\u2013-]\s+/g, ', ').replace(/[\u2014\u2013]/g, ', ');
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export const recipeSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function withRecipes(commands: { name: string; description: string }[], builtin: Recipe[], custom: Recipe[]): SlashCommand[] {
  const recipes: SlashCommand[] = [];
  const add = (r: Recipe, name: string, description = r.blurb || r.title) => {
    if (name && !recipes.some((x) => x.name === name)) recipes.push({ name, description, recipe: r });
  };
  builtin.forEach((r) => {
    add(r, r.id);
    const tone = /\btone:(\w+)/.exec(r.prompt)?.[1];
    if (tone) TONES.filter((t) => t !== tone).forEach((t) => add({ ...r, prompt: r.prompt.replace(/\btone:\w+/, `tone:${t}`) }, `${r.id} tone:${t}`, `${r.title} in a ${t} tone`));
  });
  custom.forEach((r) => add(r, recipeSlug(r.title)));
  return [...recipes, ...commands.filter((c) => !recipes.some((r) => r.name === c.name))];
}

export function figmaLinkIn(text: string): { url: string; key: string; name: string } | null {
  const m = /https?:\/\/(?:[\w-]+\.)?figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]{10,})(?:\/([^\s/?#]+))?[^\s]*/.exec(text);
  if (!m) return null;
  const name = m[2] ? decodeURIComponent(m[2]).replace(/[.,;:!?)\]]+$/, '').replace(/-/g, ' ') : 'this Figma file';
  return { url: m[0].replace(/[.,;:!?)\]]+$/, ''), key: m[1], name };
}

export function nodeLinksIn(text: string, key: string): { url: string; id: string }[] {
  const out = new Map<string, { url: string; id: string }>();
  for (const m of text.matchAll(/https?:\/\/(?:[\w-]+\.)?figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]{10,})[^\s]*?[?&]node-id=(\d+)[-:](\d+)[^\s]*/g)) {
    if (m[1] !== key) continue;
    const id = `${m[2]}:${m[3]}`;
    if (!out.has(id)) out.set(id, { url: m[0].replace(/[.,;:!?)\]]+$/, ''), id });
  }
  return [...out.values()];
}

export const dropLink = (text: string, url: string) => text.split(url).join('').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim();

/** Frame links of the open file leave the typed text: the chip shows the frame, the link goes with the message. */
export function splitFrameLinks(text: string, key: string): { links: string[]; rest: string } {
  const links = nodeLinksIn(text, key).map((l) => l.url);
  return { links, rest: links.reduce(dropLink, text) };
}

/** The message as sent: frame links first, then her note. */
export const withFrameLinks = (links: string[], text: string) => (links.length ? `${links.join(' ')} ${text}`.trim() : text);

/**
 * Text another pane puts in the message box. Never twice, and never loses what she typed: the same command already at
 * the top leaves the box as it is (a second Review click does not make "/review /review"), another command swaps only
 * the command word, and a command before plain text goes first.
 */
export function insertInto(text: string, add: string): string {
  const a = add.trim();
  if (!a || text.includes(a)) return text;
  if (a.startsWith('/')) {
    const lead = /^\s*(\/\S+)/.exec(text);
    const word = a.split(/\s+/)[0];
    if (lead && lead[1] === word) return text;
    if (lead) return `${word}${text.trimStart().slice(lead[1].length)}`;
    return text.trim() ? `${a} ${text.trimStart()}` : `${a} `;
  }
  const tail = `${add.trimEnd()} `;
  return text && !/\s$/.test(text) ? `${text} ${tail}` : `${text}${tail}`;
}

export function accept(text: string, start: number, caret: number, insert: string) {
  const next = `${text.slice(0, start)}${insert} ${text.slice(caret)}`;
  return { text: next, caret: start + insert.length + 1 };
}

export function buildHistory(events: ChatEvent[], stored: string[]) {
  const local = events.filter((e) => e.kind === 'user').map((e) => e.text.trim()).reverse();
  const out: string[] = [];
  for (const t of [...local, ...[...stored].reverse()]) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function ghostFor(text: string, history: string[]) {
  if (text.length < 3) return '';
  const hit = history.find((h) => h.length > text.length && h.startsWith(text));
  return hit ? hit.slice(text.length) : '';
}

export const remember = (text: string, stored: string[], max = MAX_STORED) => [...stored.filter((t) => t !== text), text].slice(-max);

export function filesEdited(events: ChatEvent[]) {
  const paths = new Set<string>();
  for (const e of events) {
    if (e.kind === 'tool_use' && EDIT_TOOLS.has(e.name) && typeof e.input.file_path === 'string') paths.add(e.input.file_path);
  }
  return paths.size;
}

export const contextPercent = (context: number | null) => (context === null ? null : Math.min(100, Math.round((context / COMPACT_AT) * 100)));

const STORED_KEY = 'designstudio.prompts';

const MAX_HEIGHT = 220;
const fileCache = new Map<string, string[]>();

function readStored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function runInTerminal(cmd: string) {
  const list: Array<{ id: string }> = await fetch(api('/api/terms')).then((r) => r.json());
  const term = list.at(-1) ?? (await fetch(api('/api/terms'), { method: 'POST' }).then((r) => r.json()));
  window.dispatchEvent(new CustomEvent('designstudio:terminal', { detail: term.id }));
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?term=${encodeURIComponent(term.id)}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'i', d: `${cmd}\r` }));
    ws.close();
  };
}

function hl(text: string, hits: number[], from = 0): ReactNode {
  return [...text].map((c, i) => (hits.includes(from + i) ? <b key={i}>{c}</b> : c));
}

type Img = { ref: string; url: string };

type Hist = { list: string[]; index: number; draft: string };

const drafts = new Map<string, string>();

export function Composer() {
  const cwd = useStore((s) => s.session.cwd);
  const chatId = useStore((s) => s.session.id);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const waitingOn = useStore((s) => s.pending[0]);
  const waiting = Boolean(waitingOn);
  const serverCommands = useStore((s) => s.session.commands);
  const customRecipes = useCustomRecipes();
  const flow = useStore((s) => s.session.flow);
  const context = useStore((s) => s.session.context);
  const events = useStore((s) => s.events);
  const figma = useStore((s) => s.session.figma);
  const hasFile = !!figma;
  const figmaKey = figma?.key;

  const commands = useMemo(() => withRecipes(serverCommands, RECIPES, customRecipes.map(toRecipe)), [serverCommands, customRecipes]);
  const [modeOpen, setModeOpen] = useState(false);
  const modePop = useRef<HTMLDivElement>(null);
  const modeBtn = useRef<HTMLButtonElement>(null);
  const modeWrap = useRef<HTMLDivElement>(null);
  const modePopStyle = usePopAbove(modeOpen, modeWrap);
  const memoryTip = useTip("How much of Claude's memory this chat fills. Near full, Claude sums up older messages to make room.", 'top');
  const [text, setText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [skipLink, setSkipLink] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [stored, setStored] = useState(readStored);
  const [hist, setHist] = useState<Hist | null>(null);
  const [imgs, setImgs] = useState<Img[]>([]);
  const imgsRef = useRef(imgs);
  imgsRef.current = imgs;
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const have = useRef(0);
  const dictate = useDictation(text, setText);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLUListElement>(null);
  const wantCaret = useRef<number | null>(null);

  const at = Math.min(caret, text.length);
  const trigger = useMemo(() => triggerAt(text, at), [text, at]);
  const shell = trigger?.kind === 'shell';
  useEffect(() => {
    // A pasted frame link of the open file becomes a chip; the raw URL leaves the box.
    if (!figmaKey || shell) return;
    const { links, rest } = splitFrameLinks(text, figmaKey);
    if (!links.length) return;
    setFrameUrls((l) => [...l, ...links.filter((u) => !l.includes(u))]);
    wantCaret.current = rest.length;
    setText(rest);
  }, [text, figmaKey, shell]);
  const popKey = trigger && trigger.kind !== 'shell' ? `${trigger.kind}:${trigger.start}:${trigger.query}` : '';
  const [frameUrls, setFrameUrls] = useState<string[]>([]);
  const full = withFrameLinks(frameUrls, text);
  useEffect(() => publishDraft(full), [full]);
  const nodeLinks = useMemo(() => (figmaKey ? nodeLinksIn(frameUrls.join(' '), figmaKey) : []), [frameUrls, figmaKey]);
  const outline = useOutline(trigger?.kind === 'frame' || nodeLinks.length ? figmaKey : undefined);
  const frames = useMemo(() => outline?.pages.flatMap((p) => p.frames) ?? [], [outline]);
  const frameMode = trigger?.kind === 'frame';
  const recent = useMemo(() => (frameMode ? recentFrameIds(events) : []), [frameMode, events]);
  const items = useMemo(() => {
    if (!trigger || trigger.kind === 'shell' || popKey === dismissed) return [];
    if (trigger.kind === 'command') return recipesFirst(rankCommands(commands, trigger.query, MAX_COMMANDS));
    if (trigger.kind === 'frame') return !figmaKey && !trigger.query ? [{ item: ATTACH_ROW, hits: [], score: 0 }] : rankFrames(trigger.query ? frames : recentFirst(frames, recent), trigger.query);
    return rankFiles(files, trigger.query);
  }, [trigger, popKey, dismissed, commands, files, frames, recent, figmaKey]);
  const open = items.length > 0;
  const thumb = useThumbs(trigger?.kind === 'frame' ? figmaKey : undefined, trigger?.kind === 'frame' ? items.map((r) => [(r.item as FrameRef).id, 0]) : []);
  const nodeThumb = useThumbs(nodeLinks.length ? figmaKey : undefined, nodeLinks.map((l) => [l.id, 0]));
  const history = useMemo(() => buildHistory(events, stored), [events, stored]);
  const ghost = !open && !shell && at === text.length ? ghostFor(text, history) : '';
  const found = useMemo(() => figmaLinkIn(text), [text]);
  const link = found && (!hasFile || found.key !== figmaKey) ? found : null;
  const carry = useRef<{ text: string; from: string; at: number } | null>(null);
  const edited = useMemo(() => filesEdited(events), [events]);
  const pct = contextPercent(context);
  const setMode = (mode: FlowMode) => send({ type: 'set_flow', patch: { mode } });

  useEffect(() => {
    // Filling or focusing the message box from elsewhere shows it: the Chat tab on a phone, the hidden chat column on
    // a desktop, the box scrolled into view, the caret at the end.
    const reveal = () => {
      const phone = window.matchMedia('(max-width: 900px)').matches;
      window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: phone ? 'tab:chat' : 'chat:show' } }));
      // Waits a moment so the new text and, on a phone, the Chat tab have rendered.
      setTimeout(() => {
        const el = ta.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
        el.closest('.cp')?.scrollIntoView({ block: 'nearest' });
      }, 60);
    };
    const onInsert = (e: Event) => {
      const add = (e as CustomEvent<string>).detail;
      setText((t) => {
        const next = insertInto(t, add);
        wantCaret.current = next.length;
        return next;
      });
      reveal();
    };
    window.addEventListener('designstudio:insert', onInsert);
    window.addEventListener('designstudio:compose', reveal);
    return () => { window.removeEventListener('designstudio:insert', onInsert); window.removeEventListener('designstudio:compose', reveal); };
  }, []);

  useEffect(() => {
    if (trigger?.kind !== 'file' || !cwd) return;
    const cached = fileCache.get(cwd);
    if (cached) { setFiles(cached); return; }
    fetch(api('/api/files')).then((r) => r.json()).then((f: string[]) => { fileCache.set(cwd, f); setFiles(f); }).catch(() => {});
  }, [trigger?.kind, cwd]);

  useEffect(() => setSel(0), [popKey]);

  useEffect(() => {
    if (!modeOpen) return;
    focusChecked(modePop.current);
    const down = (e: MouseEvent) => { if (!(e.target as Element).closest('.cp-mode')) setModeOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModeOpen(false); modeBtn.current?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [modeOpen]);

  useEffect(() => {
    pop.current?.querySelectorAll('[role=option]')[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, mirror.current?.offsetHeight ?? 0);
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.style.visibility = h > MAX_HEIGHT ? 'hidden' : '';
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      setCaret(wantCaret.current);
      wantCaret.current = null;
    }
  }, [text, ghost]);

  useLayoutEffect(() => {
    const el = pop.current;
    const anchor = card.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    if (r.top - 8 >= el.offsetHeight) { el.style.bottom = `${window.innerHeight - r.top + 4}px`; el.style.top = ''; }
    else { el.style.top = `${r.bottom + 4}px`; el.style.bottom = ''; }
  }, [items]);

  have.current = imgs.length + busy;

  const clearImgs = () => {
    imgsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setImgs([]);
  };
  useEffect(clearImgs, [chatId]);
  const textRef = useRef(full);
  textRef.current = full;
  useEffect(() => {
    const moved = carry.current && carry.current.from !== chatId && Date.now() - carry.current.at < 10_000 ? carry.current : null;
    if (moved) drafts.delete(moved.from);
    if (carry.current?.from !== chatId) carry.current = null;
    const saved = moved?.text ?? drafts.get(chatId) ?? '';
    if (saved !== textRef.current) { setFrameUrls([]); apply(saved); }
    setHist(null);
    return () => { drafts.set(chatId, textRef.current); };
  }, [chatId]);
  useEffect(() => () => imgsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const attach = async (list: File[]) => {
    const forChat = chatRef.current;
    for (const f of list) {
      const problem = imageProblem(f, have.current);
      if (problem) { notice(problem); continue; }
      have.current++;
      setBusy((n) => n + 1);
      try {
        const r = await fetch(api('/api/attach'), { method: 'POST', headers: { 'content-type': f.type }, body: f });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        if (chatRef.current === forChat) setImgs((l) => [...l, { ref: body.ref, url: URL.createObjectURL(f) }]);
      } catch (err) {
        notice((err as Error).message || 'Upload failed');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const dropImage = (ref: string) => {
    imgs.filter((i) => i.ref === ref).forEach((i) => URL.revokeObjectURL(i.url));
    setImgs((l) => l.filter((i) => i.ref !== ref));
  };

  const apply = (next: string, c = next.length) => {
    wantCaret.current = c;
    setText(next);
  };

  const choose = (i: number) => {
    if (!trigger || trigger.kind === 'shell' || !items[i]) return;
    const item = items[i].item;
    const recipe = trigger.kind === 'command' ? (item as SlashCommand).recipe : undefined;
    const done = (value: string) => {
      const r = accept(text, trigger.start, at, value);
      apply(r.text, r.caret);
    };
    if (recipe) { void recipeText(recipe).then(done); return; }
    if (item === ATTACH_ROW) { setDismissed(popKey); window.dispatchEvent(new Event('designstudio:attach')); return; }
    if (trigger.kind === 'frame') { const f = item as FrameRef; done(`${f.name} (${figmaNodeUrl(figmaKey!, f.id)})`); return; }
    done(trigger.kind === 'command' ? `/${(item as SlashCommand).name}` : `@${item as string}`);
  };

  const stepHistory = (dir: 1 | -1) => {
    const h = hist ?? { list: history, index: -1, draft: full };
    setFrameUrls([]);
    const index = Math.min(h.list.length - 1, h.index + dir);
    if (index < 0) { setHist(null); apply(h.draft); return; }
    setHist({ ...h, index });
    apply(h.list[index]);
  };

  const submit = () => {
    const t = full.trim();
    if (!t) return;
    if (shell) {
      const cmd = t.slice(1).trim();
      if (cmd) runInTerminal(cmd).catch(() => notice('Terminal unavailable'));
    } else {
      const images = imgs.length ? imgs.map((i) => i.ref) : undefined;
      // Typing while a plan or question waits answers it (go approves), instead of aborting it. An Approve or Answer
      // prompt from "Awaiting your decision" stays in the box until the card is answered.
      const { decided, hold, answer } = routeMessage(t, figmaKey, readInserted(), waitingOn);
      if (hold) return notice("Answer Claude's card first, then send this.");
      if (answer && !images) send(answer);
      else if (running) steer(t, images);
      else send({ type: 'prompt', text: t, images });
      void markSent(decided);
      clearImgs();
      const next = remember(t, stored);
      setStored(next);
      try { localStorage.setItem(STORED_KEY, JSON.stringify(next)); } catch {}
    }
    setHist(null);
    setFrameUrls([]);
    apply('');
  };

  const startLongRun = ({ until, cap, weeklyCap, rounds }: LongRunStart) => {
    const t = full.trim();
    if (!t || running) return;
    send({ type: 'long_run_start', text: t, until, cap, weeklyCap, rounds, images: imgs.length ? imgs.map((i) => i.ref) : undefined });
    void markSent(sentItems(t, figmaKey, readInserted()));
    clearImgs();
    const next = remember(t, stored);
    setStored(next);
    try { localStorage.setItem(STORED_KEY, JSON.stringify(next)); } catch {}
    setHist(null);
    setFrameUrls([]);
    apply('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const onEntry = hist !== null && full === hist.list[hist.index];
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(popKey); return; }
      const exact = trigger?.kind === 'command' && !(items[sel].item as SlashCommand).recipe && (items[sel].item as SlashCommand).name === trigger.query;
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); choose(sel); return; }
    }
    if (ghost && (e.key === 'Tab' || e.key === 'ArrowRight') && el.selectionStart === text.length) { e.preventDefault(); apply(text + ghost); return; }
    if (e.key === 'ArrowUp' && (full === '' || onEntry) && !text.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); stepHistory(1); return; }
    if (e.key === 'ArrowDown' && onEntry && !text.slice(el.selectionEnd).includes('\n')) { e.preventDefault(); stepHistory(-1); return; }
    // Option+M cycles the mode. Shift+Tab stays free to move focus back out of the message box.
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyM') { e.preventDefault(); setMode(nextMode(flow.mode)); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const hint = shell ? 'Runs in the terminal' : stopping ? 'Stopping…' : !full && !running ? hasFile ? '/ for commands, # for frames' : '/ for commands like /design, /review, /audit' : '';
  const placeholder = waiting ? waitingPlaceholder(waitingOn) : running ? 'Steer Claude: stops the current step and sends this' : MODE_INFO[flow.mode].placeholder;
  const level = pct === null ? '' : context! >= COMPACT_AT ? 'over' : context! >= COMPACT_AT * 0.75 ? 'near' : '';

  return (
    <div className="cp" data-mode={flow.mode}>
      <div
        ref={card}
        className={`cp-card${shell ? ' shell' : ''}${drag ? ' drop' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { setDrag(false); const list = imagesIn(e.dataTransfer.files); if (list.length) { e.preventDefault(); void attach(list); } }}
      >
        {link && link.url !== skipLink && (
          <div className="cp-attach">
            <Icon name="file-media" small />
            <span>{hasFile ? `Open ${link.name} in its own chat?` : `Attach ${link.name}?`}</span>
            <button className="primary" onClick={() => { if (hasFile) carry.current = { text: full, from: chatId, at: Date.now() }; send({ type: 'set_figma', url: link.url }); }}>{hasFile ? 'Open' : 'Attach'}</button>
            <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => setSkipLink(link.url)}><Icon name="close" small /></button>
          </div>
        )}
        {!shell && <LongRunHint text={text} onStart={startLongRun} />}
        {nodeLinks.length > 0 && !shell && (
          <div className="cp-nodes" aria-label="Frames in this message">
            {nodeLinks.map((l) => {
              const name = frames.find((f) => f.id === l.id)?.name ?? `Frame ${l.id}`;
              const src = nodeThumb(l.id);
              return (
                <span key={l.id} className="cp-node" title={l.url}>
                  {src ? <img src={src} alt="" /> : <span className="cp-node-ph"><Icon name="file-media" small /></span>}
                  <span className="cp-node-name">{name}</span>
                  <button className="icon-btn" title="Remove this frame link" aria-label={`Remove ${name}`} onClick={() => setFrameUrls((u) => u.filter((x) => x !== l.url))}><Icon name="close" small /></button>
                </span>
              );
            })}
          </div>
        )}
        {(imgs.length > 0 || busy > 0) && !shell && (
          <div className="cp-imgs">
            {imgs.map((i) => (
              <span key={i.ref} className="cp-img">
                <img src={i.url} alt="" />
                <button title="Remove image" aria-label="Remove image" onClick={() => dropImage(i.ref)}><Icon name="close" small /></button>
              </span>
            ))}
            {busy > 0 && <span className="cp-img busy"><Icon name="loading" small spin /></span>}
          </div>
        )}
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span></div>
          <textarea
            ref={ta}
            aria-label="Message to Claude"
            value={text}
            rows={1}
            placeholder={placeholder}
            spellCheck={!shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => { const list = imagesIn(e.clipboardData.files); if (list.length) { e.preventDefault(); void attach(list); } }}
          />
        </div>
        <div className="cp-foot">
          <div className="cp-mode" ref={modeWrap}>
            <button ref={modeBtn} className="cp-pill cp-modebtn" aria-haspopup="true" aria-expanded={modeOpen} title="Mode (⌥M to switch)" onClick={() => setModeOpen((o) => !o)}>
              <Icon name={MODE_INFO[flow.mode].icon} small /><span>{MODE_INFO[flow.mode].label}</span><Icon name="chevron-down" small />
            </button>
            {modeOpen && (
              <div ref={modePop} className="cp-modepop" style={modePopStyle} role="menu" aria-label="Mode" onKeyDown={menuKeys}>
                {FLOW_MODES.map((m) => (
                  <button key={m} role="menuitemradio" aria-checked={flow.mode === m} className={flow.mode === m ? 'active' : ''} onClick={() => { setMode(m); if (m !== 'design') setModeOpen(false); }}>
                    <Icon name={MODE_INFO[m].icon} small />
                    <span className="cp-modetext"><b>{MODE_INFO[m].label}</b><span>{MODE_INFO[m].detail}</span></span>
                  </button>
                ))}
                {flow.mode === 'design' && (
                  <RunOptions stopAfterSketch={flow.stopAfterSketch} onDepth={() => setModeOpen(false)} />
                )}
              </div>
            )}
          </div>
          {!shell && flow.mode === 'chat' && <ModelPicker />}
          {!shell && <LongRunButton text={full} onStart={startLongRun} />}
          <span className="cp-spacer" />
          <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { void attach(imagesIn(e.target.files)); e.target.value = ''; }} />
          <button className="icon-btn" title="Attach images" aria-label="Attach images" onClick={() => picker.current?.click()}><Icon name="paperclip" small /></button>
          <Voice onText={dictate} onError={setVoiceError} />
          {running && (
            <button className="cp-stop" title={stopping ? 'Stopping…' : 'Stop Claude'} aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => send({ type: 'interrupt' })}>
              <Icon name={stopping ? 'loading' : 'debug-stop'} small spin={stopping} />
            </button>
          )}
          <button
            className={`cp-send${running ? ' steer' : ''}`}
            title={shell ? 'Run in the terminal (Enter)' : running ? 'Stop the current step and send (Enter)' : 'Send (Enter)'}
            aria-label={shell ? 'Run' : running ? 'Stop and send' : 'Send'}
            disabled={!full.trim()}
            onClick={submit}
          >
            <Icon name={shell ? 'terminal' : 'arrow-up'} small />
          </button>
        </div>
      </div>
      <div className="cp-under">
        {voiceError
          ? <span className="cp-hint cp-error" role="alert"><Icon name="warning" small />{voiceError}</span>
          : hint && <span className="cp-hint">{hint}</span>}
        <span className="cp-stats">
          {pct !== null && <span {...memoryTip.props} tabIndex={0} className={level} aria-describedby={memoryTip.open ? memoryTip.id : undefined}>Memory used: {pct}%</span>}
          {memoryTip.tip}
          {edited > 0 && <span>{edited} {edited === 1 ? 'file' : 'files'} edited</span>}
        </span>
      </div>
      {open && (
        <ul ref={pop} id="cp-pop" tabIndex={0} className="cp-pop" role="listbox" aria-label={frameMode ? "Frames" : trigger?.kind === "file" ? "Files" : "Commands"}>
          {items.map((r, i) => {
            if (trigger?.kind === 'command') {
              const c = r.item as SlashCommand;
              const group = c.recipe ? 'Recipes' : 'Skills';
              const head = i === 0 || Boolean((items[i - 1].item as SlashCommand).recipe) !== Boolean(c.recipe);
              const detail = c.recipe ? (c.name === c.recipe.id ? c.recipe.title : c.description) : shortLine(c.description);
              return (
                <Fragment key={c.name}>
                  {head && <li className="cp-group" role="presentation">{group}</li>}
                  <li id={`cp-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} title={c.recipe?.blurb || c.description} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                    <span className="cp-name">/{hl(c.name, r.hits)}</span>
                    <span className="cp-detail">{detail}</span>
                  </li>
                </Fragment>
              );
            }
            if (trigger?.kind === 'frame') {
              const f = r.item as FrameRef;
              return (
                <li key={f.id} id={`cp-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                  {f === ATTACH_ROW ? <Icon name="file-media" small /> : <span className="cp-thumb">{thumb(f.id) && <img src={thumb(f.id)!} alt="" />}</span>}
                  <span className="cp-name">{hl(f.name, r.hits)}</span>
                  <span className="cp-detail">{f.page}</span>
                </li>
              );
            }
            const f = r.item as string;
            const base = f.lastIndexOf('/') + 1;
            return (
              <li key={f} id={`cp-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} title={f} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                <FileIcon name={f} />
                <span className="cp-name">{hl(f.slice(base), r.hits, base)}</span>
                <span className="cp-detail">{hl(f.slice(0, Math.max(base - 1, 0)), r.hits)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * This chat's Design options, in the same switch and segmented control as Settings.
 * Each shows the default new chats start with, which lives in Settings.
 */
// Review depth is chosen on the Review tab; the menu shows it and links there, so the chat has one depth control.
function RunOptions({ stopAfterSketch, onDepth }: { stopAfterSketch: boolean; onDepth: () => void }) {
  const [def, setDef] = useState<Pick<Settings, 'stopAfterSketch'> | null>(null);
  useEffect(() => {
    fetch(api('/api/settings')).then((r) => r.json()).then(setDef, () => {});
  }, []);
  const set = (patch: { stopAfterSketch?: boolean }) => send({ type: 'set_flow', patch });
  return (
    <div className="cp-modeopts">
      <div className="cp-opt" onClick={(e) => !(e.target as Element).closest('.switch') && set({ stopAfterSketch: !stopAfterSketch })}>
        <span className="cp-opt-text"><span id="cp-stop-l">Stop after sketch</span>{def && <span className="cp-opt-def">Default: {def.stopAfterSketch ? 'On' : 'Off'}</span>}</span>
        <button type="button" className="switch" role="switch" aria-checked={stopAfterSketch} aria-labelledby="cp-stop-l" onClick={() => set({ stopAfterSketch: !stopAfterSketch })}><span className="switch-thumb" /></button>
      </div>
      <div className="cp-opt" onClick={(e) => { if ((e.target as Element).closest('.link')) onDepth(); }}>
        <DepthLink />
      </div>
    </div>
  );
}
