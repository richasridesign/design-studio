import { useEffect, useMemo, useRef, useState } from 'react';
import { getJson, getState, postJson, send, steer, useStore } from '../store';
import { getOutline, useOutlineVersion, type Outline } from '../outline';
import { useThumbs } from '../useThumbs';
import { attachFigma } from './Files';
import { DecisionLog } from './DecisionLog';
import { WARN_WORDS, draftPrompt, filled, fills, matchDecisions, mergeDecisions, parseDecisions, slots, stickyPrompt, wordCount, type Decision, type DecisionDoc, type Screen } from '../../../shared/decisions';
import '../decisions.css';

type Frame = Outline['pages'][number]['frames'][number];

const LOCAL = (key: string) => `designstudio.decisions.${key}`;
const readLocal = (key: string): DecisionDoc => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL(key)) ?? '{}') ?? {};
  } catch {
    return {};
  }
};
const writeLocal = (key: string, doc: DecisionDoc) => {
  try {
    localStorage.setItem(LOCAL(key), JSON.stringify(doc));
  } catch {}
};
const isDoc = (v: unknown): v is DecisionDoc => !!v && typeof v === 'object' && !Array.isArray(v);

function ask(text: string) {
  if (getState().session.running) steer(text);
  else send({ type: 'prompt', text });
}

// The newest finished Claude reply that holds "Decision N · <screen>" entries.
function useDraft(screens: Screen[]) {
  const events = useStore((s) => s.events);
  return useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind !== 'assistant' || e.streaming || !/decision\s+[12]\s*[·•:\-–]/i.test(e.text)) continue;
      const parsed = parseDecisions(e.text);
      if (!parsed.length) continue;
      const { matched, unmatched } = matchDecisions(parsed, screens);
      return { id: e.id, matched, unmatched };
    }
    return null;
  }, [events, screens]);
}

