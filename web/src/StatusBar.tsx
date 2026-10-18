import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Icon } from './Icon';
import { SpendPill } from './SpendPill';
import { McpItem, openMcp } from './panes/McpStatus';
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

export function cacheLeft(cache: { at: number; ttlMs: number } | null, now: number) {
  if (!cache) return 0;
  return Math.max(0, cache.at + cache.ttlMs - now);
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function StatusBar() {
  const mcp = useStore((s) => s.session.mcp);
  const cache = useStore((s) => s.session.cache);
  const [now, setNow] = useState(Date.now());
  const left = cacheLeft(cache, now);

  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left > 0, cache?.at]);

  const [tone, label] = figmaState(mcp);

  return (
    <footer className="statusbar desktop-only">
      <button className="sb-item" title="Figma connection, open MCP servers" onClick={openMcp}>
        <span className={`sb-dot ${tone}`} aria-hidden="true" /> Figma: {label}
      </button>
      <span className="spacer" />
      {left > 0 && (
        <span className="sb-item" title="Claude keeps this chat in its prompt cache for a few minutes. Messages sent before it runs out cost less.">
          <Icon name="clock" small /> Cache {clock(left)}
        </span>
      )}
      <SpendPill />
      <McpItem />
    </footer>
  );
}
