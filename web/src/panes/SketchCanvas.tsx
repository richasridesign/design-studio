import { useEffect, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { SketchDoc } from '../../../shared/design';
import { layoutSketch } from './sketchLayout';

type Api = { updateScene: (s: { elements: readonly any[] }) => void; scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; fitToViewport?: boolean; viewportZoomFactor?: number; animate?: boolean }) => void; getSceneElements: () => readonly any[] };

/** Which direction to zoom to. `n` changes on every request, so asking for the same direction twice zooms again. */
export type CanvasFocus = { dir: string; n: number };

/** The drawn sketch. A label becomes its own text element with no customData, so it takes its container's tags. */
function generate(doc: SketchDoc | null) {
  if (!doc) return [];
  const els = convertToExcalidrawElements(layoutSketch(doc) as any, { regenerateIds: true }) as any[];
  const byId = new Map(els.map((e) => [e.id, e]));
  return els.map((e) => (e.containerId && !e.customData ? { ...e, customData: byId.get(e.containerId)?.customData } : e));
}

const mineOf = (els: readonly any[]) => els.filter((e: any) => !e.customData?.generated && !e.isDeleted);
const keyOf = (els: readonly any[]) => JSON.stringify(els.map((e: any) => [e.id, e.version]));

/** `start`: the direction to open on (a phone shows one at a time); without it the canvas opens on the first screen's row. */
export default function SketchCanvas({ doc, board, focus, start, onBoard }: { doc: SketchDoc | null; board: any[]; focus?: CanvasFocus | null; start?: string; onBoard: (els: any[]) => void }) {
  const api = useRef<Api | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Null until the loaded scene settles: the first change Excalidraw reports is the board it was given, not an edit.
  const lastSaved = useRef<string | null>(null);

  const zoomTo = (dir: string | undefined, animate: boolean) => {
    const all = api.current?.getSceneElements() ?? [];
    const first = doc?.screens[0];
    // With no direction asked for, open on the first screen's row: big enough to read, instead of every screen at once.
    const target = dir ? all.filter((e: any) => e.customData?.dir === dir) : first ? all.filter((e: any) => e.customData?.screen === first.id) : [];
    api.current?.scrollToContent(target.length ? target : undefined, { fitToViewport: true, viewportZoomFactor: dir ? 0.8 : 0.9, animate });
  };

  const scene = () => {
    // Older boards saved the sketch's own labels by mistake: a label whose box is not on the board is one of those.
    const ids = new Set(board.map((e) => e.id));
    return [...generate(doc), ...board.filter((e) => !e.containerId || ids.has(e.containerId))];
  };

  useEffect(() => {
    if (!ready) return;
    // Excalidraw's menu button is icon-only with no name: give it one, and a tooltip.
    const menu = document.querySelector<HTMLButtonElement>('.excalidraw .main-menu-trigger');
    menu?.setAttribute('aria-label', 'Canvas menu');
    menu?.setAttribute('title', 'Canvas menu');
  }, [ready]);

  useEffect(() => {
    if (!ready || !api.current) return;
    let alive = true;
    (async () => {
      await document.fonts.load('20px Excalifont').catch(() => {});
      await document.fonts.ready;
      if (!alive || !api.current) return;
      const mine = api.current.getSceneElements().filter((e: any) => !e.customData?.generated);
      api.current.updateScene({ elements: [...generate(doc), ...mine] });
      if (lastSaved.current === null) lastSaved.current = keyOf(mineOf(api.current.getSceneElements()));
      requestAnimationFrame(() => zoomTo(start, false));
    })();
    return () => {
      alive = false;
    };
  }, [doc, ready]);

  useEffect(() => {
    if (ready && focus) zoomTo(focus.dir, true);
  }, [focus?.n, ready]);

  return (
    <Excalidraw
      excalidrawAPI={(a) => {
        api.current = a as unknown as Api;
        setReady(true);
      }}
      theme="light"
      initialData={{ elements: scene(), appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 1 }, scrollToContent: true }}
      onChange={(els) => {
        const mine = mineOf(els);
        const key = keyOf(mine);
        if (lastSaved.current === null) {
          lastSaved.current = key;
          return;
        }
        if (key === lastSaved.current) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          lastSaved.current = key;
          onBoard(mine as any[]);
        }, 800);
      }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
    />
  );
}
