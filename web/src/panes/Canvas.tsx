import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson, postJson, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, PrototypeArt } from './Empty';
import { SIZES, type Board, type CanvasElement, type CanvasOp, type CanvasStatus, type Frame, type Manifest } from '../../../shared/canvas';
import '../canvas.css';

// The Canvas tab: the prototype app's screens as live frames on a board. Select mode picks an element inside a frame
// and the inspector edits its source (text and attributes) through canvas-core; Vite then updates every frame.
// In Select and Hand modes a shield covers every frame, so the board gets every wheel, pinch and drag; a click on the
// shield asks the frame which element sits under that point. Only Interact mode hands the pointer to the app.

type Mode = 'select' | 'hand' | 'interact';
type View = { x: number; y: number; zoom: number };
type Picked = { frame: string; src: string; tag: string; element?: CanvasElement; error?: string };

const BUSY = ['creating', 'installing', 'starting'];
const GAP = 80;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function Canvas() {
  const chat = useStore((s) => s.session.id);
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getJson<{ status: CanvasStatus; board: Board }>('/api/canvas');
      setStatus(r.status);
      setBoard((b) => b ?? r.board);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { setBoard(null); setStatus(null); void load(); }, [chat, load]);
  useEffect(() => {
    if (!status || !BUSY.includes(status.state)) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [status, load]);
  // A made app starts by itself when the tab opens.
  useEffect(() => {
    if (status?.state === 'stopped') postJson<{ status: CanvasStatus }>('/api/canvas/start', {}).then((r) => setStatus(r.status), (e) => setError(e.message));
  }, [status?.state]);

  const create = () => postJson<{ status: CanvasStatus }>('/api/canvas/create', {}).then((r) => setStatus({ ...r.status, state: 'creating' }), (e) => setError(e.message));

  if (error && !status) return <Empty art={<PrototypeArt />} title="The canvas could not load" text={error} action={{ label: 'Try again', onClick: load }} />;
  if (!status || !board) return null;
  if (status.state === 'none') {
    return (
      <Empty
        art={<PrototypeArt />}
        title="No prototype app yet"
        text={status.hasProfile
          ? 'Design Studio makes a React app in this project with your design system tokens and base components. Every screen on the canvas is that real app.'
          : 'Design Studio makes a React app in this project with base components. There is no design system profile yet, so it starts with neutral colours; Refresh tokens applies the profile later.'}
        action={{ label: 'Create prototype app', onClick: create }}
      />
    );
  }
  if (BUSY.includes(status.state) || status.state === 'stopped') {
    return <div className="cv-wait" role="status"><Icon name="loading" spin /> {status.step ?? 'Starting the app'}</div>;
  }
  if (status.state === 'failed' || !status.url) {
    return <Empty art={<PrototypeArt />} title="The app did not start" text={status.error ?? 'Unknown error'} action={{ label: 'Try again', onClick: () => postJson('/api/canvas/start', {}).then(load) }} />;
  }
  return <BoardView url={status.url} board={board} setBoard={setBoard} />;
}

