import { useEffect, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { SketchDoc } from '../../../shared/design';
import { layoutSketch } from './sketchLayout';

type Api = { updateScene: (s: { elements: readonly any[] }) => void; scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; viewportZoomFactor?: number }) => void; getSceneElements: () => readonly any[] };

export default function SketchCanvas({ doc, board, onBoard }: { doc: SketchDoc | null; board: any[]; onBoard: (els: any[]) => void }) {
  const api = useRef<Api | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef('');

  const scene = () => {
    const generated = doc ? convertToExcalidrawElements(layoutSketch(doc) as any, { regenerateIds: true }) : [];
    return [...generated, ...board];
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
      const generated = doc ? convertToExcalidrawElements(layoutSketch(doc) as any, { regenerateIds: true }) : [];
      api.current.updateScene({ elements: [...generated, ...mine] });
      requestAnimationFrame(() => api.current?.scrollToContent(undefined, { fitToContent: true, viewportZoomFactor: 0.75 }));
    })();
    return () => {
      alive = false;
    };
  }, [doc, ready]);

  return (
    <Excalidraw
      excalidrawAPI={(a) => {
        api.current = a as unknown as Api;
        setReady(true);
      }}
      theme="light"
      initialData={{ elements: scene(), appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 1 }, scrollToContent: true }}
      onChange={(els) => {
        const mine = els.filter((e: any) => !e.customData?.generated && !e.isDeleted);
        const key = JSON.stringify(mine.map((e: any) => [e.id, e.version]));
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
