import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson, postJson } from '../../../store';
import { nextStep, placeAfter, renumber, SIZES, tidy, type Board as BoardData, type CanvasChanges, type Frame, type Link, type Manifest } from '../../../../../shared/canvas';
import { ChangesPanel } from '../panels/ChangesPanel';
import { ElementPanel, type Layer, type Picked } from '../panels/ElementPanel';
import { FramePanel } from '../panels/FramePanel';
import { LinkPanel } from '../panels/LinkPanel';
import { arrows } from './arrows';
import { Toolbar, type Mode } from './Toolbar';
import { useFrames, withScenario } from './useFrames';
import { bounds, drag, useView, type View } from './useView';

// The board: frames on a plane that pans and zooms. In Select and Hand modes a shield covers every frame, so the
// board gets every wheel, pinch and drag; a click on the shield asks the frame which element sits under that point.

const GAP = 80;
const rid = () => Math.random().toString(36).slice(2, 10);

/** The flow board's flow and iteration; a frozen iteration's board is read only, like her frozen Figma versions. */
export type FlowRef = { n: number; name: string; iteration: string; frozen: boolean };

export function Board({ url, board, setBoard, flow }: { url: string; board: BoardData; setBoard: (b: BoardData) => void; flow: FlowRef | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const { view, setView, size, show, zoomBy, zoomTo, centre } = useView(stage);
  const fr = useFrames(url);
  const [mode, setMode] = useState<Mode>('select');
  const [selFrame, setSelFrame] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [saveError, setSaveError] = useState('');
  const [showChanges, setShowChanges] = useState(false);
  const [changes, setChanges] = useState<CanvasChanges | null>(null);
  const [toast, setToast] = useState('');
  // "All states": one screen laid out in every scenario for a consistency sweep. Nothing is saved; Esc goes back.
  const [states, setStates] = useState<{ of: string; view: View } | null>(null);
  // Recording a flow (flow boards only): a click that reaches another screen adds it as the next step, with an arrow.
  const [rec, setRec] = useState(false);
  const recRef = useRef(rec);
  recRef.current = rec;
  const [selLink, setSelLink] = useState<string | null>(null);
  const inPlace = useRef(0);
  // After a click led to a screen already on the board: the arrow went there, and she can make it a new step instead.
  const [linked, setLinked] = useState<{ text: string; from: string; route: string; label: string; link: string } | null>(null);
  useEffect(() => { if (!linked) return; const t = setTimeout(() => setLinked(null), 8000); return () => clearTimeout(t); }, [linked]);

  useEffect(() => { getJson<Manifest>('/api/canvas/manifest').then(setManifest, () => setManifest({ screens: [], scenarios: [] })); }, [url]);

  const loadChanges = useCallback(() => getJson<CanvasChanges>('/api/canvas/changes').then(setChanges, () => undefined), []);
  useEffect(() => { void loadChanges(); }, [loadChanges]);
  const undo = useCallback(async () => {
    try {
      const r = await postJson<{ label: string }>('/api/canvas/undo', {});
      setToast(`Undone: ${r.label}`);
    } catch (e) {
      setToast((e as Error).message);
    }
    void loadChanges();
  }, [loadChanges]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  // Saves shortly after the last change.
  const saveTimer = useRef<number>(0);
  const frozen = !!flow?.frozen;
  const update = useCallback((next: BoardData) => {
    if (frozen) { setToast(`${flow?.iteration} is frozen, so its board is read only`); return; }
    setBoard(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => postJson('/api/canvas/board', next).then(() => setSaveError(''), (e) => setSaveError(e.message)), 400);
  }, [setBoard, frozen, flow?.iteration]);
  // A board left for another chat's must not save into that chat's board.
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const shown = useMemo(() => {
    const f = states && board.frames.find((x) => x.id === states.of);
    if (!f || !manifest?.scenarios.length) return board.frames;
    const cols = Math.ceil(Math.sqrt(manifest.scenarios.length));
    return manifest.scenarios.map((sc, i): Frame => ({ ...f, id: `${f.id}~${sc.id}`, name: sc.name, scenario: sc.id, x: (i % cols) * (f.w + GAP), y: Math.floor(i / cols) * (f.h + GAP * 3) }));
  }, [states, board.frames, manifest]);

  const fit = useCallback(() => { if (shown.length) show(bounds(shown)); }, [shown, show]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && size.w && board.frames.length) { fitted.current = true; fit(); } }, [size.w, board.frames.length, fit]);

  // Tell every frame the mode.
  useEffect(() => { fr.tellAll({ type: 'mode', mode }); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const boardRef = useRef(board);
  boardRef.current = board;

  /** A new step for the screen a click reached, placed after the frame it came from and joined by an arrow. */
  const addStep = useCallback((b: BoardData, from: Frame, route: string, label: string, dropLink?: string) => {
    const screen = manifest?.screens.find((s) => s.route === route.split('?')[0]);
    const f: Frame = { id: rid(), name: screen?.name ?? route, route, scenario: from.scenario, ...placeAfter(b.frames, from, GAP * 3), w: from.w, h: from.h, n: nextStep(b.frames), ...(from.group ? { group: from.group } : {}) };
    update({ ...b, frames: [...b.frames, f], links: [...b.links.filter((l) => l.id !== dropLink), { id: rid(), from: from.id, to: f.id, label }] });
    setSelFrame(f.id);
    // Keep the zoom, and bring the new step to the middle so she can go on clicking in it.
    centre(f);
  }, [manifest, update, centre]);

  // The frame clicked in goes back to its screen; the screen it reached is the next step, or an arrow to the frame
  // already showing it (same path and state), which she can turn into a new step (the same screen later in the flow).
  const record = useCallback((from: Frame, route: string, via: string | null) => {
    fr.tellFrame(from.id, { type: 'restore', path: withScenario(from.route, from.scenario) });
    const b = boardRef.current;
    const label = via ? `Click ${via}` : 'Click';
    const there = b.frames.find((x) => x.id !== from.id && x.route === route && x.scenario === from.scenario && !x.clicks?.length);
    if (!there) { addStep(b, from, route, label); return; }
    const had = b.links.find((l) => l.from === from.id && l.to === there.id);
    const link = had ?? { id: rid(), from: from.id, to: there.id, label };
    if (!had) update({ ...b, links: [...b.links, link] });
    setLinked({ text: `Arrow to ${there.n ? `step ${there.n}, ` : ''}${there.name}`, from: from.id, route, label, link: link.id });
  }, [addStep, update, fr]);

  const followNav = useCallback((id: string, path: string, via: string | null) => {
    const u = new URL(path, 'http://app');
    u.searchParams.delete('scenario');
    const route = u.pathname + u.search;
    const b = boardRef.current;
    const f = b.frames.find((x) => x.id === id);
    if (!f || f.route === route) return;
    if (recRef.current) { record(f, route, via); return; }
    const named = manifest?.screens.find((s) => s.route === f.route)?.name === f.name;
    fr.moved(id, route);
    update({ ...b, frames: b.frames.map((x) => (x.id === id ? { ...x, route, name: named ? manifest?.screens.find((s) => s.route === route)?.name ?? x.name : x.name } : x)) });
  }, [manifest, update, record, fr]);

  const toggleRec = useCallback(() => {
    if (!flow) { setToast('Recording is for a flow: open one of the flow\'s chats'); return; }
    if (flow.frozen) { setToast(`${flow.iteration} is frozen, so its board is read only`); return; }
    setRec((r) => !r);
    setMode(rec ? 'select' : 'interact');
  }, [flow, rec]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== fr.origin || !e.data?.ds) return;
      const id = fr.idOf(e.source);
      if (!id) return;
      if (e.data.type === 'ready') {
        fr.tell(e.source as Window, { type: 'mode', mode });
        if (picked?.frame === id) fr.tell(e.source as Window, { type: 'select', src: picked.src });
        const f = boardRef.current.frames.find((x) => x.id === id.split('~')[0]);
        if (f) fr.replay({ ...f, id });
      }
      if (e.data.type === 'replayed') fr.replayFailed(id, typeof e.data.failed === 'string' ? e.data.failed : null);
      if (e.data.type === 'select') {
        const el = e.data.element as { src: string; tag: string; layers?: Layer[] } | null;
        setSelFrame(id);
        fr.tellAll({ type: 'select', src: null }, id);
        setPicked(el?.src ? { frame: id, src: el.src, tag: el.tag, layers: el.layers ?? [] } : null);
        if (el?.src) setShowChanges(false);
      }
      // While recording, a click that changes no screen (a dialog, a menu) is said out loud, so a missing step is no surprise.
      if (e.data.type === 'clicked' && rec) {
        clearTimeout(inPlace.current);
        const label = String(e.data.label).slice(0, 60);
        inPlace.current = window.setTimeout(() => setToast(`"${label}" stayed on this screen, so it is not a new step`), 900);
      }
      if (e.data.type === 'nav') clearTimeout(inPlace.current);
      if (e.data.type === 'nav' && typeof e.data.path === 'string') followNav(id, e.data.path, typeof e.data.via === 'string' ? e.data.via : null);
      if (e.data.type === 'key') {
        const k = String(e.data.key).toLowerCase();
        if (k === 'escape') { if (rec) setRec(false); if (mode === 'interact') setMode('select'); else setPicked(null); }
        else if (k === 'r') toggleRec();
        else if (k === 'v') setMode('select');
        else if (k === 'h') setMode('hand');
        else if (k === 'i') setMode('interact');
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [fr, mode, picked, followNav, rec, toggleRec]);

  const clearPick = useCallback(() => { setPicked(null); fr.tellAll({ type: 'select', src: null }); }, [fr]);

  const toggleStates = useCallback(() => {
    setPicked(null);
    if (states) {
      fitOnSwitch.current = false;
      setView(states.view);
      setSelFrame(states.of);
      setStates(null);
      return;
    }
    const of = selFrame?.split('~')[0] ?? picked?.frame;
    if (!of || !board.frames.some((f) => f.id === of)) { setToast('Select a frame first, then show all its states'); return; }
    setStates({ of, view });
    setSelFrame(null);
  }, [states, selFrame, picked, board.frames, view, setView]);
  // Fit whenever the view switches between the board and all states.
  const fitOnSwitch = useRef(false);
  useEffect(() => { if (fitOnSwitch.current) fit(); fitOnSwitch.current = true; }, [states?.of]); // eslint-disable-line react-hooks/exhaustive-deps

  const tidyUp = useCallback(() => { update({ ...board, frames: tidy(board.frames) }); fitted.current = false; }, [board, update]);

  // Keyboard: V select, H hand, I interact, Shift+1 fit, Shift+2 the selected frame, Shift+0 100%, + and - zoom,
  // Ctrl+Alt+T tidy, Escape clears.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (!stage.current?.closest('.editor.shown')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyT') { e.preventDefault(); if (!states) tidyUp(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setMode('select');
      else if (k === 'h') setMode('hand');
      else if (k === 'i') setMode('interact');
      else if (e.shiftKey && e.code === 'Digit1') fit();
      else if (e.shiftKey && e.code === 'Digit2') { const f = shown.find((x) => x.id === selFrame); if (f) show(f); }
      else if (k === 's' && !e.shiftKey) toggleStates();
      else if (k === 'r' && !e.shiftKey) toggleRec();
      else if (e.shiftKey && e.code === 'Digit0') zoomTo(1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(0.8);
      else if (e.key === 'Escape') { if (rec) { setRec(false); setMode('select'); } else if (mode === 'interact') setMode('select'); else if (states) toggleStates(); else { clearPick(); setSelFrame(null); } }
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [fit, clearPick, show, zoomBy, zoomTo, shown, selFrame, undo, mode, states, toggleStates, rec, toggleRec, tidyUp]);

  const panStart = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    const onEmpty = t === e.currentTarget || t.classList.contains('cv-plane');
    // Hand mode, the middle button or dragging on empty board all pan.
    if (!(mode === 'hand' || onEmpty) && e.button !== 1) return;
    if (onEmpty && mode !== 'hand') { setSelFrame(null); setSelLink(null); clearPick(); }
    const start = view;
    drag(e, (dx, dy) => setView({ ...start, x: start.x + dx, y: start.y + dy }));
  };

  const moveFrame = (e: React.PointerEvent, f: Frame) => {
    setSelFrame(f.id);
    if (frozen) return;
    const start = { x: f.x, y: f.y };
    let last = board;
    drag(e, (dx, dy) => {
      last = { ...board, frames: board.frames.map((x) => (x.id === f.id ? { ...x, x: Math.round(start.x + dx / view.zoom), y: Math.round(start.y + dy / view.zoom) } : x)) };
      setBoard(last);
    }, () => update(last));
  };

  /** One frame per screen in the first state, in one row: the board a project starts with. */
  const layOutScreens = useCallback(() => {
    if (!manifest?.screens.length) return;
    const laptop = SIZES[1];
    const scenario = manifest.scenarios[0]?.id ?? 'default';
    update({ ...board, frames: manifest.screens.map((s, i) => ({ id: rid(), name: s.name, route: s.route, scenario, x: i * (laptop.w + GAP), y: 0, w: laptop.w, h: laptop.h })) });
    fitted.current = false;
  }, [manifest, board, update]);
  // The main board starts with every screen; a flow board starts empty and is recorded.
  useEffect(() => { if (manifest && !board.frames.length && !flow) layOutScreens(); }, [manifest]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A flow board's first step, then recording from it. */
  const startFlow = (route: string) => {
    const screen = manifest?.screens.find((s) => s.route === route);
    if (!screen) return;
    const laptop = SIZES[1];
    const f: Frame = { id: rid(), name: screen.name, route, scenario: manifest?.scenarios[0]?.id ?? 'default', x: 0, y: 0, w: laptop.w, h: laptop.h, n: '1' };
    update({ ...board, frames: [f], links: [] });
    fitted.current = false;
    setSelFrame(f.id);
    setRec(true);
    setMode('interact');
  };

  const addFrame = () => {
    const screen = manifest?.screens.find((s) => !board.frames.some((f) => f.route === s.route)) ?? manifest?.screens[0];
    if (!screen) return;
    const right = board.frames.reduce((m, f) => Math.max(m, f.x + f.w + GAP), 0);
    const laptop = SIZES[1];
    const f: Frame = { id: rid(), name: screen.name, route: screen.route, scenario: manifest?.scenarios[0]?.id ?? 'default', x: right, y: 0, w: laptop.w, h: laptop.h, ...(flow ? { n: nextStep(board.frames) } : {}) };
    update({ ...board, frames: [...board.frames, f] });
    setSelFrame(f.id);
  };

  const setFrame = (id: string, patch: Partial<Frame>) => update({ ...board, frames: board.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  // Steps close up after a frame goes, so a flow keeps 1, 2, 3 with no gaps; its arrows go with it.
  const removeFrame = (id: string) => { update({ ...board, frames: renumber(board.frames.filter((f) => f.id !== id)), links: board.links.filter((l) => l.from !== id && l.to !== id) }); setSelFrame(null); clearPick(); };
  const setLink = (id: string, patch: Partial<Link>) => update({ ...board, links: board.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLink = (id: string) => { update({ ...board, links: board.links.filter((l) => l.id !== id) }); setSelLink(null); };

  const lines = states ? [] : arrows(board.frames, board.links, view);

  // Only frames in or near view load the app; the rest show their name until they come into view.
  const inView = (f: Frame) => {
    const m = 400;
    const x = f.x * view.zoom + view.x;
    const y = f.y * view.zoom + view.y;
    return x + f.w * view.zoom > -m && y + f.h * view.zoom > -m && x < size.w + m && y < size.h + m;
  };

  // The shield turns a point on a frame into a point in the app, and asks the frame what is there.
  const pointIn = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.zoom, y: (e.clientY - r.top) / view.zoom };
  };
  const hoverAt = useRef(0);
  const shieldMove = (e: React.PointerEvent, f: Frame) => {
    if (mode !== 'select') return;
    const p = pointIn(e);
    cancelAnimationFrame(hoverAt.current);
    hoverAt.current = requestAnimationFrame(() => fr.tellFrame(f.id, { type: 'hover', ...p }));
  };
  const shieldLeave = (f: Frame) => fr.tellFrame(f.id, { type: 'hover', x: -1, y: -1 });
  const shieldClick = (e: React.MouseEvent, f: Frame) => { if (mode === 'select') fr.tellFrame(f.id, { type: 'pick', ...pointIn(e) }); };

  const frame = board.frames.find((f) => f.id === selFrame) ?? null;
  const statesOf = states && board.frames.find((f) => f.id === states.of);

  return (
    <div className="cv">
      <div className="cv-main">
        <div ref={stage} className={`cv-stage mode-${mode}`} onPointerDown={panStart}>
          <div className="cv-plane" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {shown.map((f) => (
              <div key={f.id} className="cv-frame" style={{ left: f.x, top: f.y, width: f.w, height: f.h, boxShadow: `0 0 0 ${(selFrame === f.id ? 2 : 1) / view.zoom}px var(${selFrame === f.id ? '--accent' : '--border'})` }}>
                {mode !== 'interact' && (
                  <div className="cv-shield" onPointerMove={(e) => shieldMove(e, f)} onPointerLeave={() => shieldLeave(f)} onClick={(e) => shieldClick(e, f)} />
                )}
                {inView(f) ? <iframe key={fr.key(f)} ref={fr.ref(f.id)} title={f.name} src={fr.src(f)} width={f.w} height={f.h} />
                  : (fr.unloaded(f.id), <div className="cv-frame-off">{f.name}</div>)}
              </div>
            ))}
          </div>
          <svg className="cv-links" aria-hidden="true">
            <defs><marker id="cv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" /></marker></defs>
            {lines.map(({ l, d }) => <path key={l.id} d={d} className={selLink === l.id ? 'selected' : ''} markerEnd="url(#cv-arrow)" />)}
          </svg>
          <div className="cv-labels">
            {lines.map(({ l, mid }) => (
              <button key={l.id} className={`cv-link-label${selLink === l.id ? ' selected' : ''}`} style={{ left: mid.x, top: mid.y }}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => { setSelLink(l.id); setSelFrame(null); clearPick(); setShowChanges(false); }}>{l.label || 'Click'}</button>
            ))}
            {shown.map((f) => {
              const w = f.w * view.zoom;
              if (w < 48 || !inView(f)) return null;
              return (
                <div key={f.id} className={`cv-frame-head${selFrame === f.id ? ' selected' : ''}`} style={{ left: f.x * view.zoom + view.x, top: f.y * view.zoom + view.y - 20, width: w }}
                  title={`${f.name} · ${manifest?.scenarios.find((s) => s.id === f.scenario)?.name ?? f.scenario}`}
                  onPointerDown={(e) => { e.stopPropagation(); if (states) setSelFrame(f.id); else moveFrame(e, f); }} onDoubleClick={() => show(f)}>
                  {f.n && <span className="cv-frame-step">{f.n}</span>}
                  <span className="cv-frame-name">{f.name}</span>
                  {states ? null : w > 200 && manifest && manifest.scenarios.length > 1 ? (
                    <select className="cv-frame-scenario" aria-label={`State of ${f.name}`} value={f.scenario} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setFrame(f.id, { scenario: e.target.value })}>
                      {manifest.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : w > 160 && <span className="cv-frame-scenario">{manifest?.scenarios.find((s) => s.id === f.scenario)?.name ?? f.scenario}</span>}
                </div>
              );
            })}
          </div>
          {!states && board.frames.map((f) => f.note && f.w * view.zoom > 160 && inView(f) && (
            <p key={f.id} className="cv-frame-note" style={{ left: f.x * view.zoom + view.x, top: (f.y + f.h + 96) * view.zoom + view.y, width: f.w * view.zoom }}>{f.note}</p>
          ))}
          {!board.frames.length && (flow?.frozen ? (
            <div className="cv-hint"><p>{flow.iteration} is frozen and has no recorded flow.</p></div>
          ) : flow ? (
            <div className="cv-hint">
              <p>Record Flow {flow.n}: pick the screen it starts on, then click through the app. Each screen you reach becomes the next step, with an arrow named after the click.</p>
              <select aria-label="First screen" value="" onChange={(e) => startFlow(e.target.value)} disabled={!manifest?.screens.length}>
                <option value="">Start recording on…</option>
                {manifest?.screens.map((s) => <option key={s.route} value={s.route}>{s.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="cv-hint">
              <p>An empty board</p>
              <button className="primary" onClick={addFrame} disabled={!manifest?.screens.length}>Add a frame</button>
            </div>
          ))}
        </div>
        <Toolbar mode={mode} setMode={setMode} zoom={view.zoom} canAdd={!!manifest?.screens.length} addFrame={addFrame} fit={fit}
          tidy={!states && !frozen && board.frames.length > 1 ? tidyUp : null} rec={flow && !frozen ? rec : null} toggleRec={toggleRec}
          states={!!states} toggleStates={toggleStates} changes={changes?.files.length ?? 0} showChanges={showChanges}
          toggleChanges={() => { setShowChanges((v) => !v); void loadChanges(); }} zoomBy={zoomBy} zoomTo={zoomTo} />
        {saveError && <div className="cv-toast" role="alert">Board not saved: {saveError}</div>}
        {toast && !saveError && <div className="cv-toast" role="status">{toast}</div>}
        {linked && !toast && (
          <div className="cv-toast" role="status">{linked.text}
            <button className="ghost" onClick={() => { const b = boardRef.current; const from = b.frames.find((f) => f.id === linked.from); if (from) addStep(b, from, linked.route, linked.label, linked.link); setLinked(null); }}>Make it a new step</button>
          </div>
        )}
        {rec && !linked && !toast && <div className="cv-banner" role="status">Recording Flow {flow?.n}: each new screen is the next step<button className="ghost" onClick={toggleRec}>Stop (R)</button></div>}
        {statesOf && !toast && <div className="cv-banner" role="status">All states of {statesOf.name}<button className="ghost" onClick={toggleStates}>Back to the board</button></div>}
      </div>
      <aside className="cv-inspector" aria-label="Inspector">
        {selLink && board.links.some((l) => l.id === selLink) ? <LinkPanel link={board.links.find((l) => l.id === selLink)!} frames={board.frames} setLink={setLink} remove={removeLink} />
          : showChanges ? <ChangesPanel changes={changes} reload={loadChanges} undo={undo} close={() => setShowChanges(false)} />
          : picked ? <ElementPanel picked={picked} frame={shown.find((f) => f.id === picked.frame) ?? null} onEdited={loadChanges} />
          : statesOf ? <p className="cv-muted">Every state of {statesOf.name}. Pick an element to edit it; a change shows in every state at once. Esc goes back to the board.</p>
          : frame ? <FramePanel frame={frame} manifest={manifest} setFrame={setFrame} remove={removeFrame} />
          : <p className="cv-muted">Pick an element in a frame to edit it, or a frame's name to change its screen, state and size.</p>}
      </aside>
    </div>
  );
}
