import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson, useRev, useStore } from '../store';
import { Markdown } from './Chat';
import { ago } from '../ago';
import { Icon } from '../Icon';
import { parseHistory, type HistoryBlock } from '../../../shared/history';
import '../history.css';

// The flow's history (flows/NN-slug/history.md): what changed in each iteration and why. Read only. Decisions are
// copied one way from the Decision stickies in Figma, so this tab never edits them: the stickies are the source.

export type HistoryView = {
  flow: { n: number; name: string; slug: string } | null;
  iteration: { id: string; state: 'working' | 'frozen' } | null;
  md: string;
  syncedAt: number | null;
  stale: boolean;
};

type Sync = { state: 'idle' } | { state: 'syncing' } | { state: 'failed'; reason: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.\s*$/, '');
/** "Figma is not connected" -> "figma is not connected", keeping names like "Figma" as they are. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^Figma\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** One step down for the headings inside a block, so the page reads h2 History, h3 iteration, h4 part, h5 screen. */
export const blockMarkdown = (body: string) => body.replace(/^(#{3,4}) /gm, '#$1 ');

export function History() {
  const sid = useStore((s) => s.session.id);
  const rev = useRev('history.md');
  const [view, setView] = useState<HistoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<Sync>({ state: 'idle' });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);
  const auto = useRef('');

  const load = useCallback(async () => {
    try {
      setView(await getJson<HistoryView>('/api/history'));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const runSync = useCallback(async () => {
    setSync({ state: 'syncing' });
    try {
      setView(await getJson<HistoryView>('/api/history/sync', { method: 'POST' }));
      setSync({ state: 'idle' });
    } catch (e) {
      setSync({ state: 'failed', reason: message(e) });
    }
  }, []);

  useEffect(() => {
    setView(null);
    setError(null);
    setSync({ state: 'idle' });
    setOpen({});
    void load();
  }, [sid, load]);

  useEffect(() => {
    if (rev) void load();
  }, [rev, load]);

  // Out of date decisions are read from Figma once when the tab opens, not after every turn.
  useEffect(() => {
    const key = `${sid}|${view?.iteration?.id ?? ''}`;
    if (!view?.flow || !view.stale || auto.current === key) return;
    auto.current = key;
    void runSync();
  }, [view, sid, runSync]);

  // Keeps "2 min ago" current.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const loading = !view && !error;
  const blocks = view?.md ? parseHistory(view.md).blocks : [];
  const frozen = view?.iteration?.state === 'frozen';

  return (
    <div className="hist-page" aria-busy={loading || sync.state === 'syncing'}>
      <div className="hist-head">
        <h2>History</h2>
        {view?.flow && <p className="hist-sub">Flow {view.flow.n} · {view.flow.name}</p>}
        {view?.flow && <SyncLine view={view} sync={sync} frozen={frozen} onSync={() => void runSync()} />}
      </div>

      {loading && (
        <div className="hist-blocks" aria-label="Loading history">
          {[0, 1, 2].map((i) => <div key={i} className="hist-skel" />)}
        </div>
      )}

      {error && (
        <p className="hist-error" role="alert">
          Could not read the history file: {error}. <button type="button" className="link" onClick={() => { setError(null); void load(); }}>Try again</button>
        </p>
      )}

      {view && !view.flow && <p className="hist-empty">History belongs to a flow. Open a chat on a flow to see it.</p>}

      {view?.flow && !blocks.length && (
        <div className="hist-none">
          <h3>No history yet</h3>
          <p>Design Studio adds to this as you work on this flow: what changed in each iteration and why.</p>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="hist-blocks">
          {blocks.map((b, i) => <Block key={b.id ?? `${i}:${b.heading}`} block={b} open={open[b.id ?? b.heading] ?? i === 0} onToggle={(v) => setOpen((o) => ({ ...o, [b.id ?? b.heading]: v }))} />)}
        </div>
      )}
    </div>
  );
}

function SyncLine({ view, sync, frozen, onSync }: { view: HistoryView; sync: Sync; frozen: boolean; onSync: () => void }) {
  if (sync.state === 'syncing') return <p className="hist-meta" role="status">Syncing…</p>;
  if (sync.state === 'failed') {
    return (
      <p className="hist-meta hist-failed" role="alert">
        Could not read Figma: {lower(sync.reason)}. Decisions show the last sync. <button type="button" className="link" onClick={onSync}>Try again</button>
      </p>
    );
  }
  const when = view.syncedAt ? ago(view.syncedAt) : 'not yet';
  return (
    <p className="hist-meta" role="status">
      <span>Synced from Figma: {when}</span>
      {frozen && view.syncedAt ? <><span aria-hidden="true">·</span><span>Frozen: decisions stay as they were</span></> : <><span aria-hidden="true">·</span><button type="button" className="link" onClick={onSync}>Sync now</button></>}
    </p>
  );
}

function Block({ block, open, onToggle }: { block: HistoryBlock; open: boolean; onToggle: (open: boolean) => void }) {
  const id = `hist-${(block.id ?? block.heading).replace(/[^\w-]/g, '-')}`;
  return (
    <section className="hist-block">
      <h3>
        <button type="button" className="hist-toggle" aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
          <span>{block.heading}</span>
        </button>
      </h3>
      {open && <div id={id} className="hist-body"><Markdown text={blockMarkdown(block.body)} /></div>}
    </section>
  );
}
