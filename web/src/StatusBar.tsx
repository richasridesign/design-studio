import { useEffect, useRef, useState } from 'react';
import { getJson, send, useStore } from './store';
import type { McpServer, PlanLimit } from '../../shared/protocol';
import { Icon } from './Icon';
import { SpendPill } from './SpendPill';
import { McpItem, openMcp } from './panes/McpStatus';
import { openFigmaLogin, RECHECK } from './FigmaLogin';
import { useDevTools } from './devTools';
import './statusbar.css';

const FIGMA: Record<string, [tone: string, label: string]> = {
  connected: ['ok', 'Connected'],
  'needs-auth': ['warn', 'Needs login'],
  failed: ['bad', 'Not connected'],
  pending: ['wait', 'Connecting'],
};

export function figmaState(mcp: { name: string; status: string }[]): [tone: string, label: string] {
  const row = mcp.find((m) => /figma/i.test(m.name));
  return row ? FIGMA[row.status] ?? ['off', 'Off'] : ['off', 'Not set up'];
}

/**
 * Claude reports the live Figma status only once it runs in a chat. Before that, show the server's last check
 * of the plugin login, so a new chat does not read as Not set up. A login in the dialog checks again.
 */
export function useFigmaRows(): McpServer[] | null {
  const live = useStore((s) => s.session.mcp);
  const [probed, setProbed] = useState<McpServer[] | null>(null);
  const none = live.length === 0;
  useEffect(() => {
    if (!none) return;
    let alive = true;
    const load = () => getJson<McpServer[]>('/api/mcp/probe').then((r) => { if (alive) setProbed(r); }, () => { if (alive) setProbed([]); });
    load();
    window.addEventListener(RECHECK, load);
    return () => { alive = false; window.removeEventListener(RECHECK, load); };
  }, [none]);
  return none ? probed : live;
}

/** The Figma state the status bar and Settings both show. */
export const shownState = (rows: McpServer[] | null): [tone: string, label: string] => (rows ? figmaState(rows) : ['wait', 'Checking']);

export const RETRY_MS = 30_000;

export const shouldRetry = (status: string | undefined, last: number, now: number) =>
  (status === 'needs-auth' || status === 'failed') && now - last >= RETRY_MS;

function useFigmaRetry(row: { name: string; status: string } | undefined) {
  const last = useRef(0);
  useEffect(() => {
    if (!row || !shouldRetry(row.status, 0, RETRY_MS)) return;
    const retry = () => {
      const now = Date.now();
      if (document.visibilityState !== 'visible' || !shouldRetry(row.status, last.current, now)) return;
      last.current = now;
      send({ type: 'mcp_reconnect', name: row.name, quiet: true });
    };
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [row?.name, row?.status]);
}

export function cacheLeft(cache: { at: number; ttlMs: number } | null, now: number) {
  if (!cache) return 0;
  return Math.max(0, cache.at + cache.ttlMs - now);
}

// While a turn runs the server status can still read Idle until the first step reports.
export const runningText = (status: string) => (!status || status === 'Idle' ? 'Working' : status);

const KIND: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', seven_day_opus: 'Weekly Opus limit', seven_day_sonnet: 'Weekly Sonnet limit' };

export function limitText(l: PlanLimit) {
  const name = KIND[l.kind] ?? 'Plan limit';
  const used = l.status === 'rejected' ? 'reached' : l.used === null ? 'OK' : `${Math.round(l.used * 100)}% used`;
  const at = l.resetsAt ? new Date(l.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const tone = l.status === 'rejected' ? 'bad' : l.status === 'allowed_warning' || (l.used ?? 0) >= 0.8 ? 'warn' : '';
  return { label: `${name}: ${used}`, resets: at && `Resets: ${at}`, tone };
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Compact Figma connection for the phone top bar: a status shape plus the word Figma, full state in its name. */
export function FigmaItem() {
  const [tone, label] = shownState(useFigmaRows());
  return (
    <button className="mcp-item figma-item" aria-label={`Figma: ${label}`} title={`Figma: ${label}`} onClick={openMcp}>
      <span className={`sb-dot ${tone}`} aria-hidden="true" /> <span className="label">Figma</span>
    </button>
  );
}

export function StatusBar() {
  const mcp = useStore((s) => s.session.mcp);
  const cache = useStore((s) => s.session.cache);
  const limit = useStore((s) => s.session.limit);
  const dev = useDevTools();
  const [now, setNow] = useState(Date.now());
  const left = cacheLeft(cache, now);

  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left > 0, cache?.at]);

  const rows = useFigmaRows();
  const [tone, label] = shownState(rows);
  const figma = mcp.find((m) => /figma/i.test(m.name));
  const needsLogin = rows?.find((m) => /figma/i.test(m.name))?.status === 'needs-auth';
  useFigmaRetry(figma);
  const stuck = figma && (figma.status === 'needs-auth' || figma.status === 'failed');
  const retry = () => { if (figma) send({ type: 'mcp_reconnect', name: figma.name }); };

  return (
    <footer className="statusbar desktop-only">
      <button className="sb-item" onClick={openMcp}>
        <span className={`sb-dot ${tone}`} aria-hidden="true" /> Figma: {label}
      </button>
      {needsLogin && <button className="sb-link sb-help" onClick={openFigmaLogin}>Log in to Figma</button>}
      {/* Needing login, Try again lives in the Log in to Figma dialog, so the footer keeps one action. */}
      {stuck && figma.status !== 'needs-auth' && (
        <button
          className="sb-link"
          title="Reconnect Figma now. Design Studio also tries again when you come back to this window."
          onClick={retry}
        >
          Try again
        </button>
      )}
      <span className="spacer" />
      {/* Cache and MCP counts are developer detail: shown only with Developer tools on. */}
      {dev && left > 0 && (
        <span className="sb-item" title="Claude keeps this chat in its prompt cache for a few minutes. Messages sent before it runs out cost less.">
          <Icon name="clock" small /> Cache {clock(left)}
        </span>
      )}
      {limit && (() => {
        const l = limitText(limit);
        return (
          <span className={`sb-item sb-limit ${l.tone}`} title="Your Claude plan usage. It updates with each reply.">
            {l.tone && <span className={`sb-dot ${l.tone}`} aria-hidden="true" />}{l.label}{l.resets && <span className="sb-faint">{l.resets}</span>}
          </span>
        );
      })()}
      <SpendPill />
      {dev && <McpItem />}
    </footer>
  );
}
