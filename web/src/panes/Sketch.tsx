import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { getJson, postJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, SketchArt } from './Empty';
import { insertPrompt } from './Files';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { REASON_MAX, type SketchDoc, type SketchScreen } from '../../../shared/design';
import { dirKey } from './sketchLayout';
import { useNarrow } from '../touch';

const SketchCanvas = lazy(() => import('./SketchCanvas'));
type CanvasFocus = { dir: string; n: number };
const letter = (i: number) => String.fromCharCode(65 + i);
const startDir = (s: SketchScreen, shown: Record<string, string>) => dirKey(s.id, shown[s.id] ?? s.chosen ?? s.directions[0]?.id ?? '');


export function Sketch() {
  const chat = useStore((s) => s.session.id);
  const phase = useStore((s) => s.session.flow.phase);
  const running = useStore((s) => s.session.running);
  const rev = useRev('sketch.json');
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [board, setBoard] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const narrow = useNarrow();
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  // On a phone, the direction each screen shows. Starts on the picked one, else A.
  const [shown, setShown] = useState<Record<string, string>>({});
  const view = (screen: string, direction: string) => setFocus((f) => ({ dir: dirKey(screen, direction), n: (f?.n ?? 0) + 1 }));

  useEffect(() => {
    setBoard(null);
    getJson<any[]>('/api/sketch/board').then(setBoard).catch(() => setBoard([]));
  }, [chat]);

  useEffect(() => {
    getJson<SketchDoc | { error: string } | null>('/api/sketch')
      .then((d) => {
        if (d && 'error' in d) { setError(d.error); return; }
        setError('');
        setDoc(d);
      })
      .catch((e) => setError(e.message));
  }, [chat, rev]);

  // A reason only comes with a confirm or an edit of the Why field; picking another direction clears it.
  const pick = (screen: string, direction: string, reason?: string) => {
    send({ type: 'flow_pick', screen, direction, reason });
    setDoc((d) => d && { screens: d.screens.map((s) => {
      if (s.id !== screen) return s;
      const same = s.chosen === direction;
      const next = reason ?? (same ? s.reason : undefined);
      return { ...s, chosen: direction, chosenBy: 'designer', reason: next || undefined, rejected: s.directions.filter((x) => x.id !== direction).map((x) => x.name), at: same && s.chosenBy === 'designer' && s.at ? s.at : Date.now() };
    }) });
  };
  const allPicked = doc?.screens.every((s) => s.chosen);
  const picked = doc?.screens.filter((s) => s.chosen).length ?? 0;
  // Changing a pick that has a written reason asks first, because the reason was for the old direction.
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const choose = (s: SketchScreen, d: SketchScreen['directions'][number], el: HTMLElement) => {
    if (s.chosen === d.id) return;
    const old = s.directions.find((x) => x.id === s.chosen);
    if (!(s.chosenBy === 'designer' && s.reason && old)) return pick(s.id, d.id);
    trigger.current = el;
    setAsk({
      title: `Switch ${s.name} to ${d.name}?`,
      detail: `Your reason was for ${old.name}: "${s.reason}". Switching clears it.`,
      action: 'Switch',
      safe: true,
      icon: 'question',
      run: async () => pick(s.id, d.id),
    });
  };

  return (
    <div className="sketch-page">
      <div className="sketch-head">
        {phase === 'pick' && (
          <div className="banner">
            <Icon name="lightbulb" small />
            <span>Pick a direction for each screen. Draw or write notes on the canvas; Claude reads your notes before it designs.</span>
            <button className="primary" disabled={!allPicked || running} onClick={() => send({ type: 'flow_continue' })}>Continue to design</button>
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        {!!doc?.screens.length && <p className="sketch-count muted small" role="status">Picked: {picked} of {doc.screens.length}</p>}
        {doc?.screens.map((s) => {
          const at = shown[s.id] ?? s.chosen ?? s.directions[0]?.id;
          const i = s.directions.findIndex((d) => d.id === at);
          const cur = s.directions[i];
          return (
          <div key={s.id} className="sketch-screen">
            <span className="screen-name" id={`sk-${s.id}`}>{s.name}</span>
            {narrow ? (
              <>
                {/* One direction at a time: a tab shows it on the canvas, Pick is its own button. */}
                <div className="seg sketch-tabs" role="tablist" aria-labelledby={`sk-${s.id}`}>
                  {s.directions.map((d, j) => (
                    <button key={d.id} role="tab" aria-selected={d.id === at} aria-controls={`skp-${s.id}`} aria-label={`${letter(j)} · ${d.name}${s.chosen === d.id ? ', picked' : ''}`} className={d.id === at ? 'on' : ''} onClick={() => { setShown((x) => ({ ...x, [s.id]: d.id })); view(s.id, d.id); }}>
                      {s.chosen === d.id && <Icon name="check" small />}{letter(j)}
                    </button>
                  ))}
                </div>
                {cur && (
                  <div className="sketch-panel" role="tabpanel" id={`skp-${s.id}`}>
                    <p className="sketch-dir"><b>{letter(i)} · {cur.name}:</b> {cur.rationale}</p>
                    {s.chosen !== cur.id
                      ? <button onClick={(e) => choose(s, cur, e.currentTarget)}>Pick {letter(i)}</button>
                      : s.chosenBy === 'designer' && <span className="muted small sketch-picked"><Icon name="check" small /> Picked by you</span>}
                  </div>
                )}
              </>
            ) : (
              <>
                {s.directions.map((d, j) => (
                  <span key={d.id} className="dir-group">
                    <button className={`dir ${s.chosen === d.id ? 'chosen' : ''}`} aria-pressed={s.chosen === d.id} aria-describedby={!s.chosen || s.chosen === d.id ? `dir-${s.id}-${d.id}` : undefined} onClick={(e) => choose(s, d, e.currentTarget)}>
                      {s.chosen === d.id && <Icon name="check" small />}
                      {letter(j)} · {d.name}
                    </button>
                    <button className="link dir-view" aria-label={`View ${letter(j)} · ${d.name} on the canvas`} onClick={() => view(s.id, d.id)}>View</button>
                  </span>
                ))}
                {s.chosen && s.chosenBy === 'designer' && <span className="muted small">Picked by you</span>}
                {/* Each direction's reasoning, readable without hover. Once picked, only the chosen one stays. */}
                <ul className="sketch-notes">
                  {s.directions.map((d, j) => (!s.chosen || s.chosen === d.id) && (
                    <li key={d.id} id={`dir-${s.id}-${d.id}`}><b>{letter(j)}:</b> {d.rationale}</li>
                  ))}
                </ul>
              </>
            )}
            {s.chosen && s.chosenBy !== 'designer' && (
              <span className="muted small sketch-sub">
                Picked by Claude
                <button className="link" title="Keep Claude's pick and its reason" onClick={() => pick(s.id, s.chosen!, s.directions.find((d) => d.id === s.chosen)?.rationale.slice(0, REASON_MAX) ?? '')}>Confirm</button>
              </span>
            )}
            {s.chosen && s.chosenBy === 'designer' && (!narrow || at === s.chosen) && <Why screen={s} onSave={(reason) => pick(s.id, s.chosen!, reason)} />}
          </div>
          );
        })}
      </div>
      {ask && <Confirm {...ask} onClose={() => { setAsk(null); requestAnimationFrame(() => trigger.current?.focus()); }} />}
      {!doc && !error && <Empty art={<SketchArt />} title="No sketches yet" text="Claude sketches two or three low-fidelity directions per screen before it designs. You can draw and leave notes on them." action={{ label: 'Sketch with Claude', onClick: () => insertPrompt('/sketch') }} />}
      {(doc || error) && <div className="sketch-canvas">
        {board && (
          <Suspense fallback={<div className="hint">Loading the canvas…</div>}>
            <SketchCanvas key={chat} doc={doc} board={board} focus={focus} start={narrow && doc?.screens[0] ? startDir(doc.screens[0], shown) : undefined} onBoard={(els) => postJson('/api/sketch/board', { elements: els }).catch(() => {})} />
          </Suspense>
        )}
      </div>}
    </div>
  );
}

/** One optional line on why this direction won. Saves on Enter or when the field loses focus. */
function Why({ screen, onSave }: { screen: SketchScreen; onSave: (reason: string) => void }) {
  const saved = screen.reason ?? '';
  const [value, setValue] = useState(saved);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setValue(saved), [saved, screen.chosen]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = () => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next === saved) return;
    onSave(next);
    setNote('Saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), 2000);
  };
  const id = `why-${screen.id}`;
  return (
    <span className="sketch-sub sketch-why">
      <label htmlFor={id}>Why</label>
      <input id={id} type="text" value={value} maxLength={REASON_MAX} placeholder="Optional, one line" aria-label={`Why this direction for ${screen.name}`} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setValue(saved); }} />
      {/* Always in the page, so screen readers announce the change of text. */}
      <span className="sketch-saved muted small" role="status">{note && <><Icon name="check" small /> {note}</>}</span>
    </span>
  );
}
