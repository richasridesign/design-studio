import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getJson, postJson } from '../store';
import { Icon } from '../Icon';
import { useDialogFocus } from '../useDialog';
import { Shell } from './ProjectDialogs';
import {
  CLEARANCE_LABEL, NOTE_MAX, SITE_DEFAULT, SITE_PAGES, draftError, flagLine, keyError, isRunning, longSentences, needsTick, pickOf, pickSummary, projectLinkError,
  RUN_LABEL, runShape, shortDate, siteError, strip, suggestionHead, type Choice, type Clearance, type EditRecord, type PickEntry, type Picks, type Run, type RunState, type Suggestion,
} from '../../../shared/portfolio';
import {
  adoptedLine, clearanceTag, currentRun, doneLine, editedLine, editingLine, emptyLine, gatherLine, gatherRunning, planLine, publishChangedLine, publishLine,
  screenName, sourceLabel, undoingLine, type Candidate, type PortfolioView,
} from './portfolioState';
import '../newIteration.css';
import '../portfolio.css';

// Update portfolio: richadesign.in from finished Figma work. A full-height page over the app, opened from the
// Portfolio row in the sidebar or the `page:portfolio` command. Design Studio never publishes: Richa does, in Framer.

export const PORTFOLIO_CHANGED = 'designstudio:portfolio-changed';
const changed = () => window.dispatchEvent(new Event(PORTFOLIO_CHANGED));

type RunView = { run: Run; candidates: Candidate[]; suggestions: Suggestion[]; picks: Picks; edits: EditRecord[]; shots: string[] };
type Tab = 'suggestions' | 'changes' | 'site';

// ---------- Mounting ----------

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function openPortfolio(run?: string) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'pf-host';
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root?.render(<PortfolioPage key={run ?? 'auto'} initialRun={run ?? null} onClose={closePortfolio} />);
}

export function closePortfolio() {
  root?.render(null);
  changed();
}

// The command opens the page here. It stops there, so the center tabs do not switch to a page they do not have.
if (typeof window !== 'undefined') {
  window.addEventListener('designstudio:command', (e) => {
    if ((e as CustomEvent<{ id?: string }>).detail?.id !== 'page:portfolio') return;
    e.stopImmediatePropagation();
    openPortfolio();
  });
}

// ---------- Small parts ----------

const runUrl = (id: string, act?: string) => `/api/portfolio/runs/${id}${act ? `/${act}` : ''}`;
const shotUrl = (id: string, node: string) => `${runUrl(id)}/shots/${node.replace(/:/g, '-')}.png`;
const siteUrl = (site: string, p = '/') => `https://${site}${p}`;

function Card({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <section className={`pf-card${tone ? ` ${tone}` : ''}`}>{children}</section>;
}

/** Wait line: a spinner with its text, announced politely. */
const Wait = ({ text }: { text: string }) => <p className="pf-wait" role="status"><span className="ni-spin" aria-hidden="true" />{text}</p>;

function Strip({ run }: { run: Run | null }) {
  const steps = strip(run?.state ?? null);
  return (
    <ol className="pf-strip" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.id} className={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="pf-step-mark" aria-hidden="true">{s.state === 'done' ? <Icon name="check" small /> : i + 1}</span>
          <span className="pf-step-label">{s.label}</span>
          {s.state === 'done' && <span className="sr-only">, done</span>}
          {i < steps.length - 1 && <Icon name="chevron-right" small />}
        </li>
      ))}
    </ol>
  );
}

