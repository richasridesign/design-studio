import { useSyncExternalStore } from 'react';
import type { ClientMessage, LiveChat, ServerMessage, ServerState } from '../../shared/protocol';
import { flowOff } from '../../shared/design';
import { notify } from './notify';
import { REASON_TEXT, isActive } from '../../shared/longRun';

/**
 * A project, flow or iteration row picked in the sidebar. The Figma and Review tabs then show it instead of the viewed
 * chat. Viewing a chat clears it. A project selection carries its working iteration, which Review and Flow check use.
 */
export type Selection = {
  kind: 'project' | 'flow' | 'iteration';
  cwd: string;
  name: string;
  key: string;
  url: string;
  flow?: { slug: string; n: number; name: string };
  iteration?: { id: string; label: string; state: 'working' | 'frozen'; node?: string };
};

type UiState = {
  connected: boolean;
  openFile: string | null;
  follow: boolean;
  switcherOpen: boolean;
  revs: Record<string, number>;
  focus: string | null;
  selection: Selection | null;
};

export type State = ServerState & { live: LiveChat[]; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, cwd: '', figma: null, running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], flow: flowOff(), spend: { tokens: 0, costUsd: 0, byPhase: {}, byModel: {} } },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  ui: { connected: false, openFile: null, follow: false, switcherOpen: false, revs: {}, focus: null, selection: null },
};

const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

listeners.add(() => {
  const n = state.live.reduce((sum, c) => sum + (c.id === state.session.id ? state.pending.length : c.pending), 0);
  const title = n > 0 ? `(${n}) Design Studio` : 'Design Studio';
  if (document.title !== title) document.title = title;
});

export function notice(text: string) {
  set((s) => ({ events: [...s.events, { id: crypto.randomUUID(), kind: 'system', text, at: Date.now() }] }));
}

export function setUi(patch: Partial<UiState>) {
  set((s) => ({ ui: { ...s.ui, ...patch } }));
}

export const getState = () => state;

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state),
    () => selector(state),
  );
}

export const api = (path: string) => `${path}${path.includes('?') ? '&' : '?'}chat=${encodeURIComponent(state.session.id)}`;

const repo = (c: LiveChat) => c.cwd.split('/').pop();
const focus = (id: string) => () => send({ type: 'view', id });

function notifyBackground(chats: LiveChat[]) {
  for (const c of chats) {
    const was = state.live.find((x) => x.id === c.id);
    if (!was || c.id === state.session.id) continue;
    if (c.pending > was.pending) notify(`Claude needs you in ${repo(c)}`, c.title, focus(c.id));
    else if (was.running && !c.running) notify(`Claude finished in ${repo(c)}`, c.title, focus(c.id));
  }
}

let ws: WebSocket | null = null;
export function send(m: ClientMessage) {
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
}

export function steer(text: string, images?: string[]) {
  if (ws?.readyState !== WebSocket.OPEN) return notice('Not connected, message not sent');
  const id = crypto.randomUUID();
  set((s) => ({ events: [...s.events, { id, kind: 'user', text, at: Date.now(), stopping: true }] }));
  send({ type: 'steer', text, id, images });
}

function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      set((s) => {
        const same = s.session.id === m.state.session.id;
        const old = new Map(s.events.map((e) => [e.id, e]));
        const events = m.state.events.map((e) => {
          const o = same ? old.get(e.id) : undefined;
          return o && JSON.stringify(o) === JSON.stringify(e) ? o : e;
        });
        const keep = same && events.length === s.events.length && events.every((e, i) => e === s.events[i]);
        // Viewing another chat drops a sidebar selection, so the tabs follow the chat again.
        const ui = same ? s.ui : { ...s.ui, selection: null };
        return { ...m.state, events: keep ? s.events : events, ui: s.session.cwd && s.session.cwd !== m.state.session.cwd ? { ...ui, openFile: null } : ui };
      });
      break;
    case 'error':
      notice(m.text);
      break;
    case 'event':
      if (m.event.kind === 'result' && !state.events.some((e) => e.id === m.event.id) && !isActive(state.session.longRun)) {
        notify('Claude finished', m.event.text.trim().split('\n')[0], focus(state.session.id));
      }
      set((s) => {
        const i = s.events.findIndex((e) => e.id === m.event.id);
        const events = i >= 0 ? s.events.map((e, j) => (j === i ? m.event : e)) : [...s.events, m.event];
        return { events };
      });
      break;
    case 'status':
      set({ status: m.text });
      break;
    case 'pending':
      if (!state.pending.some((p) => p.id === m.request.id)) {
        notify('Claude needs you', m.request.kind === 'question' ? m.request.questions[0]?.question ?? '' : m.request.title, focus(state.session.id));
        if (document.visibilityState !== 'visible') navigator.vibrate?.(200);
      }
      set((s) => ({ pending: [...s.pending.filter((p) => p.id !== m.request.id), m.request] }));
      break;
    case 'resolved':
      set((s) => ({ pending: s.pending.filter((p) => p.id !== m.id) }));
      break;
    case 'file_changed':
      set((s) => ({
        recentFiles: [m.path, ...s.recentFiles.filter((f) => f !== m.path)].slice(0, 30),
        ui: { ...s.ui, revs: { ...s.ui.revs, [m.path]: (s.ui.revs[m.path] ?? 0) + 1 } },
      }));
      break;
    case 'focus':
      setUi({ focus: m.nodeId });
      break;
    case 'session':
      if (isActive(state.session.longRun) && m.session.longRun && !isActive(m.session.longRun)) {
        const r = m.session.longRun;
        notify(r.state === 'done' ? 'Long run finished' : 'Long run stopped', r.state === 'done' ? 'The report is in the chat' : REASON_TEXT[r.reason ?? 'user'], focus(state.session.id));
      }
      set({ session: m.session });
      break;
    case 'live':
      notifyBackground(m.chats);
      set({ live: m.chats });
      break;
  }
}

let retry: ReturnType<typeof setTimeout> | undefined;

export function connect() {
  clearTimeout(retry);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => setUi({ connected: true });
  ws.onclose = () => {
    setUi({ connected: false });
    retry = setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ws?.readyState !== WebSocket.OPEN && ws?.readyState !== WebSocket.CONNECTING) connect();
});

export const useRev = (file: string) => useStore((s) => s.ui.revs[file] ?? 0);

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(api(path), init);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error ?? `Request failed: ${r.status}`);
  return body as T;
}

export const postJson = <T>(path: string, body: unknown) => getJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
