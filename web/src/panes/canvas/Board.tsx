import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson, postJson } from '../../store';
import { Icon } from '../../Icon';
import { SIZES, type Board as BoardData, type CanvasChanges, type Frame, type Manifest } from '../../../../shared/canvas';
import { ChangesPanel } from './ChangesPanel';
import { ElementPanel, type Layer, type Picked } from './ElementPanel';
import { FramePanel } from './FramePanel';

// The board: frames on a plane that pans and zooms. In Select and Hand modes a shield covers every frame, so the
// board gets every wheel, pinch and drag; a click on the shield asks the frame which element sits under that point.

type Mode = 'select' | 'hand' | 'interact';
type View = { x: number; y: number; zoom: number };

const GAP = 80;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function Board({ url, board, setBoard }: { url: string; board: BoardData; setBoard: (b: BoardData) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [view, setView] = useState<View>({ x: 40, y: 60, zoom: 0.5 });
  const [mode, setMode] = useState<Mode>('select');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selFrame, setSelFrame] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [saveError, setSaveError] = useState('');
  const [showChanges, setShowChanges] = useState(false);
  const [changes, setChanges] = useState<CanvasChanges | null>(null);
  const [toast, setToast] = useState('');
  const origin = useMemo(() => new URL(url).origin, [url]);

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
  const update = useCallback((next: BoardData) => {
    setBoard(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => postJson('/api/canvas/board', next).then(() => setSaveError(''), (e) => setSaveError(e.message)), 400);
  }, [setBoard]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!board.frames.length || !size.w) return;
    const minX = Math.min(...board.frames.map((f) => f.x));
    const minY = Math.min(...board.frames.map((f) => f.y));
    const maxX = Math.max(...board.frames.map((f) => f.x + f.w));
    const maxY = Math.max(...board.frames.map((f) => f.y + f.h));
    const zoom = clampZoom(Math.min(1, (size.w - 80) / (maxX - minX), (size.h - 120) / (maxY - minY)));
    setView({ zoom, x: (size.w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (size.h - (maxY - minY) * zoom) / 2 - minY * zoom + 12 });
  }, [board.frames, size]);

  /** Zooms by a factor around a point on the stage (the centre when none is given). */
  const zoomBy = useCallback((factor: number, px = size.w / 2, py = size.h / 2) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom };
    });
  }, [size]);
  const zoomTo = useCallback((zoom: number) => zoomBy(zoom / view.zoom), [zoomBy, view.zoom]);

  /** Brings one frame to fill the stage. */
  const focusFrame = useCallback((f: Frame) => {
    const zoom = clampZoom(Math.min(1, (size.w - 80) / f.w, (size.h - 120) / f.h));
    setView({ zoom, x: (size.w - f.w * zoom) / 2 - f.x * zoom, y: (size.h - f.h * zoom) / 2 - f.y * zoom + 12 });
  }, [size]);

  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && size.w && board.frames.length) { fitted.current = true; fit(); } }, [size.w, board.frames.length, fit]);

  // Tell every frame the mode and the picked element.
  const tell = useCallback((win: Window | null | undefined, msg: Record<string, unknown>) => win?.postMessage({ ds: true, ...msg }, origin), [origin]);
  useEffect(() => { for (const f of frames.current.values()) tell(f.contentWindow, { type: 'mode', mode }); }, [mode, tell]);

  // A frame keeps the page its iframe was given while the app navigates inside it, so following a link does not
  // reload the frame; the frame's route follows the app instead. A frame named after its screen takes the new name.
  const loaded = useRef(new Map<string, string>());
  const selfNav = useRef(new Map<string, string>());
  const srcFor = (f: Frame) => {
    const want = `${url}${f.route}${f.route.includes('?') ? '&' : '?'}scenario=${encodeURIComponent(f.scenario)}`;
    const had = loaded.current.get(f.id);
    if (had && selfNav.current.get(f.id) === f.route && had.endsWith(`scenario=${encodeURIComponent(f.scenario)}`)) return had;
    loaded.current.set(f.id, want);
    selfNav.current.delete(f.id);
    return want;
  };
  const boardRef = useRef(board);
  boardRef.current = board;
  const followNav = useCallback((id: string, path: string) => {
    const u = new URL(path, 'http://app');
    u.searchParams.delete('scenario');
    const route = u.pathname + u.search;
    const b = boardRef.current;
    const f = b.frames.find((x) => x.id === id);
    if (!f || f.route === route) return;
    const named = manifest?.screens.find((s) => s.route === f.route)?.name === f.name;
    selfNav.current.set(id, route);
    update({ ...b, frames: b.frames.map((x) => (x.id === id ? { ...x, route, name: named ? manifest?.screens.find((s) => s.route === route)?.name ?? x.name : x.name } : x)) });
  }, [manifest, update]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== origin || !e.data?.ds) return;
      const id = [...frames.current].find(([, f]) => f.contentWindow === e.source)?.[0];
      if (!id) return;
      if (e.data.type === 'ready') {
        tell(e.source as Window, { type: 'mode', mode });
        if (picked?.frame === id) tell(e.source as Window, { type: 'select', src: picked.src });
      }
      if (e.data.type === 'select') {
        const el = e.data.element as { src: string; tag: string; layers?: Layer[] } | null;
        setSelFrame(id);
        for (const [fid, f] of frames.current) if (fid !== id) tell(f.contentWindow, { type: 'select', src: null });
        setPicked(el?.src ? { frame: id, src: el.src, tag: el.tag, layers: el.layers ?? [] } : null);
        if (el?.src) setShowChanges(false);
      }
      if (e.data.type === 'nav' && typeof e.data.path === 'string') followNav(id, e.data.path);
      if (e.data.type === 'key') {
        const k = String(e.data.key).toLowerCase();
        if (k === 'escape') { if (mode === 'interact') setMode('select'); else setPicked(null); }
        else if (k === 'v') setMode('select');
        else if (k === 'h') setMode('hand');
        else if (k === 'i') setMode('interact');
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [origin, mode, picked, tell, followNav]);

  const clearPick = useCallback(() => {
    setPicked(null);
    for (const f of frames.current.values()) tell(f.contentWindow, { type: 'select', src: null });
  }, [tell]);

  // Keyboard: V select, H hand, I interact, Shift+1 fit, Shift+2 the selected frame, Shift+0 100%, + and - zoom,
  // Escape clears.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (!stage.current?.closest('.editor.shown')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setMode('select');
      else if (k === 'h') setMode('hand');
      else if (k === 'i') setMode('interact');
      else if (e.shiftKey && e.code === 'Digit1') fit();
      else if (e.shiftKey && e.code === 'Digit2') { const f = board.frames.find((x) => x.id === selFrame); if (f) focusFrame(f); }
      else if (e.shiftKey && e.code === 'Digit0') zoomTo(1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(0.8);
      else if (e.key === 'Escape') { if (mode === 'interact') setMode('select'); else { clearPick(); setSelFrame(null); } }
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [fit, clearPick, focusFrame, zoomBy, zoomTo, board.frames, selFrame, undo, mode]);

  // Wheel pans; Cmd or Ctrl with the wheel (and pinch) zooms around the pointer.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // A pinch sends small steps, a mouse wheel big ones; both are capped so one notch is about 40%.
        const step = Math.max(-35, Math.min(35, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
        zoomByRef.current(Math.exp(-step * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);

  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  const drag = (e: React.PointerEvent, move: (dx: number, dy: number) => void, done?: () => void) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (m: PointerEvent) => move(m.clientX - sx, m.clientY - sy);
    const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp); done?.(); };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const panStart = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    const onEmpty = t === e.currentTarget || t.classList.contains('cv-plane');
    // Hand mode, the middle button or Space-less dragging on empty board all pan.
    if (!(mode === 'hand' || onEmpty) && e.button !== 1) return;
    if (onEmpty && mode !== 'hand') { setSelFrame(null); clearPick(); }
    const start = view;
    drag(e, (dx, dy) => setView({ ...start, x: start.x + dx, y: start.y + dy }));
  };

  const moveFrame = (e: React.PointerEvent, f: Frame) => {
    setSelFrame(f.id);
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
    update({ ...board, frames: manifest.screens.map((s, i) => ({ id: Math.random().toString(36).slice(2, 10), name: s.name, route: s.route, scenario, x: i * (laptop.w + GAP), y: 0, w: laptop.w, h: laptop.h })) });
    fitted.current = false;
  }, [manifest, board, update]);
  useEffect(() => { if (manifest && !board.frames.length) layOutScreens(); }, [manifest]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFrame = () => {
    const screen = manifest?.screens.find((s) => !board.frames.some((f) => f.route === s.route)) ?? manifest?.screens[0];
    if (!screen) return;
    const right = board.frames.reduce((m, f) => Math.max(m, f.x + f.w + GAP), 0);
    const laptop = SIZES[1];
    const f: Frame = { id: Math.random().toString(36).slice(2, 10), name: screen.name, route: screen.route, scenario: manifest?.scenarios[0]?.id ?? 'default', x: right, y: 0, w: laptop.w, h: laptop.h };
    update({ ...board, frames: [...board.frames, f] });
    setSelFrame(f.id);
  };

  const setFrame = (id: string, patch: Partial<Frame>) => update({ ...board, frames: board.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const removeFrame = (id: string) => { update({ ...board, frames: board.frames.filter((f) => f.id !== id) }); setSelFrame(null); clearPick(); };

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
    hoverAt.current = requestAnimationFrame(() => tell(frames.current.get(f.id)?.contentWindow, { type: 'hover', ...p }));
  };
  const shieldLeave = (f: Frame) => tell(frames.current.get(f.id)?.contentWindow, { type: 'hover', x: -1, y: -1 });
  const shieldClick = (e: React.MouseEvent, f: Frame) => {
    if (mode !== 'select') return;
    tell(frames.current.get(f.id)?.contentWindow, { type: 'pick', ...pointIn(e) });
  };

  const frame = board.frames.find((f) => f.id === selFrame) ?? null;

  return (
    <div className="cv">
      <div className="cv-main">
        <div ref={stage} className={`cv-stage mode-${mode}`} onPointerDown={panStart}>
          <div className="cv-plane" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {board.frames.map((f) => (
              <div key={f.id} className="cv-frame" style={{ left: f.x, top: f.y, width: f.w, height: f.h, boxShadow: `0 0 0 ${(selFrame === f.id ? 2 : 1) / view.zoom}px var(${selFrame === f.id ? '--accent' : '--border'})` }}>
                {mode !== 'interact' && (
                  <div className="cv-shield" onPointerMove={(e) => shieldMove(e, f)} onPointerLeave={() => shieldLeave(f)} onClick={(e) => shieldClick(e, f)} />
                )}
                {inView(f) ? (
                  <iframe
                    ref={(el) => { if (el) frames.current.set(f.id, el); else frames.current.delete(f.id); }}
                    title={f.name}
                    src={srcFor(f)}
                    width={f.w}
                    height={f.h}
                  />
                ) : (loaded.current.delete(f.id), <div className="cv-frame-off">{f.name}</div>)}
              </div>
            ))}
          </div>
          <div className="cv-labels">
            {board.frames.map((f) => {
              const w = f.w * view.zoom;
              if (w < 48 || !inView(f)) return null;
              return (
                <div key={f.id} className={`cv-frame-head${selFrame === f.id ? ' selected' : ''}`} style={{ left: f.x * view.zoom + view.x, top: f.y * view.zoom + view.y - 20, width: w }}
                  title={`${f.name} · ${manifest?.scenarios.find((s) => s.id === f.scenario)?.name ?? f.scenario}`}
                  onPointerDown={(e) => { e.stopPropagation(); moveFrame(e, f); }} onDoubleClick={() => focusFrame(f)}>
                  <span className="cv-frame-name">{f.name}</span>
                  {w > 200 && manifest && manifest.scenarios.length > 1 ? (
                    <select className="cv-frame-scenario" aria-label={`State of ${f.name}`} value={f.scenario} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setFrame(f.id, { scenario: e.target.value })}>
                      {manifest.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : w > 160 && <span className="cv-frame-scenario">{manifest?.scenarios.find((s) => s.id === f.scenario)?.name ?? f.scenario}</span>}
                </div>
              );
            })}
          </div>
          {!board.frames.length && (
            <div className="cv-hint">
              <p>An empty board</p>
              <button className="primary" onClick={addFrame} disabled={!manifest?.screens.length}>Add a frame</button>
            </div>
          )}
        </div>
        <div className="cv-tools" role="toolbar" aria-label="Canvas tools">
          {([['select', 'select', 'Select an element (V)'], ['hand', 'hand', 'Move around (H)'], ['interact', 'interact', 'Use the app (I)']] as const).map(([m, icon, tip]) => (
            <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} title={tip} aria-label={tip} onClick={() => setMode(m)}><Icon name={icon} /></button>
          ))}
          <span className="cv-sep" />
          <button title="Add a frame" aria-label="Add a frame" onClick={addFrame} disabled={!manifest?.screens.length}><Icon name="add" /></button>
          <button title="Fit the board (Shift+1)" aria-label="Fit the board" onClick={fit}><Icon name="screen-full" /></button>
          <span className="cv-sep" />
          <button className={showChanges ? 'active cv-changes-btn' : 'cv-changes-btn'} aria-pressed={showChanges} title="Changes to the app's code" onClick={() => { setShowChanges((v) => !v); void loadChanges(); }}>
            <Icon name="git-commit" />{changes?.files.length ? <span className="cv-count">{changes.files.length}</span> : null}
          </button>
          <span className="cv-sep" />
          <button title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Icon name="zoom-out" /></button>
          <button className="cv-zoom" title="Zoom to 100% (Shift+0)" aria-label={`Zoom ${Math.round(view.zoom * 100)}%, set to 100%`} onClick={() => zoomTo(1)}>{Math.round(view.zoom * 100)}%</button>
          <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="zoom-in" /></button>
        </div>
        {saveError && <div className="cv-toast" role="alert">Board not saved: {saveError}</div>}
        {toast && !saveError && <div className="cv-toast" role="status">{toast}</div>}
      </div>
      <aside className="cv-inspector" aria-label="Inspector">
        {showChanges ? <ChangesPanel changes={changes} reload={loadChanges} undo={undo} close={() => setShowChanges(false)} />
          : picked ? <ElementPanel picked={picked} frame={board.frames.find((f) => f.id === picked.frame) ?? null} onEdited={loadChanges} />
          : frame ? <FramePanel frame={frame} manifest={manifest} setFrame={setFrame} remove={removeFrame} />
          : <p className="cv-muted">Pick an element in a frame to edit it, or a frame's name to change its screen, state and size.</p>}
      </aside>
    </div>
  );
}