function Tag({ c }: { c: Clearance }) {
  const t = clearanceTag(c);
  return <span className="pf-tag"><span className={`pf-shape ${t.shape}`} aria-hidden="true" />{t.label}</span>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="pf-small" aria-label={label} onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// ---------- S1 Setup ----------

type Check = { state: 'idle' | 'checking' | 'ok' | 'off'; reason?: string };
type KeyCheck = { state: 'idle' | 'checking' | 'ok' | 'off'; text?: string };
type Route = 'chrome' | 'api';
type Mode = Route | 'copy';

const SUBMITTING: Record<Mode, string> = { chrome: 'Checking Framer in your Chrome…', api: 'Checking the key with Framer…', copy: 'Saving…' };

export function SetupDialog({ initial, onClose, onDone, onView }: { initial: PortfolioView['config']; onClose: () => void; onDone: (v: PortfolioView) => void; onView: (v: PortfolioView) => void }) {
  const [project, setProject] = useState(initial?.project ?? '');
  const [site, setSite] = useState(initial?.site ?? SITE_DEFAULT);
  // Chrome stays the default route until a key has passed its check.
  const [route, setRoute] = useState<Route>(initial?.mode === 'api' && initial.hasKey ? 'api' : 'chrome');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(!!initial?.hasKey);
  const [seen, setSeen] = useState({ project: false, site: false, key: false });
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [keyCheck, setKeyCheck] = useState<KeyCheck>({ state: 'idle' });
  const [phase, setPhase] = useState<{ kind: 'form' | 'submitting'; mode?: Mode; error?: string }>({ kind: 'form' });
  const busy = phase.kind === 'submitting';
  const pErr = projectLinkError(project);
  const sErr = siteError(site);
  const keptKey = hasKey && project.trim() === (initial?.project ?? '');
  const kErr = route === 'api' ? (key.trim() ? keyError(key) : keptKey ? '' : 'Paste the API key') : '';
  const valid = !pErr && !sErr && !kErr;
  const seq = useRef(0);

  const runCheck = useCallback(async (link: string) => {
    const n = ++seq.current;
    setCheck({ state: 'checking' });
    try {
      const r = await postJson<{ ok: boolean; reason?: string }>('/api/portfolio/check', { project: link });
      if (n === seq.current) setCheck(r.ok ? { state: 'ok' } : { state: 'off', reason: r.reason });
    } catch (e) {
      if (n === seq.current) setCheck({ state: 'off', reason: (e as Error).message });
    }
  }, []);

  // The Chrome check runs once the link is a Framer project link, 600ms after typing stops.
  useEffect(() => {
    if (pErr || route !== 'chrome') {
      seq.current++;
      setCheck({ state: 'idle' });
      return;
    }
    const t = setTimeout(() => void runCheck(project.trim()), 600);
    return () => clearTimeout(t);
  }, [project, pErr, route, runCheck]);

  const checkKeyNow = async () => {
    setSeen((s) => ({ ...s, project: true, key: true }));
    if (pErr || kErr) return;
    setKeyCheck({ state: 'checking' });
    try {
      const r = await postJson<{ ok: boolean; name?: string; error?: string }>('/api/portfolio/key/check', { project: project.trim(), ...(key.trim() ? { key } : {}) });
      setKeyCheck(r.ok ? { state: 'ok', text: `Key works: ${r.name}` } : { state: 'off', text: r.error });
    } catch (e) {
      setKeyCheck({ state: 'off', text: (e as Error).message });
    }
  };

  const removeKey = async () => {
    setKeyCheck({ state: 'idle' });
    try {
      await postJson('/api/portfolio/key/remove', {});
      setHasKey(false);
      setRoute('chrome');
      setKeyCheck({ state: 'idle', text: 'Key removed from your Keychain. Edits use Framer in your Chrome.' });
      changed();
      onView(await getJson<PortfolioView>('/api/portfolio'));
    } catch (e) {
      setKeyCheck({ state: 'off', text: (e as Error).message });
    }
  };

  const submit = async (mode: Mode) => {
    setSeen({ project: mode !== 'copy', site: true, key: mode === 'api' });
    if (sErr || (mode !== 'copy' && pErr) || (mode === 'api' && kErr)) return;
    setPhase({ kind: 'submitting', mode });
    try {
      await postJson('/api/portfolio/setup', { project: project.trim(), site: site.trim(), mode, ...(mode === 'api' && key.trim() ? { key } : {}) });
      setKey('');
      changed();
      onDone(await getJson<PortfolioView>('/api/portfolio'));
    } catch (e) {
      setPhase({ kind: 'form', mode, error: (e as Error).message });
      if (mode === 'chrome') void runCheck(project.trim());
    }
  };

  const failed = phase.kind === 'form' && phase.error ? phase : null;
  const projectHelp = seen.project && pErr ? pErr : failed && failed.mode === 'chrome' ? failed.error : '';
  const keyHelp = seen.key && kErr ? kErr : failed && failed.mode === 'api' ? failed.error : keyCheck.state === 'off' ? keyCheck.text : '';
  const why = !valid ? (pErr || sErr || kErr) : undefined;
  return (
    <Shell title="Connect your portfolio" onClose={onClose} busy={busy}>
      <form className="project-dialog-body pf-setup" noValidate onSubmit={(e) => { e.preventDefault(); void submit(route); }}>
        <p className="project-dialog-note">Design Studio edits Framer for you. It never publishes: you do, in Framer.</p>
        <fieldset className="ni-fields" disabled={busy}>
          <div className="field">
            <label htmlFor="pf-project">Framer project link *</label>
            <input id="pf-project" value={project} required autoFocus autoComplete="off" spellCheck={false} placeholder="https://framer.com/projects/..."
              aria-invalid={projectHelp ? true : undefined} aria-describedby="pf-project-help pf-chrome"
              onChange={(e) => { setProject(e.target.value); setPhase({ kind: 'form' }); setKeyCheck({ state: 'idle' }); }} onBlur={() => setSeen((s) => ({ ...s, project: true }))} />
            {projectHelp && <span id="pf-project-help" className="error-text small" role="alert">{projectHelp}</span>}
          </div>
          <div className="field">
            <label htmlFor="pf-site">Site address *</label>
            <input id="pf-site" value={site} required autoComplete="off" spellCheck={false} aria-invalid={seen.site && sErr ? true : undefined} aria-describedby="pf-site-help"
              onChange={(e) => setSite(e.target.value)} onBlur={() => setSeen((s) => ({ ...s, site: true }))} />
            {seen.site && sErr && <span id="pf-site-help" className="error-text small">{sErr}</span>}
          </div>
        </fieldset>
        <fieldset className="pf-route" disabled={busy}>
          <legend>Edit Framer through</legend>
          <label><input type="radio" name="pf-route" checked={route === 'chrome'} onChange={() => { setRoute('chrome'); setPhase({ kind: 'form' }); }} />Framer in your Chrome</label>
          <label><input type="radio" name="pf-route" checked={route === 'api'} onChange={() => { setRoute('api'); setPhase({ kind: 'form' }); }} />Framer API key</label>
        </fieldset>
        {route === 'chrome' && (
          <div id="pf-chrome" className="pf-check" aria-live="polite">
            {check.state === 'ok' && <span className="pf-ok"><Icon name="pass" small />Framer in your Chrome: Signed in</span>}
            {check.state === 'checking' && !busy && <span className="muted"><span className="ni-spin" aria-hidden="true" />Checking Framer in your Chrome…</span>}
            {(check.state === 'idle' || check.state === 'off') && (
              <span className="muted">
                {check.state === 'off' && check.reason ? check.reason : 'Open your Framer project in Chrome and sign in.'}
                {!pErr && <> <button type="button" className="link" onClick={() => void runCheck(project.trim())}>Check again</button></>}
              </span>
            )}
          </div>
        )}
        {route === 'api' && (
          <div className="field pf-key">
            <label htmlFor="pf-key">Framer API key{keptKey ? '' : ' *'}</label>
            <div className="pf-key-row">
              <input id="pf-key" type="password" value={key} required={!keptKey} autoComplete="off" spellCheck={false} disabled={busy}
                placeholder={keptKey ? 'Paste a new key to replace it' : undefined}
                aria-invalid={keyHelp ? true : undefined} aria-describedby="pf-key-help pf-key-result"
                onChange={(e) => { setKey(e.target.value); setKeyCheck({ state: 'idle' }); setPhase({ kind: 'form' }); }} onBlur={() => setSeen((s) => ({ ...s, key: true }))} />
              <button type="button" disabled={busy || keyCheck.state === 'checking'} onClick={() => void checkKeyNow()}>{keyCheck.state === 'checking' ? 'Checking…' : 'Check key'}</button>
            </div>
            {keyHelp
              ? <span id="pf-key-help" className="error-text small" role="alert">{keyHelp}</span>
              : <span id="pf-key-help" className="muted small">Framer: Site Settings &gt; General &gt; API keys. One key per project.</span>}
            <span id="pf-key-result" className="pf-check small" aria-live="polite">
              {keyCheck.state === 'ok' && <span className="pf-ok"><Icon name="pass" small />{keyCheck.text}</span>}
              {keyCheck.state === 'idle' && keyCheck.text && <span className="muted">{keyCheck.text}</span>}
              {keptKey && keyCheck.state !== 'ok' && !keyCheck.text && <span className="muted">API key: Saved in your Keychain.</span>}
              {keptKey && <> <button type="button" className="link" disabled={busy} onClick={() => void removeKey()}>Remove key</button></>}
            </span>
          </div>
        )}
        {route === 'chrome' && hasKey && keptKey && (
          <p className="pf-line muted small">An API key is saved for this project. <button type="button" className="link" disabled={busy} onClick={() => void removeKey()}>Remove key</button></p>
        )}
        {busy ? <Wait text={SUBMITTING[phase.mode ?? 'chrome']} /> : <p className="muted small">* Required</p>}
        {failed && failed.mode === 'copy' && <p className="error-text small" role="alert">{failed.error}</p>}
        <div className="dialog-actions pf-actions">
          <button type="button" className="link" disabled={busy} onClick={() => void submit('copy')}>Use copy and paste instead</button>
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !valid} title={busy ? undefined : why}>{busy && phase.mode !== 'copy' ? 'Connecting…' : 'Connect'}</button>
        </div>
      </form>
    </Shell>
  );
}

