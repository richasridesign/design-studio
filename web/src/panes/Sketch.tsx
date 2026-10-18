import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { getJson, postJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, SketchArt } from './Empty';
import { insertPrompt } from './Files';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { REASON_MAX, type SketchDoc, type SketchScreen } from '../../../shared/design';

const SketchCanvas = lazy(() => import('./SketchCanvas'));

export function Sketch() {
  const chat = useStore((s) => s.session.id);
  const phase = useStore((s) => s.session.flow.phase);
  const running = useStore((s) => s.session.running);
  const rev = useRev('sketch.json');
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [board, setBoard] = useState<any[] | null>(null);
  const [error, setError] = useState('');

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
        {doc?.screens.map((s) => (
          <div key={s.id} className="sketch-screen">
            <span className="screen-name">{s.name}</span>
            {s.directions.map((d, i) => (
              <button key={d.id} className={`dir ${s.chosen === d.id ? 'chosen' : ''}`} aria-pressed={s.chosen === d.id} aria-describedby={!s.chosen || s.chosen === d.id ? `dir-${s.id}-${d.id}` : undefined} onClick={(e) => choose(s, d, e.currentTarget)}>
                {s.chosen === d.id && <Icon name="check" small />}
                {String.fromCharCode(65 + i)} · {d.name}
              </button>
            ))}
            {s.chosen && s.chosenBy === 'designer' && <span className="muted small">Picked by you</span>}
            {/* Each direction's reasoning, readable without hover. Once picked, only the chosen one stays. */}
            <ul className="sketch-notes">
              {s.directions.map((d, i) => (!s.chosen || s.chosen === d.id) && (
                <li key={d.id} id={`dir-${s.id}-${d.id}`}><b>{String.fromCharCode(65 + i)}:</b> {d.rationale}</li>
              ))}
            </ul>
            {s.chosen && s.chosenBy !== 'designer' && (
              <span className="muted small sketch-sub">
                Picked by Claude
                <button className="link" title="Keep Claude's pick and its reason" onClick={() => pick(s.id, s.chosen!, s.directions.find((d) => d.id === s.chosen)?.rationale.slice(0, REASON_MAX) ?? '')}>Confirm</button>
              </span>
            )}
            {s.chosen && s.chosenBy === 'designer' && <Why screen={s} onSave={(reason) => pick(s.id, s.chosen!, reason)} />}
          </div>
        ))}
      </div>
      {ask && <Confirm {...ask} onClose={() => { setAsk(null); requestAnimationFrame(() => trigger.current?.focus()); }} />}
      {!doc && !error && <Empty art={<SketchArt />} title="No sketches yet" text="Claude sketches two or three low-fidelity directions per screen before it designs. You can draw and leave notes on them." action={{ label: 'Sketch with Claude', onClick: () => insertPrompt('/sketch') }} />}
      {(doc || error) && <div className="sketch-canvas">
        {board && (
          <Suspense fallback={<div className="hint">Loading the canvas…</div>}>
            <SketchCanvas key={chat} doc={doc} board={board} onBoard={(els) => postJson('/api/sketch/board', { elements: els }).catch(() => {})} />
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
  useEffect(() => setValue(saved), [saved, screen.chosen]);
  const save = () => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next !== saved) onSave(next);
  };
  const id = `why-${screen.id}`;
  return (
    <span className="sketch-sub sketch-why">
      <label htmlFor={id}>Why</label>
      <input id={id} type="text" value={value} maxLength={REASON_MAX} placeholder="Optional, one line" aria-label={`Why this direction for ${screen.name}`} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setValue(saved); }} />
    </span>
  );
}
