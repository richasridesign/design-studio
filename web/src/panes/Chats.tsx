import { useEffect, useMemo, useState } from 'react';
import { getJson, postJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { type ChatEvent, type LiveChat, type SavedSession } from '../../../shared/protocol';
import { replyLine } from '../../../shared/edits';
import '../chats.css';

type Folder = { cwd: string; key: string; name: string; url: string };
type Group = { cwd: string; name: string; open: LiveChat[]; recent: SavedSession[] };

const RECENT = 5;
const urgency = (c: LiveChat) => (c.pending ? 0 : c.running ? 1 : 2);
const byUrgency = (a: LiveChat, b: LiveChat) => urgency(a) - urgency(b) || b.lastActive - a.lastActive;

export function groupChats(live: LiveChat[], saved: SavedSession[], folders: Folder[]): Group[] {
  const groups = new Map<string, Group>();
  const noFile = (cwd: string) => !folders.some((f) => f.cwd === cwd) && /\/(scratch|chat-\d{8}-\d{6}[\w-]*)$/.test(cwd);
  const name = (cwd: string) => folders.find((f) => f.cwd === cwd)?.name ?? cwd.split('/').pop() ?? cwd;
  const get = (cwd: string) => {
    const key = noFile(cwd) ? '' : cwd;
    return groups.get(key) ?? groups.set(key, { cwd: key, name: key ? name(cwd) : 'No file yet', open: [], recent: [] }).get(key)!;
  };
  for (const c of live) get(c.cwd).open.push(c);
  const openIds = new Set(live.map((c) => c.sessionId));
  const roots = new Set([...folders.map((f) => f.cwd), ...live.map((c) => c.cwd)]);
  for (const s of saved) if (roots.has(s.cwd) && !openIds.has(s.sessionId)) get(s.cwd).recent.push(s);
  for (const g of groups.values()) {
    g.open.sort(byUrgency);
    g.recent.sort((a, b) => b.lastModified - a.lastModified);
  }
  const last = (g: Group) => Math.max(0, ...g.open.map((c) => c.lastActive), ...g.recent.map((s) => s.lastModified));
  return [...groups.values()].sort((a, b) => last(b) - last(a));
}

export function filterGroups(groups: Group[], query: string): Group[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const hit = (t: string) => t.toLowerCase().includes(q);
  return groups
    .map((g) => (hit(g.name) ? g : { ...g, open: g.open.filter((c) => hit(c.title)), recent: g.recent.filter((r) => hit(r.title)) }))
    .filter((g) => g.open.length || g.recent.length);
}

export function Chats() {
  const viewing = useStore((s) => s.session.id);
  const current = useStore((s) => s.session.sessionId);
  const live = useStore((s) => s.live);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [saved, setSaved] = useState<SavedSession[]>([]);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    getJson<Folder[]>('/api/figma/folders').then(setFolders).catch(() => {});
    getJson<SavedSession[]>('/api/sessions').then(setSaved).catch(() => {});
    setOpening(null);
  }, [current, live.length]);

  const all = useMemo(() => groupChats(live, saved, folders), [live, saved, folders]);
  const groups = useMemo(() => filterGroups(all, query), [all, query]);
  const close = (c: LiveChat) =>
    c.running || c.pending
      ? setAsk({ title: 'Close this chat?', detail: c.title, warning: 'Claude is still working on it and will stop. The transcript is kept.', action: 'Close', run: async () => send({ type: 'close', id: c.id }) })
      : send({ type: 'close', id: c.id });

  const openSample = async () => {
    setSampleBusy(true);
    setSampleError('');
    try {
      const { id } = await postJson<{ id: string }>('/api/sample', {});
      send({ type: 'view', id });
      setTimeout(() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:sketch' } })), 400);
    } catch (err) {
      setSampleError((err as Error).message);
    }
    setSampleBusy(false);
  };

  return (
    <div className="sessions chats">
      <div className="sessions-bar">
        <button className="new-chat" onClick={() => send({ type: 'new_chat' })}><Icon name="add" small /> New chat</button>
      </div>
      <div className="sessions-bar">
        <input type="search" placeholder="Search chats" aria-label="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); } }} />
      </div>
      <div className="tree">
        <div className={`row session sample ${sampleBusy ? 'busy' : ''}`} title="Open the sample chat" onClick={() => sampleBusy || void openSample()} {...press(() => sampleBusy || void openSample())}>
          <span className="twistie"><Icon name="play" small /></span>
          <span className="name">Sample tour</span>
        </div>
        {sampleError && <div className="hint error-text">{sampleError}</div>}
        {groups.map((g) => (
          <div key={g.cwd || 'no-file'}>
            <div className="row project" title={g.cwd || undefined}>
              <span className="twistie"><Icon name="file-media" small /></span>
              <span className="name">{g.name}</span>
              <span className="acts">
                <button className="icon-btn" title={`New chat on ${g.name}`} onClick={() => send(g.cwd ? { type: 'new_session', cwd: g.cwd } : { type: 'new_chat' })}><Icon name="add" small /></button>
              </span>
            </div>
            {g.open.map((c) => <LiveRow key={c.id} c={c} selected={c.id === viewing} onClose={() => close(c)} />)}
            {(query ? g.recent : g.recent.slice(0, RECENT)).map((s) => (
              <div key={s.sessionId} className="row session recent" title={s.title} onClick={() => { setOpening(s.sessionId); send({ type: 'open_session', sessionId: s.sessionId }); }} {...press(() => { setOpening(s.sessionId); send({ type: 'open_session', sessionId: s.sessionId }); })}>
                <span className="name">{opening === s.sessionId ? 'Opening… ' : ''}{s.title}</span>
                <span className="when">{ago(s.lastModified)}</span>
              </div>
            ))}
          </div>
        ))}
        {!groups.length && <div className="hint">{query ? 'No chats match.' : 'No chats yet.'}</div>}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// Keyboard access for a clickable row part: Enter or Space acts like a click.
const press = (fn: () => void) => ({
  role: 'button',
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn();
  },
});

function line(c: LiveChat, events: ChatEvent[] | null) {
  return c.pending ? 'Needs you' : c.running ? c.status : c.last ?? (events ? replyLine(events) : '') ?? '';
}

function LiveRow({ c, selected, onClose }: { c: LiveChat; selected: boolean; onClose: () => void }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const text = line(c, events);
  return (
    <div className={`row session live ${text ? 'two' : ''} ${selected ? 'selected' : ''}`} title={c.title} onClick={() => selected || send({ type: 'view', id: c.id })}>
      <span className={`dot ${c.pending ? 'waiting' : c.running ? 'running' : 'idle'}`} />
      <span className="lines" aria-current={selected || undefined} {...press(() => selected || send({ type: 'view', id: c.id }))}>
        <span className="l1">
          <span className="name">{c.title}</span>
          <span className="when">{c.pending ? 'needs you' : c.running ? '' : ago(c.lastActive)}</span>
        </span>
        {text && <span className="l2"><span className="sub">{text}</span></span>}
      </span>
      <span className="acts">
        <button className="icon-btn" title="Close chat, keep the transcript" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="close" small /></button>
      </span>
    </div>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