// ---------- Connection status ----------

type Conn = { on: boolean; why?: string } | null;

/**
 * Header status. API key: the Keychain still holds it (attributes only, the key never reaches the page). Chrome:
 * the saved project is open there, signed in. Copy and paste connects nothing, so it shows no status.
 */
function useConnection(config: PortfolioView['config']): Conn {
  const [conn, setConn] = useState<Conn>(null);
  const mode = config?.mode;
  const project = config?.project ?? '';
  const hasKey = !!config?.hasKey;
  useEffect(() => {
    setConn(null);
    if (!mode || mode === 'copy') return;
    let live = true;
    const set = (c: Conn) => { if (live) setConn(c); };
    if (mode === 'api') {
      if (!hasKey) set({ on: false, why: 'No API key is saved. Change connection to paste one.' });
      else getJson<{ saved: boolean }>('/api/portfolio/key/status')
        .then((r) => set(r.saved ? { on: true } : { on: false, why: 'The API key is not in your Keychain any more. Change connection to paste it again.' }))
        .catch((e) => set({ on: false, why: (e as Error).message }));
    } else {
      postJson<{ ok: boolean; reason?: string }>('/api/portfolio/check', { project })
        .then((r) => set(r.ok ? { on: true } : { on: false, why: r.reason ?? 'Chrome is not showing this Framer project. Open it there, signed in.' }))
        .catch((e) => set({ on: false, why: (e as Error).message }));
    }
    return () => { live = false; };
  }, [mode, project, hasKey]);
  return conn;
}

