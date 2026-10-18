import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MCP_BAD, type McpServer } from '../../../shared/protocol';
import { api, send, useStore } from '../store';
import { Icon } from '../Icon';
import '../mcp.css';

const STATUS: Record<string, [tone: string, label: string]> = {
  connected: ['ok', 'Connected'],
  failed: ['bad', 'Failed'],
  'needs-auth': ['warn', 'Needs login'],
  pending: ['wait', 'Connecting'],
  disabled: ['off', 'Disabled'],
  probing: ['wait', 'Checking'],
};
const statusOf = (s: string) => STATUS[s] ?? ['off', s];
export const needsYou = (r: { status: string; live?: boolean }) => r.status === 'failed' || (r.status === 'needs-auth' && !!r.live);
const stateOf = (r: { status: string; live?: boolean }): [tone: string, label: string] => (r.status === 'needs-auth' && !r.live ? ['off', 'OAuth via Claude'] : statusOf(r.status));

const SCOPES: [id: string, title: string, where: string][] = [
  ['user', 'Your servers', '~/.claude.json'],
  ['project', 'This repo', '.mcp.json'],
  ['local', 'This folder', '~/.claude.json · project entry'],
  ['claudeai', 'Claude.ai connectors', 'claude.ai settings'],
  ['plugin', 'Plugins', 'Claude Code plugins'],
];
const scopeInfo = (id: string) => SCOPES.find((s) => s[0] === id) ?? [id, id[0].toUpperCase() + id.slice(1), ''];

export const openMcp = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:mcp' } }));

export function McpItem() {
  const mcp = useStore((s) => s.session.mcp);
  const ok = mcp.filter((m) => m.status === 'connected').length;
  const tone = mcp.some((m) => m.status === 'failed') ? 'bad' : mcp.some((m) => MCP_BAD.includes(m.status)) ? 'warn' : ok ? 'ok' : 'off';
  return (
    <span className="item clickable" title="MCP servers" onClick={openMcp}>
      <span className={`mcp-dot ${tone}`} /> <span className="label">MCP {mcp.length ? `${ok}/${mcp.length}` : ''}</span>
    </span>
  );
}

export type Row = McpServer & { live?: boolean };

export function merge(probed: McpServer[], live: McpServer[]): Row[] {
  const rows: Row[] = probed.map((p) => ({ ...p }));
  for (const m of live) {
    const i = rows.findIndex((r) => r.name === m.name);
    const tools = m.tools?.some((t) => t.description) ? m.tools : rows[i]?.tools ?? m.tools;
    if (i >= 0) rows[i] = { ...rows[i], ...m, tools, scope: rows[i].scope ?? m.scope, live: true };
    else rows.push({ ...m, live: true });
  }
  return rows;
}