function BoardView({ url, board, setBoard }: { url: string; board: Board; setBoard: (b: Board) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [view, setView] = useState<View>({ x: 40, y: 60, zoom: 0.5 });
  const [mode, setMode] = useState<Mode>('select');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selFrame, setSelFrame] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [saveError, setSaveError] = useState('');
  const origin = useMemo(() => new URL(url).origin, [url]);

  useEffect(() => { getJson<Manifest>('/api/canvas/manifest').then(setManifest, () => setManifest({ screens: [], scenarios: [] })); }, [url]);

  // Saves shortly after the last change.
  const saveTimer = useRef<number>(0);
  const update = useCallback((next: Board) => {
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

  const inspect = useCallback(async (p: Picked) => {
    try {
      const r = await getJson<{ element: CanvasElement }>(`/api/canvas/inspect?src=${encodeURIComponent(p.src)}`);
      setPicked((cur) => (cur?.src === p.src && cur.frame === p.frame ? { ...cur, element: r.element, error: undefined } : cur));
    } catch (e) {
      setPicked((cur) => (cur?.src === p.src ? { ...cur, error: (e as Error).message } : cur));
    }
  }, []);

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
        const el = e.data.element as { src: string; tag: string } | null;
        setSelFrame(id);
        for (const [fid, f] of frames.current) if (fid !== id) tell(f.contentWindow, { type: 'select', src: null });
        if (!el?.src) { setPicked(null); return; }
        const p: Picked = { frame: id, src: el.src, tag: el.tag };
        setPicked(p);
        void inspect(p);
      }
      if (e.data.type === 'key' && e.data.key === 'Escape') setPicked(null);
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [origin, mode, picked, tell, inspect]);

  const clearPick = useCallback(() => {
    setPicked(null);
    for (const f of frames.current.values()) tell(f.contentWindow, { type: 'select', src: null });
  }, [tell]);

  // Keyboard: V select, H hand, I interact, Shift+1 fit, Shift+2 the selected frame, Shift+0 100%, + and - zoom,
  // Escape clears.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!stage.current?.closest('.editor.shown')) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setMode('select');
      else if (k === 'h') setMode('hand');
      else if (k === 'i') setMode('interact');
      else if (e.shiftKey && e.code === 'Digit1') fit();
      else if (e.shiftKey && e.code === 'Digit2') { const f = board.frames.find((x) => x.id === selFrame); if (f) focusFrame(f); }
      else if (e.shiftKey && e.code === 'Digit0') zoomTo(1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(0.8);
      else if (e.key === 'Escape') { clearPick(); setSelFrame(null); }
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [fit, clearPick, focusFrame, zoomBy, zoomTo, board.frames, selFrame]);

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

  const addFrame = () => {
    const screen = manifest?.screens[0];
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
                    src={`${url}${f.route}?scenario=${encodeURIComponent(f.scenario)}`}
                    width={f.w}
                    height={f.h}
                  />
                ) : <div className="cv-frame-off">{f.name}</div>}
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
                  {w > 160 && <span className="cv-frame-scenario">{manifest?.scenarios.find((s) => s.id === f.scenario)?.name ?? f.scenario}</span>}
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
          <button title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Icon name="zoom-out" /></button>
          <button className="cv-zoom" title="Zoom to 100% (Shift+0)" aria-label={`Zoom ${Math.round(view.zoom * 100)}%, set to 100%`} onClick={() => zoomTo(1)}>{Math.round(view.zoom * 100)}%</button>
          <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="zoom-in" /></button>
        </div>
        {saveError && <div className="cv-toast" role="alert">Board not saved: {saveError}</div>}
      </div>
      <aside className="cv-inspector" aria-label="Inspector">
        {picked ? <ElementPanel picked={picked} onEdited={() => inspect(picked)} />
          : frame ? <FramePanel frame={frame} manifest={manifest} setFrame={setFrame} remove={removeFrame} />
          : <p className="cv-muted">Pick an element in a frame to edit it, or a frame's name to change its screen, state and size.</p>}
      </aside>
    </div>
  );
}

