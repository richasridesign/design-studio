import { useCallback, useEffect, useState } from 'react';
import { getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, ReviewArt } from './Empty';
import { attachFigma, insertPrompt, showNode } from './Files';
import { figmaNodeUrl } from '../../../shared/design';

type User = { handle: string; img_url: string };
type Thread = { id: string; message: string; user: User; created_at: string; resolved_at: string | null; nodeId: string | null; replies: unknown[] };

const command = (id: string) => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id } }));

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  for (const [n, unit] of [[86400 * 7, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']] as const) if (s >= n) return `${Math.floor(s / n)}${unit} ago`;
  return 'just now';
}

function Avatar({ user }: { user: User }) {
  return user.img_url ? <img className="cm-avatar" src={user.img_url} alt="" /> : <span className="cm-avatar">{user.handle.slice(0, 2).toUpperCase()}</span>;
}

function Item({ t, fileKey, reload }: { t: Thread; fileKey: string | undefined; reload: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const node = t.nodeId && fileKey ? ` on node ${t.nodeId} (${figmaNodeUrl(fileKey, t.nodeId)})` : t.nodeId ? ` on node ${t.nodeId}` : '';

  const ask = () => insertPrompt(`Address this Figma comment from @${t.user.handle}${node}: "${t.message}". Make the change in Figma if it asks for one, then reply on the comment with what you changed.`);
  const sendReply = async () => {
    setBusy(true);
    setError('');
    try {
      await postJson('/api/figma/comments/reply', { commentId: t.id, message: text });
      setText('');
      setReplying(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`cm-item ${t.resolved_at ? 'resolved' : ''}`}>
      <div className="cm-head">
        <Avatar user={t.user} />
        <span className="cm-handle">@{t.user.handle}</span>
        <span className="cm-time">{ago(t.created_at)}</span>
        {t.resolved_at && <span className="cm-time">resolved</span>}
      </div>
      <button className={`cm-message ${expanded ? 'open' : ''}`} onClick={() => setExpanded((v) => !v)}>{t.message}</button>
      <div className="cm-meta">
        {t.replies.length > 0 && <span className="cm-time">{t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}</span>}
        {t.nodeId && <button className="cm-chip" onClick={() => showNode(t.nodeId!)}>Show in Figma</button>}
      </div>
      <div className="cm-actions">
        <button className="ghost" onClick={ask}><Icon name="sparkle" small /> Ask Claude</button>
        <button className="ghost" onClick={() => setReplying((v) => !v)}><Icon name="reply" small /> Reply</button>
      </div>
      {replying && (
        <div className="cm-reply">
          <textarea value={text} rows={3} autoFocus placeholder={`Reply to @${t.user.handle}`} onChange={(e) => setText(e.target.value)} />
          <button className="primary" disabled={busy || !text.trim()} onClick={sendReply}>{busy ? 'Sending' : 'Send'}</button>
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </li>
  );
}

export function Comments() {
  const figma = useStore((s) => s.session.figma);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!figma) return;
    setLoading(true);
    setError('');
    getJson<Thread[]>('/api/figma/comments')
      .then(setThreads)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [figma?.key]);

  useEffect(() => {
    setThreads(null);
    load();
  }, [load]);

  if (!figma) return <Empty art={<ReviewArt />} title="Attach a Figma file" text="Attach a file to see its comments." action={{ label: 'Attach a Figma file', onClick: attachFigma }} />;
  if (/access token/i.test(error)) return <Empty art={<ReviewArt />} title="Add a Figma token" text="Comments are read with your Figma personal access token." action={{ label: 'Open Settings', onClick: () => command('page:settings') }} />;

  const open = (threads ?? []).filter((t) => !t.resolved_at);
  const shown = filter === 'open' ? open : threads ?? [];

  const askAll = () =>
    insertPrompt(
      `Address these ${open.length} open Figma comments. Fix each one in Figma, then reply on each comment via the Figma REST reply (POST /v1/files/${figma.key}/comments with comment_id set to the comment id) saying what you changed.\n\n` +
        open.map((t) => `- comment ${t.id} from @${t.user.handle}${t.nodeId ? ` on node ${t.nodeId} (${figmaNodeUrl(figma.key, t.nodeId)})` : ''}: "${t.message}"`).join('\n'),
    );

  return (
    <div className="cm">
      <div className="cm-bar">
        <strong>{open.length} open</strong>
        <div className="cm-filter">
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Open</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        <button className="icon-btn" title="Refresh" disabled={loading} onClick={load}><Icon name="refresh" spin={loading} /></button>
      </div>
      {error && <div className="error-text cm-note">{error}</div>}
      {threads && !shown.length && !error && <Empty art={<ReviewArt />} title="No open comments" text="Comments from your team on this Figma file show up here. Claude can address them for you." />}
      <ul className="cm-list">
        {shown.map((t) => <Item key={t.id} t={t} fileKey={figma.key} reload={load} />)}
      </ul>
      {open.length > 0 && <div className="cm-foot"><button className="primary" onClick={askAll}>Ask Claude to address all open comments</button></div>}
    </div>
  );
}
