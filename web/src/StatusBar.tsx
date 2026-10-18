import { useEffect, useRef, useState } from 'react';
import { send, useStore } from './store';
import type { PlanLimit } from '../../shared/protocol';
import { Icon } from './Icon';
import { SpendPill } from './SpendPill';
import { McpItem, openMcp } from './panes/McpStatus';
import { FigmaLogin } from './FigmaLogin';
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
  return { label: `${name}: ${used}`, resets: at && `resets ${at}`, tone };
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function StatusBar() {
  const mcp = useStore((s) => s.session.mcp);
  const cache = useStore((s) => s.session.cache);
  const limit = useStore((s) => s.session.limit);
  const [now, setNow] = useState(Date.now());
  const left = cacheLeft(cache, now);

  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left > 0, cache?.at]);

  const [tone, label] = figmaState(mcp);
  const figma = mcp.find((m) => /figma/i.test(m.name));
  useFigmaRetry(figma);
  const stuck = figma && (figma.status === 'needs-auth' || figma.status === 'failed');
  const [help, setHelp] = useState(false);
  const status = useRef<HTMLButtonElement>(null);
  const retry = () => { if (figma) send({ type: 'mcp_reconnect', name: figma.name }); };
  const closeHelp = () => {
    setHelp(false);
    // The "How to log in" link is gone once Figma connects, so focus goes back to the Figma status.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!document.querySelector('.statusbar .sb-help')) status.current?.focus(); }));
  };

  return (
    <footer className="statusbar desktop-only">
      <button ref={status} className="sb-item" title="Figma connection, open MCP servers" onClick={openMcp}>
        <span className={`sb-dot ${tone}`} aria-hidden="true" /> Figma: {label}
      </button>
      {figma?.status === 'needs-auth' && <button className="sb-link sb-help" onClick={() => setHelp(true)}>How to log in</button>}
      {help && figma && <FigmaLogin name={figma.name} tone={tone} label={label} onClose={closeHelp} onRetry={retry} />}
      {/* Needing login, Try again lives in the How to log in dialog, so the footer keeps one action. */}
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
      {left > 0 && (
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
      <McpItem />
    </footer>
  );
}