/** Shape plus label: a filled circle when connected, a hollow triangle (attention, not an error) when not. */
function ConnStatus({ conn }: { conn: Conn }) {
  if (!conn) return null;
  return (
    <span className={`pf-conn ${conn.on ? 'on' : 'off'}`} title={conn.why}>
      {conn.on
        ? <span className="pf-shape circle filled" aria-hidden="true" />
        : <svg className="pf-conn-mark" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
      {conn.on ? 'Connected' : 'Not connected'}
      {conn.why && <span className="sr-only">: {conn.why}</span>}
    </span>
  );
}

// ---------- S2 Gather ----------

function Gather({ view, onStarted, onView }: { view: PortfolioView; onStarted: (r: Run) => void; onView: (v: PortfolioView) => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(view.blocks.map((b) => b.key)));
  const [date, setDate] = useState<{ open: boolean; value: string; error: string }>({ open: false, value: view.file.since ?? '', error: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setTicked((t) => new Set(view.blocks.map((b) => b.key).filter((k) => t.has(k) || !t.size))), [view.blocks]);

  const settings = async (body: unknown) => {
    try {
      await postJson('/api/portfolio/settings', body);
      onView(await getJson<PortfolioView>('/api/portfolio'));
      changed();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      onStarted(await postJson<Run>('/api/portfolio/runs', { blocks: none ? [] : [...ticked], note }));
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveDate = async () => {
    if (date.value && !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return setDate({ ...date, error: 'Pick a date' });
    if (await settings({ since: date.value || null })) setDate({ ...date, open: false, error: '' });
  };

  const none = !view.blocks.length;
  const projects = view.projects;
  const wrote = !!note.trim();
  const why = none ? (wrote ? undefined : 'Write what should change first') : !ticked.size && !wrote ? 'Tick a block of finished work, or write what should change' : undefined;
  return (
    <Card>
      <h2 className="pf-card-title">Gather finished work</h2>
      <p className="pf-line">{none ? emptyLine(view.file, view.config?.site) : gatherLine(view.blocks, view.file)}</p>
      {!none && (
        <fieldset className="pf-blocks">
          <legend className="sr-only">Blocks to read</legend>
          {view.blocks.map((b) => (
            <label key={b.key} className="pf-block">
              <input type="checkbox" checked={ticked.has(b.key)} onChange={(e) => setTicked((t) => { const n = new Set(t); if (e.target.checked) n.add(b.key); else n.delete(b.key); return n; })} />
              <span className="pf-block-name">{b.label}</span>
              <Tag c={b.clearance} />
            </label>
          ))}
        </fieldset>
      )}
      <div className="field pf-draft">
        <label htmlFor="pf-note">{none ? <>What should change? <span aria-hidden="true">*</span></> : 'Anything else to change?'}</label>
        <textarea id="pf-note" rows={3} maxLength={NOTE_MAX} required={none} value={note} disabled={busy} placeholder="Shorten the About intro and add Design Studio to Work"
          onChange={(e) => setNote(e.target.value)} />
        {none && <span className="muted small">* Required</span>}
      </div>
      {view.adopted > 0 && !view.file.includeAdopted && (
        <p className="pf-line muted">{adoptedLine(view.adopted)} <button type="button" className="link" onClick={() => void settings({ includeAdopted: true })}>Include them</button></p>
      )}
      {projects.length > 0 && (
        <details className="pf-clearance">
          <summary>Confidential work: {projects.map((p) => `${p.name}, ${CLEARANCE_LABEL[p.clearance]}`).join('; ')}</summary>
          {projects.map((p) => (
            <div key={p.key} className="pf-clearance-row">
              <label htmlFor={`pf-cl-${p.key}`}>{p.name}</label>
              <select id={`pf-cl-${p.key}`} value={p.clearance} onChange={(e) => void settings({ clearance: { key: p.key, value: e.target.value } })}>
                {(Object.keys(CLEARANCE_LABEL) as Clearance[]).map((c) => <option key={c} value={c}>{CLEARANCE_LABEL[c]}</option>)}
              </select>
            </div>
          ))}
          <p className="muted small">Never: the project is not read. Cleared: names are hidden and numbers stay flagged for your tick.</p>
        </details>
      )}
      {date.open && (
        <div className="pf-date">
          <label htmlFor="pf-since">Start date</label>
          <input id="pf-since" type="date" value={date.value} aria-invalid={date.error ? true : undefined} aria-describedby="pf-since-help" onChange={(e) => setDate({ ...date, value: e.target.value, error: '' })} />
          <button type="button" onClick={() => void saveDate()}>Save</button>
          <span id="pf-since-help" className={date.error ? 'error-text small' : 'muted small'}>{date.error || 'Empty: each project from its adoption date.'}</span>
        </div>
      )}
      {error && <p className="error-text small" role="alert">{error}</p>}
      <div className="pf-foot">
        {!date.open && <button type="button" className="link" onClick={() => setDate({ ...date, open: true })}>Change start date</button>}
        <span className="spacer" />
        <button type="button" className="primary" disabled={busy || !!why} title={why} onClick={() => void start()}>{busy ? 'Starting…' : 'Suggest updates'}</button>
      </div>
    </Card>
  );
}

// ---------- S3 Pick ----------

function SuggestionCard({ s, pick, rv, editable, onPick, blocking }: { s: Suggestion; pick: PickEntry; rv: RunView; editable: boolean; onPick: (p: PickEntry, now?: boolean) => void; blocking: boolean }) {
  const id = useId();
  const err = draftError(pick.draft);
  const long = longSentences(pick.draft);
  const tick = needsTick(s, pick);
  const source = s.sources[0];
  const notes = rv.candidates.flatMap((c) => c.screens);
  return (
    <article className={`pf-sugg${pick.choice === 'use' ? ' used' : ''}${blocking ? ' blocking' : ''}`} aria-labelledby={`${id}-h`} id={`pf-s-${s.id}`}>
      <h3 id={`${id}-h`}>{suggestionHead(s)}</h3>
      <p className="pf-line">{s.what}</p>
      <p className="pf-line muted">Why: {s.why}</p>
      {source && <p className="pf-line small">Source: {s.sources.map((x) => sourceLabel(rv.candidates, x.block)).join('; ')}</p>}
      {source?.quotes.length ? (
        <ul className="pf-quotes">
          {s.sources.flatMap((x) => x.quotes).map((q, i) => {
            const screen = notes.find((n) => n.decisions.some((d) => d.decision === q));
            return <li key={i}>{q}{screen?.link && <> <a className="link" href={screen.link} target="_blank" rel="noreferrer">Open in Figma</a></>}</li>;
          })}
        </ul>
      ) : null}
      <div className="field pf-draft">
        <label htmlFor={`${id}-d`}>Draft copy</label>
        <textarea id={`${id}-d`} rows={Math.min(8, Math.max(3, pick.draft.split('\n').length + 1))} value={pick.draft} readOnly={!editable}
          aria-invalid={pick.choice === 'use' && err ? true : undefined} aria-describedby={`${id}-dh`} onChange={(e) => onPick({ ...pick, draft: e.target.value })} />
        <span id={`${id}-dh`} className={pick.choice === 'use' && err ? 'error-text small' : 'muted small'}>
          {pick.choice === 'use' && err ? err : long.length ? `Long sentence (over 25 words): "${long[0].slice(0, 60)}…"` : 'Your edits are the final copy, word for word.'}
        </span>
      </div>
      {s.images.length > 0 && (
        <div className="pf-shots">
          {s.images.map((node) => {
            const has = rv.shots.includes(node);
            const name = screenName(rv.candidates, node);
            const on = pick.images.includes(node);
            return (
              <label key={node} className="pf-shot">
                {has ? <img src={shotUrl(rv.run.id, node)} alt={name} loading="lazy" /> : <span className="pf-noshot">{name}: not exported</span>}
                <span className="pf-check-row">
                  <input type="checkbox" disabled={!editable || !has} checked={on} onChange={(e) => onPick({ ...pick, images: e.target.checked ? [...pick.images, node] : pick.images.filter((x) => x !== node) }, true)} />
                  Use this image
                </span>
              </label>
            );
          })}
        </div>
      )}
      {tick && (
        <div className="pf-flags">
          {s.flags.length > 0 && <p className="pf-line"><span className="pf-shape triangle" aria-hidden="true" />{flagLine(s.flags)}</p>}
          {pick.images.length > 0 && !s.flags.length && <p className="pf-line"><span className="pf-shape triangle" aria-hidden="true" />Screens can show real data. Check each image.</p>}
          <label className="pf-check-row"><input type="checkbox" disabled={!editable} checked={pick.cleared} onChange={(e) => onPick({ ...pick, cleared: e.target.checked }, true)} />I can show this</label>
        </div>
      )}
      <fieldset className="pf-choice" disabled={!editable}>
        <legend className="sr-only">Use, skip or keep for later</legend>
        {(['use', 'skip', 'later'] as Choice[]).map((c) => (
          <label key={c}><input type="radio" name={`${id}-c`} checked={pick.choice === c} onChange={() => onPick({ ...pick, choice: c }, true)} />{c === 'use' ? 'Use' : c === 'skip' ? 'Skip' : 'Later'}</label>
        ))}
      </fieldset>
    </article>
  );
}

// ---------- Copy pack and edits ----------

function CopyPack({ rv, items }: { rv: RunView; items: Suggestion[] }) {
  if (!items.length) return null;
  return (
    <div className="pf-pack">
      {items.map((s) => {
        const p = pickOf(rv.picks, s);
        const blocks = p.draft.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
        return (
          <article key={s.id} className="pf-pack-item" aria-label={suggestionHead(s)}>
            <h3>{suggestionHead(s)}</h3>
            {blocks.map((b, i) => (
              <div key={i} className="pf-paste">
                <p>{b}</p>
                <CopyButton text={b} label={`Copy paragraph ${i + 1} of ${suggestionHead(s)}`} />
              </div>
            ))}
            {p.images.map((node) => (
              <p key={node} className="pf-line small">Image: <a className="link" href={shotUrl(rv.run.id, node)} download={`${screenName(rv.candidates, node)}.png`}>{screenName(rv.candidates, node)}</a></p>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function EditRows({ edits }: { edits: EditRecord[] }) {
  if (!edits.length) return <p className="pf-line muted">No edits planned yet.</p>;
  return (
    <ul className="pf-edits">
      {edits.map((e) => (
        <li key={e.id} className={e.state}>
          <span className={`pf-edit-mark ${e.state}`} aria-hidden="true">{e.state === 'done' ? <Icon name="check" small /> : e.state === 'failed' ? <Icon name="close" small /> : null}</span>
          <div>
            {e.kind === 'text' ? (
              <>
                <p className="pf-line"><strong>{e.page}</strong> · {e.node}</p>
                <p className="pf-line small muted">Old: {e.old}</p>
                <p className="pf-line small">New: {e.text}</p>
              </>
            ) : (
              <p className="pf-line">Copy and paste: {e.reason}</p>
            )}
            <p className="pf-line small muted">{({ waiting: 'Waiting', done: 'Done', failed: `Failed${e.error ? `: ${e.error}` : ''}`, undone: 'Put back', copy: 'In the copy pack' } as const)[e.state]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- The page ----------

export function PortfolioPage({ onClose, initialRun = null }: { onClose: () => void; initialRun?: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [view, setView] = useState<PortfolioView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chosen, setChosen] = useState<string | null>(initialRun);
  const [fresh, setFresh] = useState(false);
  const [rv, setRv] = useState<RunView | null>(null);
  const [tab, setTab] = useState<Tab>('suggestions');
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState<Picks>({});
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [confirmUndo, setConfirmUndo] = useState(false);
  useDialogFocus(!setup && !confirmUndo, box, onClose);

  const run = fresh ? null : view ? currentRun(view.runs, chosen) : null;
  const id = run?.id ?? null;

  const loadView = useCallback(async () => {
    try {
      const v = await getJson<PortfolioView>('/api/portfolio');
      setView(v);
      setLoadError('');
      return v;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, []);
  const loadRun = useCallback(async (runId: string) => {
    try {
      const r = await getJson<RunView>(runUrl(runId));
      setRv(r);
      setPicks((p) => (Object.keys(p).length && r.run.state === 'picking' ? p : r.picks));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => void loadView(), [loadView]);
  useEffect(() => {
    setRv(null);
    setPicks({});
    if (id) void loadRun(id);
  }, [id, loadRun]);

  // While a step runs, both views refresh every 3 seconds.
  const running = !!rv && isRunning(rv.run.state);
  useEffect(() => {
    if (!running || !id) return;
    const t = setInterval(() => { void loadRun(id); void loadView(); }, 3000);
    return () => clearInterval(t);
  }, [running, id, loadRun, loadView]);

  // Tab follows the step: picks on Suggestions, edits on Changes.
  const state = rv?.run.state;
  useEffect(() => {
    if (!state) return;
    if (state === 'picking') setTab('suggestions');
    else if (['plan', 'planning', 'editing', 'edited', 'edit-failed', 'publish-changed', 'copy'].includes(state)) setTab('changes');
  }, [state]);

  const act = async (what: string) => {
    if (!id) return;
    setBusy(what);
    setError('');
    try {
      const r = await postJson<RunView>(runUrl(id, what), {});
      setRv(r);
      await loadView();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Picks autosave: choices and ticks at once, typing 1 second after it stops.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePicks = useCallback(async (next: Picks) => {
    if (!id) return;
    setSaved('saving');
    try {
      await postJson(runUrl(id, 'picks'), { picks: next });
      setSaved('saved');
    } catch {
      setSaved('failed');
    }
  }, [id]);
  const onPick = (sid: string, p: PickEntry, now?: boolean) => {
    const next = { ...picks, [sid]: p };
    setPicks(next);
    if (pending.current) clearTimeout(pending.current);
    if (now) void savePicks(next);
    else pending.current = setTimeout(() => void savePicks(next), 1000);
  };
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const flush = async () => {
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
      await savePicks(picks);
    }
  };

  const config = view?.config ?? null;
  const site = config?.site ?? SITE_DEFAULT;
  const conn = useConnection(config);
  const list = rv?.suggestions ?? [];
  const sum = pickSummary(list, picks);
  const used = list.filter((s) => pickOf(picks, s).choice === 'use');
  const edits = rv?.edits ?? [];
  const copyEdits = used.filter((s) => edits.some((e) => e.suggestion === s.id && e.state === 'copy'));
  const editable = state === 'picking';

  const startOver = () => { setFresh(true); setChosen(null); setTab('suggestions'); };
  const openRun = (r: Run) => { setFresh(false); setChosen(r.id); };

  const card = (() => {
    if (!view) return loadError ? <Card tone="error"><p className="pf-line error-text" role="alert">Could not load the portfolio: {loadError}</p><div className="pf-foot"><span className="spacer" /><button type="button" onClick={() => void loadView()}>Try again</button></div></Card> : <Wait text="Loading…" />;
    if (!config) {
      return (
        <Card>
          <h2 className="pf-card-title">Connect your portfolio</h2>
          <p className="pf-line">Claude reads your finished Figma work, suggests updates for {SITE_DEFAULT}, then makes the edits in Framer in your Chrome. You publish.</p>
          <div className="pf-foot"><span className="spacer" /><button type="button" className="primary" onClick={() => setSetup(true)}>Connect</button></div>
        </Card>
      );
    }
    if (!run) return <Gather view={view} onView={setView} onStarted={(r) => { setFresh(false); setChosen(r.id); void loadView(); }} />;
    if (!rv) return <Wait text="Loading the run…" />;
    const r = rv.run;
    if (busy === 'undo') {
      return (
        <Card>
          <h2 className="pf-card-title">Undoing the edits</h2>
          <Wait text={undoingLine(edits)} />
        </Card>
      );
    }
    switch (r.state) {
      case 'gathering': case 'suggesting': case 'planning':
        return (
          <Card>
            <h2 className="pf-card-title">{r.state === 'planning' ? 'Planning the edits' : r.state === 'suggesting' ? 'Suggesting updates' : 'Gathering finished work'}</h2>
            <Wait text={r.state === 'planning' ? 'Planning the edits from your picks and the live site, about 2 minutes. Nothing is written yet.' : gatherRunning(r)} />
            <div className="pf-foot"><span className="spacer" /><button type="button" disabled={!!busy} onClick={() => void act('stop')}>{busy === 'stop' ? 'Stopping…' : 'Stop'}</button></div>
          </Card>
        );
      case 'gather-failed': case 'suggest-failed': case 'stopped':
        return (
          <Card tone={r.state === 'stopped' ? undefined : 'error'}>
            <h2 className="pf-card-title">{r.state === 'stopped' ? 'Stopped' : 'Could not suggest updates'}</h2>
            <p className="pf-line" role={r.state === 'stopped' ? undefined : 'alert'}>{r.state === 'stopped' ? 'Stopped. Nothing was changed.' : r.error}</p>
            <div className="pf-foot"><button type="button" className="link" onClick={startOver}>Start over</button><span className="spacer" /><button type="button" disabled={!!busy} onClick={() => void act('retry')}>{busy === 'retry' ? 'Trying…' : 'Try again'}</button></div>
          </Card>
        );
      case 'picking':
        return (
          <Card>
            <h2 className="pf-card-title">Pick what goes on the site</h2>
            <p className="pf-line">{sum.picked} of {sum.total} picked.{saved === 'saving' ? ' Saving…' : saved === 'saved' ? ' Saved.' : saved === 'failed' ? '' : ''}</p>
            {saved === 'failed' && <p className="pf-line error-text small" role="alert">Your picks were not saved. They save again on your next change.</p>}
            {r.note && <p className="pf-line muted small">{r.note}</p>}
            {!view.canEdit && <p className="pf-line muted small">{view.editReason}</p>}
            {sum.blocker && sum.picked > 0 && <p className="pf-line small" id="pf-blocker"><span className="pf-shape triangle" aria-hidden="true" />{sum.blocker} <button type="button" className="link" onClick={() => document.getElementById(`pf-s-${sum.blockerId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>Show it</button></p>}
            <div className="pf-foot">
              <button type="button" className="link" onClick={startOver}>Start over</button>
              <span className="spacer" />
              <button type="button" className="primary" disabled={!!sum.blocker || !!busy} title={sum.blocker ?? undefined} aria-describedby={sum.blocker ? 'pf-blocker' : undefined}
                onClick={() => void flush().then(() => act(view.canEdit ? 'plan' : 'copy'))}>
                {busy ? 'Saving…' : view.canEdit ? 'Make these edits in Framer' : 'Make the copy pack'}
              </button>
            </div>
          </Card>
        );
      case 'copy':
        return (
          <Card>
            <h2 className="pf-card-title">Copy pack ready</h2>
            <p className="pf-line">{used.length} {used.length === 1 ? 'suggestion' : 'suggestions'} to paste in Framer, in Changes below. Nothing was changed in Framer.</p>
            <div className="pf-foot">
              <button type="button" className="link" onClick={() => void act('back')}>Back to picks</button>
              {config.project && <a className="link" href={config.project} target="_blank" rel="noreferrer">Open in Framer</a>}
              <span className="spacer" />
              <button type="button" className="primary" disabled={!!busy} onClick={() => void act('done')}>{busy === 'done' ? 'Saving…' : 'I pasted it'}</button>
            </div>
          </Card>
        );
      case 'plan': case 'plan-failed':
        return (
          <Card tone={r.state === 'plan-failed' ? 'error' : undefined}>
            <h2 className="pf-card-title">{r.state === 'plan' ? 'Plan ready' : 'Could not plan the edits'}</h2>
            <p className="pf-line" role={r.state === 'plan-failed' ? 'alert' : undefined}>{r.state === 'plan' ? planLine(edits) : r.error}</p>
            <div className="pf-foot">
              {r.state === 'plan-failed' && <button type="button" className="link" onClick={() => void act('back')}>Back to picks</button>}
              <span className="spacer" />
              {r.state === 'plan' ? <>
                <button type="button" disabled={!!busy} onClick={() => void act('back')}>Change the plan</button>
                <button type="button" className="primary" disabled={!!busy} onClick={() => void act('go')}>{busy === 'go' ? 'Starting…' : 'Go'}</button>
              </> : <button type="button" disabled={!!busy} onClick={() => void act('retry')}>Try again</button>}
            </div>
          </Card>
        );
      case 'editing':
        return (
          <Card>
            <h2 className="pf-card-title">Editing in Framer</h2>
            {r.publishBefore && <p className="pf-line small muted">{r.publishBefore}</p>}
            <Wait text={editingLine(edits)} />
          </Card>
        );
      case 'edit-failed':
        return (
          <Card tone="error">
            <h2 className="pf-card-title">Framer stopped the edit</h2>
            <p className="pf-line" role="alert">Framer stopped the edit: {r.error}</p>
            <div className="pf-foot"><button type="button" className="link" onClick={() => setConfirmUndo(true)}>Undo all</button><span className="spacer" /><button type="button" disabled={!!busy} onClick={() => void act('go')}>Try again</button></div>
          </Card>
        );
      case 'publish-changed':
        return (
          <Card tone="error">
            <h2 className="pf-card-title">Edits stopped</h2>
            <p className="pf-line" role="alert">{publishChangedLine(r, edits)}</p>
            {r.publishBefore && <p className="pf-line small muted">Before: {r.publishBefore}</p>}
            {r.publishAfter && <p className="pf-line small muted">Now: {r.publishAfter}</p>}
            <div className="pf-foot">
              <button type="button" className="link" onClick={() => setConfirmUndo(true)}>Undo all</button>
              {edits.every((e) => e.kind !== 'text' || e.state === 'done') && (
                <button type="button" className="link" disabled={!!busy} onClick={() => void act('done')}>{busy === 'done' ? 'Saving…' : 'Keep them'}</button>
              )}
              <span className="spacer" />
              <a className="pf-btn" href={siteUrl(site)} target="_blank" rel="noreferrer">Open {site}</a>
            </div>
          </Card>
        );
      case 'edited':
        return (
          <Card>
            <h2 className="pf-card-title">Publish in Framer</h2>
            <p className="pf-line">{editedLine(edits)}</p>
            <p className="pf-line">{publishLine(r, edits)}</p>
            {!!r.outside?.length && <p className="pf-line"><span className="pf-shape triangle" aria-hidden="true" />Also changed outside this run: {r.outside.join(', ')}.</p>}
            {!!r.warnings?.length && <ul className="pf-warnings" aria-label="Publish warnings in Framer">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <p className="pf-line muted small">Preview and publish in Framer. Design Studio never publishes.</p>
            <div className="pf-foot">
              <button type="button" className="link" onClick={() => setConfirmUndo(true)}>Undo all</button>
              <span className="spacer" />
              <button type="button" disabled={!!busy} onClick={() => void act('done')}>{busy === 'done' ? 'Saving…' : 'I published it'}</button>
              <button type="button" className="primary" onClick={() => window.open(config.project || siteUrl(site), '_blank', 'noopener')}>Open in Framer</button>
            </div>
          </Card>
        );
      case 'done':
        return (
          <Card>
            <h2 className="pf-card-title">Done</h2>
            <p className="pf-line"><span className="pf-shape circle filled" aria-hidden="true" />{doneLine(r)}</p>
            <div className="pf-foot"><a className="link" href={siteUrl(site)} target="_blank" rel="noreferrer">View on {site}</a><span className="spacer" /><button type="button" onClick={startOver}>Start a new update</button></div>
          </Card>
        );
    }
  })();

  const showTabs = !!rv && !['gathering', 'gather-failed', 'stopped'].includes(rv.run.state);
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'suggestions', label: 'Suggestions' }, { id: 'changes', label: 'Changes' }, { id: 'site', label: 'Site' }];
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
    setTab(next);
    document.getElementById(`pf-tab-${next}`)?.focus();
  };

  return (
    <div className="pf-overlay">
      <div ref={box} className="pf-page" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pf-head">
          <Icon name="globe" />
          <div className="pf-head-text">
            <h1 id={titleId}>Update portfolio</h1>
            <span className="muted small">{site}{config ? ` · ${config.mode === 'copy' ? 'Copy and paste' : config.mode === 'api' ? 'Framer API key' : 'Framer in your Chrome'}` : ''}</span>
          </div>
          <span className="spacer" />
          {config && (
            <div className="pf-head-conn">
              <ConnStatus conn={conn} />
              <button type="button" className="link pf-head-link" onClick={() => setSetup(true)}>Change connection</button>
            </div>
          )}
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="pf-body">
          <Strip run={run && rv ? rv.run : null} />
          {card}
          {error && <p className="pf-line error-text" role="alert">{error}</p>}
          {showTabs && rv && (
            <>
              <div className="pf-tabs" role="tablist" aria-label="Portfolio" onKeyDown={onTabKey}>
                {tabs.map((t) => (
                  <button key={t.id} id={`pf-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls={`pf-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
              </div>
              <div id={`pf-panel-${tab}`} role="tabpanel" aria-labelledby={`pf-tab-${tab}`} className="pf-panel">
                {tab === 'suggestions' && (list.length
                  ? list.map((s) => <SuggestionCard key={s.id} s={s} rv={rv} pick={pickOf(picks, s)} editable={editable} blocking={sum.blockerId === s.id} onPick={(p, now) => onPick(s.id, p, now)} />)
                  : <p className="pf-line muted">{rv.run.state === 'suggesting' ? 'Suggestions show here when Claude is done.' : 'No suggestions in this run.'}</p>)}
                {tab === 'changes' && (
                  rv.run.state === 'copy' ? <CopyPack rv={rv} items={used} /> : <>
                    {rv.run.publishBefore && rv.run.state !== 'editing' && <p className="pf-line small muted">{rv.run.publishBefore}</p>}
                    <EditRows edits={edits} />
                    {copyEdits.length > 0 && <><h3 className="pf-sub">Copy and paste</h3><CopyPack rv={rv} items={copyEdits} /></>}
                  </>
                )}
                {tab === 'site' && (
                  <ul className="pf-site">
                    {SITE_PAGES.map((p) => <li key={p.path}><a className="link" href={siteUrl(site, p.path)} target="_blank" rel="noreferrer">{p.title}</a> <span className="muted small">{p.path}</span></li>)}
                  </ul>
                )}
              </div>
            </>
          )}
          {view && view.runs.length > 0 && (
            <section className="pf-runs" aria-labelledby={`${titleId}-runs`}>
              <h2 id={`${titleId}-runs`} className="pf-sub">Runs</h2>
              <ul>
                {view.runs.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <button type="button" className={`pf-run${r.id === id ? ' current' : ''}`} aria-current={r.id === id ? 'true' : undefined} onClick={() => openRun(r)}>
                      <RunMark state={r.state} />{runTitle(r)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {setup && <SetupDialog initial={config} onClose={() => setSetup(false)} onView={setView} onDone={(v) => { setView(v); setSetup(false); }} />}
      {confirmUndo && <UndoDialog onClose={() => setConfirmUndo(false)} onUndo={() => { setConfirmUndo(false); void act('undo'); }} />}
    </div>
  );
}

// ---------- Runs, shared with the sidebar ----------

export const runTitle = (r: Run) => `${shortDate(r.startedAt)} · ${RUN_LABEL[r.state]}`;

/** Shape plus label: spinner running, ring waiting on her, filled done, cross failed. */
export function RunMark({ state }: { state: RunState }) {
  const shape = runShape(state);
  if (shape === 'running') return <span className="ni-spin pf-mark" aria-hidden="true" />;
  if (shape === 'failed') return <span className="pf-mark failed" aria-hidden="true"><Icon name="close" small /></span>;
  return <span className={`pf-shape circle pf-mark${shape === 'done' ? ' filled' : ''}`} aria-hidden="true" />;
}

function UndoDialog({ onClose, onUndo }: { onClose: () => void; onUndo: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(true, box, onClose);
  return (
    <div className="overlay dialog-overlay" onClick={onClose}>
      <div ref={box} className="dialog project-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <div className="project-dialog-head">
          <h2 id={id}>Undo all edits?</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="project-dialog-body">
          <p className="project-dialog-note">Claude puts the old text back on each page it changed in this run. Text you changed since stays as you left it. Nothing is published.</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" data-autofocus onClick={onUndo}>Undo all</button>
          </div>
        </div>
      </div>
    </div>
  );
}