function FramePanel({ frame, manifest, setFrame, remove }: { frame: Frame; manifest: Manifest | null; setFrame: (id: string, p: Partial<Frame>) => void; remove: (id: string) => void }) {
  return (
    <div className="cv-panel">
      <h2>Frame</h2>
      <label>Name<input value={frame.name} onChange={(e) => setFrame(frame.id, { name: e.target.value })} /></label>
      <label>Screen
        <select value={frame.route} onChange={(e) => setFrame(frame.id, { route: e.target.value, name: manifest?.screens.find((s) => s.route === e.target.value)?.name ?? frame.name })}>
          {(manifest?.screens ?? []).map((s) => <option key={s.route} value={s.route}>{s.name} ({s.route})</option>)}
          {!manifest?.screens.some((s) => s.route === frame.route) && <option value={frame.route}>{frame.route}</option>}
        </select>
      </label>
      <label>State
        <select value={frame.scenario} onChange={(e) => setFrame(frame.id, { scenario: e.target.value })}>
          {(manifest?.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="cv-field">
        <span>Size</span>
        <div className="cv-sizes" role="group" aria-label="Size">
          {SIZES.map((s) => <button key={s.id} className={frame.w === s.w && frame.h === s.h ? 'active' : ''} onClick={() => setFrame(frame.id, { w: s.w, h: s.h })}>{s.label}</button>)}
        </div>
        <span className="cv-muted">{frame.w} × {frame.h}</span>
      </div>
      <button className="danger" onClick={() => remove(frame.id)}>Delete frame</button>
    </div>
  );
}

function ElementPanel({ picked, onEdited }: { picked: Picked; onEdited: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newAttr, setNewAttr] = useState({ name: '', value: '' });
  const el = picked.element;
  useEffect(() => setError(''), [picked.src]);

  const apply = async (op: CanvasOp) => {
    if (!el) return;
    setBusy(true);
    try {
      await postJson('/api/canvas/edit', { src: picked.src, tag: el.tag, op });
      setError('');
      onEdited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = picked.src.replace(/:\d+$/, '');
  return (
    <div className="cv-panel" aria-busy={busy}>
      <h2><code>&lt;{el?.tag ?? picked.tag}&gt;</code></h2>
      <p className="cv-src" title={picked.src}>{file}</p>
      {/^src\/components\//.test(file) && <p className="cv-note">This is inside a base component, so a change here applies to every use of it.</p>}
      {picked.error && <p className="cv-error" role="alert">{picked.error}</p>}
      {el && (
        <>
          {el.text !== null && <Field key={`text:${picked.src}:${el.text}`} label="Text" value={el.text} multiline onCommit={(v) => apply({ kind: 'text', value: v })} />}
          {el.attrs.map((a) =>
            a.kind === 'string' ? (
              <Field key={`${picked.src}:${a.name}:${a.value}`} label={a.name} value={a.value ?? ''} multiline={a.name === 'className'} mono={a.name === 'className'}
                onCommit={(v) => apply({ kind: 'attr', name: a.name, value: v })} onRemove={() => apply({ kind: 'attr', name: a.name, value: null })} />
            ) : a.kind === 'bool' ? (
              <div key={a.name} className="cv-field cv-row"><span>{a.name}</span><button className="ghost" onClick={() => apply({ kind: 'attr', name: a.name, value: null })}>Remove</button></div>
            ) : (
              <div key={a.name} className="cv-field"><span>{a.name}</span><code className="cv-expr" title="Set by code. Ask Claude to change it">{a.raw}</code></div>
            ),
          )}
          <form className="cv-add" onSubmit={(e) => { e.preventDefault(); if (newAttr.name) void apply({ kind: 'attr', name: newAttr.name.trim(), value: newAttr.value }).then(() => setNewAttr({ name: '', value: '' })); }}>
            <span>Add a property</span>
            <div className="cv-row">
              <input aria-label="Property name" placeholder="name" value={newAttr.name} onChange={(e) => setNewAttr({ ...newAttr, name: e.target.value })} />
              <input aria-label="Property value" placeholder="value" value={newAttr.value} onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })} />
              <button type="submit" disabled={!newAttr.name.trim()} aria-label="Add property"><Icon name="add" small /></button>
            </div>
          </form>
        </>
      )}
      {error && <p className="cv-error" role="alert">{error}</p>}
    </div>
  );
}

function Field({ label, value, multiline, mono, onCommit, onRemove }: { label: string; value: string; multiline?: boolean; mono?: boolean; onCommit: (v: string) => void; onRemove?: () => void }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v !== value) onCommit(v); };
  const props = {
    value: v,
    className: mono ? 'mono' : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') setV(value);
    },
  };
  return (
    <label className="cv-field">
      <span className="cv-row">{label}{onRemove && <button type="button" className="ghost cv-remove" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={onRemove}><Icon name="close" small /></button>}</span>
      {multiline ? <textarea rows={Math.min(5, Math.max(2, Math.ceil(v.length / 34)))} {...props} /> : <input {...props} />}
    </label>
  );
}