export function sections(rows: Row[]): [string, Row[]][] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.scope ?? 'other', [...(by.get(r.scope ?? 'other') ?? []), r]);
  const order = (k: string) => SCOPES.findIndex((s) => s[0] === k) + 1 || 99;
  return [...by.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

const short = (v: string) => v.split('+')[0];

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

export function McpPage() {
  const mcp = useStore((s) => s.session.mcp);
  const id = useStore((s) => s.session.id);
  const [probed, setProbed] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = (refresh = false) => {
    setBusy(true);
    setError('');
    send({ type: 'mcp_status' });
    fetch(api(`/api/mcp/probe${refresh ? '?refresh=1' : ''}`))
      .then((r) => r.json())
      .then((p) => { if (Array.isArray(p)) { setProbed(p); setAt(Date.now()); } else setError(p?.error ?? 'Probe failed'); }, (e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(), [id]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => merge(probed ?? [], mcp), [probed, mcp]);
  const current = rows.find((r) => r.name === sel) ?? null;
  const ok = rows.filter((r) => r.status === 'connected').length;
  const tools = rows.reduce((n, r) => n + (r.tools?.length ?? 0), 0);
  const attention = rows.filter(needsYou).length;
  const extra = document.getElementById('page-mcp-extra');

  return (
    <div className={`mcp-page ${current ? 'with-detail' : ''}`}>
      <div className="mcp-main">
        {extra && createPortal(
          <div className="mcp-stats">
            <Stat n={ok} of={rows.length} label="connected" tone={attention ? 'warn' : 'ok'} />
            <Stat n={tools} label="tools" />
            {attention > 0 && <Stat n={attention} label="need you" tone="bad" />}
            <button className={`mcp-refresh ${busy ? 'busy' : ''}`} onClick={() => load(true)} disabled={busy} title="Connect to every server again">
              <Icon name={busy ? 'loading' : 'refresh'} small spin={busy} /> {busy ? 'Checking' : at ? `Checked ${ago(at)}` : 'Check'}
            </button>
          </div>,
          extra,
        )}
        {error && <div className="mcp-error"><Icon name="error" small /> {error}</div>}
        {probed === null && !error && (
          <div className="mcp-grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="mcp-card skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        )}
        {probed !== null && rows.length === 0 && (
          <div className="mcp-empty">
            <Icon name="plug" />
            <div className="empty-title">No MCP servers yet</div>
            <div className="muted">Add one with <code>claude mcp add</code> or connect one on claude.ai, then check again.</div>
          </div>
        )}
        {sections(rows).map(([scope, list]) => {
          const [, title, where] = scopeInfo(scope);
          return (
            <section key={scope} className="mcp-section">
              <div className="mcp-section-head"><span>{title}</span><span className="mono muted">{where}</span><span className="muted count">{list.filter((r) => r.status === 'connected').length}/{list.length}</span></div>
              <div className="mcp-grid">
                {list.map((r) => <Card key={r.name} row={r} selected={r.name === sel} onClick={() => setSel((s) => (s === r.name ? null : r.name))} />)}
              </div>
            </section>
          );
        })}
      </div>
      {current && <Detail row={current} onClose={() => setSel(null)} />}
    </div>
  );
}

function Stat({ n, of, label, tone }: { n: number; of?: number; label: string; tone?: string }) {
  return (
    <div className={`mcp-stat ${tone ?? ''}`}>
      <div className="n">{n}{of !== undefined && <span className="of">/{of}</span>}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function Card({ row, selected, onClick }: { row: Row; selected: boolean; onClick: () => void }) {
  const [tone, label] = stateOf(row);
  const url = row.command?.startsWith('http');
  return (
    <button className={`mcp-card ${tone} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="mcp-card-top">
        <span className={`mcp-orb ${tone}`} />
        <span className="mcp-card-name">{row.name}</span>
        {row.type && <span className="mcp-tag">{row.type}</span>}
        {row.live && <span className="mcp-tag live" title="Loaded in this chat">chat</span>}
      </div>
      <div className="mcp-card-cmd mono" title={row.command}>{url ? row.command?.replace(/^https?:\/\//, '') : row.command ?? '-'}</div>
      <div className="mcp-card-foot">
        <span className={`s ${tone}`}>{label}</span>
        {row.status === 'connected' && row.tools && <span>{row.tools.length} tools</span>}
        {row.version && <span className="mono muted" title={row.version}>v{short(row.version)}</span>}
      </div>
    </button>
  );
}

function Detail({ row, onClose }: { row: Row; onClose: () => void }) {
  const [tone, label] = stateOf(row);
  const [, scope, where] = scopeInfo(row.scope ?? 'other');
  const [q, setQ] = useState('');
  useEffect(() => setQ(''), [row.name]);
  const url = row.command?.startsWith('http');
  const tools = (row.tools ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.description?.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="mcp-detail">
      <div className="mcp-detail-head">
        <span className={`mcp-orb ${tone}`} />
        <h2>{row.name}</h2>
        <span className="spacer" />
        <button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" small /></button>
      </div>
      <div className="mcp-detail-acts">
        {row.live && MCP_BAD.includes(row.status) && <button onClick={() => send({ type: 'mcp_reconnect', name: row.name })}><Icon name="debug-restart" small /> Reconnect in chat</button>}
        {row.live && row.status === 'disabled' && <button onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: true })}><Icon name="debug-start" small /> Enable</button>}
        {row.live && row.status !== 'disabled' && <button onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: false })}><Icon name="circle-slash" small /> Disable for this chat</button>}
        {url && <a href={row.command} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open URL</a>}
      </div>
      <dl className="mcp-kv">
        <dt>Status</dt><dd className={tone}>{label}{row.version ? <span className="muted mono"> · v{row.version}</span> : null}</dd>
        {row.error && (row.live || row.status !== 'needs-auth') && <><dt>Error</dt><dd className="bad mono wrap">{row.error}</dd></>}
        {row.status === 'needs-auth' && row.live && (
          <><dt>Log in</dt><dd>Run <code>claude</code> in a terminal here, then <code>/mcp</code> and pick {row.name}. <button className="link" onClick={() => window.dispatchEvent(new Event('designstudio:terminal'))}>Open terminal</button></dd></>
        )}
        {row.status === 'needs-auth' && !row.live && (
          <><dt>Login</dt><dd>Claude holds this server's OAuth login, which Design Studio can't use from here. The live status shows once Claude starts in this chat.</dd></>
        )}
        {row.command && <><dt>{url ? 'URL' : 'Command'}</dt><dd className="mono wrap">{row.command}</dd></>}
        {row.env && <><dt>Env</dt><dd className="mono wrap">{row.env.join('  ')}</dd></>}
        <dt>From</dt><dd>{scope}{where ? <span className="muted mono"> · {where}</span> : null}</dd>
        <dt>In chat</dt><dd>{row.live ? 'Loaded' : 'Loads when Claude starts'}</dd>
      </dl>
      <div className="mcp-tools-head">
        <span>Tools</span><span className="muted">{row.tools?.length ?? 0}</span>
        <span className="spacer" />
        {(row.tools?.length ?? 0) > 6 && <input placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />}
      </div>
      <div className="mcp-tools">
        {tools.map((t) => (
          <div key={t.name} className="mcp-tool">
            <div className="t"><Icon name="symbol-method" small /><span className="mono">{t.name}</span>{t.readOnly && <span className="mcp-tag ok">read only</span>}{t.destructive && <span className="mcp-tag bad">destructive</span>}</div>
            {t.description && <div className="d">{t.description}</div>}
          </div>
        ))}
        {row.tools && row.tools.length > 0 && tools.length === 0 && <div className="muted">No tool matches</div>}
        {!row.tools?.length && <div className="muted">{row.status === 'connected' ? 'No tools reported' : 'Tools appear once it connects'}</div>}
      </div>
    </aside>
  );
}
