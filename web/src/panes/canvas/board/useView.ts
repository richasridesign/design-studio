import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// The board's camera: where the plane sits and how far it is zoomed, the stage size, and the wheel and pinch.

export type View = { x: number; y: number; zoom: number };
export type Rect = { x: number; y: number; w: number; h: number };

const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function useView(stage: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<View>({ x: 40, y: 60, zoom: 0.5 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  /** Brings a box (a frame, a section, the whole board) to fill the stage, never past 100%. */
  const show = useCallback((r: Rect) => {
    const s = sizeRef.current;
    if (!s.w || !r.w || !r.h) return;
    const zoom = clampZoom(Math.min(1, (s.w - 80) / r.w, (s.h - 120) / r.h));
    setView({ zoom, x: (s.w - r.w * zoom) / 2 - r.x * zoom, y: (s.h - r.h * zoom) / 2 - r.y * zoom + 12 });
  }, []);

  /** Zooms by a factor around a point on the stage (the centre when none is given). */
  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const s = sizeRef.current;
    const [x0, y0] = [px ?? s.w / 2, py ?? s.h / 2];
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      return { zoom, x: x0 - ((x0 - v.x) * zoom) / v.zoom, y: y0 - ((y0 - v.y) * zoom) / v.zoom };
    });
  }, []);
  const zoomTo = useCallback((zoom: number) => setView((v) => {
    const s = sizeRef.current;
    const z = clampZoom(zoom);
    return { zoom: z, x: s.w / 2 - ((s.w / 2 - v.x) * z) / v.zoom, y: s.h / 2 - ((s.h / 2 - v.y) * z) / v.zoom };
  }), []);
  /** Keeps the zoom and moves a box's middle to the middle of the stage. */
  const centre = useCallback((r: Rect) => setView((v) => ({ ...v, x: sizeRef.current.w / 2 - (r.x + r.w / 2) * v.zoom, y: sizeRef.current.h / 2 - (r.y + r.h / 2) * v.zoom })), []);

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
        zoomBy(Math.exp(-step * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [stage, zoomBy]);

  return { view, setView, size, show, zoomBy, zoomTo, centre };
}

/** The box around some frames. */
export const bounds = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

/** A drag from a pointer press: move gets the distance moved, done runs on release. */
export function drag(e: React.PointerEvent, move: (dx: number, dy: number) => void, done?: () => void) {
  if (e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  // preventDefault keeps focus where it was, so a field elsewhere (the composer) would take the canvas's keys.
  (document.activeElement as HTMLElement | null)?.blur?.();
  const sx = e.clientX;
  const sy = e.clientY;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const onMove = (m: PointerEvent) => move(m.clientX - sx, m.clientY - sy);
  const onUp = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp); done?.(); };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
}