export function Decisions() {
  const figma = useStore((s) => s.session.figma);
  const key = figma?.key;
  const v = useOutlineVersion();
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState('');
  const [doc, setDoc] = useState<DecisionDoc>({});
  const [local, setLocal] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<DecisionDoc | null>(null);

  useEffect(() => {
    setOutline(null);
    setError('');
    if (!key) return;
    let live = true;
    getOutline(key).then((o) => live && setOutline(o), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [key, v]);

  useEffect(() => {
    setDoc({});
    setLocal(false);
    setApplied(null);
    setAsked(false);
    if (!key) return;
    let live = true;
    getJson<unknown>(`/api/decisions?key=${encodeURIComponent(key)}`)
      .then((d) => {
        if (!isDoc(d)) throw new Error('missing');
        const saved = readLocal(key);
        if (live) setDoc(Object.keys(d).length ? d : saved);
      })
      .catch(() => {
        if (!live) return;
        setLocal(true);
        setDoc(readLocal(key));
      });
    return () => { live = false; };
  }, [key]);

  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || !key) return;
    writeLocal(key, next);
    if (!local) postJson<unknown>(`/api/decisions?key=${encodeURIComponent(key)}`, next).then((r) => { if (!isDoc(r)) setLocal(true); }, () => setLocal(true));
  };
  useEffect(() => flush, [key]);

  const update = (next: DecisionDoc) => {
    setDoc(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  const pages = useMemo(() => (outline?.pages ?? []).filter((p) => p.frames.length), [outline]);
  const screens = useMemo<Screen[]>(() => pages.flatMap((p) => p.frames.map((f) => ({ id: f.id, name: f.name }))), [pages]);
  // Thumbnails load as rows come near the view, so a file with many frames does not render them all at once.
  const page = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const root = page.current;
    if (!root || !screens.length) return;
    const io = new IntersectionObserver((entries) => {
      const ids = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.frame ?? '');
      if (ids.length) setSeen((had) => (ids.every((id) => had.has(id)) ? had : new Set([...had, ...ids])));
    }, { root, rootMargin: '400px 0px' });
    root.querySelectorAll('[data-frame]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [screens, key]);
  const want = useMemo(() => screens.filter((s) => seen.has(s.id)).map((s): [string, number] => [s.id, 0]), [screens, seen]);
  const thumb = useThumbs(key, want);
  const draft = useDraft(screens);

  if (!figma || !key) {
    return (
      <div className="dec-page">
        <div className="dec-title">
          <h2>Decisions</h2>
          <p>What was chosen, over what, and why.</p>
        </div>
        <DecisionLog />
        <p className="dec-empty">Screen decisions belong to a Figma file. <button className="link" onClick={attachFigma}>Attach a Figma file</button></p>
      </div>
    );
  }

  const edit = (f: Frame, i: 0 | 1, field: keyof Decision, value: string) => {
    const pair = slots(doc, f.id).map((d) => ({ ...d })) as [Decision, Decision];
    pair[i][field] = value;
    update({ ...doc, [f.id]: { name: f.name, items: pair } });
  };
  const applyDraft = () => {
    if (!draft) return;
    const names = Object.fromEntries(screens.map((s) => [s.id, s.name]));
    update(mergeDecisions(doc, draft.matched, names));
    setApplied(draft.id);
  };
  const fresh = draft ? new Set(draft.matched.filter((e) => Object.values(fills(doc, e)).some(Boolean)).map((e) => e.id)).size : 0;
  const showDraft = draft && draft.id !== applied && fresh > 0;

  return (
    <div className="dec-page" ref={page} onBlur={flush}>
      <div className="dec-head">
        <div className="dec-title">
          <h2>Decisions</h2>
          <p>The two most important product decisions per screen, and why.</p>
        </div>
        <button className="primary" disabled={!screens.length} onClick={() => { ask(draftPrompt(key, screens, doc)); setAsked(true); }}>Draft with Claude</button>
      </div>

      {showDraft ? (
        <p className="dec-line" role="status">
          <span>Claude's draft is ready: {fresh} {fresh === 1 ? 'screen' : 'screens'}{draft.unmatched.length > 0 && `, ${draft.unmatched.length} not matched (${draft.unmatched.join(', ')})`}.</span>
          <button className="link" onClick={applyDraft}>Apply draft</button>
        </p>
      ) : asked && draft?.id !== applied ? (
        <p className="dec-line" role="status">Claude is drafting in the chat. The draft shows up here when the reply is in.</p>
      ) : null}
      {local && <p className="dec-line">Saved in this browser only. Restart Design Studio to save decisions with the file.</p>}

      <DecisionLog />

      {error && <p className="dec-line" role="alert">Could not load the screens: {error}</p>}
      {!outline && !error && (
        <ul className="dec-list" aria-busy="true" aria-label="Loading screens">
          {[0, 1, 2].map((i) => <li key={i} className="dec-row dec-skel" />)}
        </ul>
      )}
      {outline && !pages.length && <p className="dec-empty">This file has no frames yet. Decisions show up here once it has screens.</p>}

      {pages.map((p) => (
        <section key={p.id} className="dec-group" aria-label={p.name}>
          <h3>{p.name} <span className="dec-count">{p.frames.length} {p.frames.length === 1 ? 'screen' : 'screens'}</span></h3>
          <ul className="dec-list">
            {p.frames.map((f) => {
              const pair = slots(doc, f.id);
              const url = thumb(f.id);
              return (
                <li key={f.id} className="dec-row" data-frame={f.id}>
                  <div className="dec-frame">
                    <div className="dec-thumb">{url ? <img src={url} alt="" /> : <span aria-hidden="true" />}</div>
                    <span className="dec-name" title={f.name}>{f.name}</span>
                    <button className="link" disabled={!pair.some(filled)} title={pair.some(filled) ? 'Ask Claude to place both Decision stickies under this frame' : 'Write a decision first'} onClick={() => ask(stickyPrompt(key, { id: f.id, name: f.name }, pair))}>Add to Figma</button>
                  </div>
                  <div className="dec-slots">
                    {pair.map((d, i) => <Slot key={i} id={`${f.id}-${i}`} n={i + 1} screen={f.name} value={d} onChange={(field, value) => edit(f, i as 0 | 1, field, value)} />)}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Slot({ id, n, screen, value, onChange }: { id: string; n: number; screen: string; value: Decision; onChange: (field: keyof Decision, value: string) => void }) {
  const words = wordCount(value.decision, value.why);
  const long = words > WARN_WORDS;
  const dId = `dec-${id}-d`, wId = `dec-${id}-w`, cId = `dec-${id}-c`;
  return (
    <div className="dec-slot">
      <label htmlFor={dId}>Decision {n}</label>
      <textarea id={dId} className="dec-decision" rows={1} value={value.decision} aria-label={`Decision ${n}, ${screen}`} aria-describedby={cId} onChange={(e) => onChange('decision', e.target.value)} />
      <label htmlFor={wId}>Why</label>
      <textarea id={wId} className="dec-why" rows={1} value={value.why} aria-label={`Why, decision ${n}, ${screen}`} aria-describedby={cId} onChange={(e) => onChange('why', e.target.value)} />
      <span id={cId} className={`dec-words ${long ? 'long' : ''}`}>{words === 0 ? 'About 25 words for both lines' : `${words} ${words === 1 ? 'word' : 'words'}${long ? ', aim for about 25' : ''}`}</span>
    </div>
  );
}
