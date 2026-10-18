import { useEffect, useState } from 'react';
import { getJson, useRev, useStore } from './store';

export type CanvasContent = { figma: boolean; sketch: boolean; review: boolean };

export const hasSketch = (doc: unknown, board: unknown) =>
  (!!doc && typeof doc === 'object' && !('error' in doc)) || (Array.isArray(board) && board.length > 0);

export const hasReview = (doc: unknown) => {
  const runs = (doc as { runs?: unknown } | null)?.runs;
  return Array.isArray(runs) && runs.length > 0;
};

export function useCanvasContent(): CanvasContent {
  const chat = useStore((s) => s.session.id);
  const phase = useStore((s) => s.session.flow.phase);
  const figma = useStore((s) => !!s.session.figma);
  const sketchRev = useRev('sketch.json');
  const boardRev = useRev('sketch-board.json');
  const reviewRev = useRev('review.json');
  const [sketch, setSketch] = useState(false);
  const [review, setReview] = useState(false);

  useEffect(() => {
    let live = true;
    const load = (path: string) => getJson<unknown>(path).catch(() => null);
    Promise.all([load('/api/sketch'), load('/api/sketch/board')]).then(([d, b]) => live && setSketch(hasSketch(d, b)));
    return () => { live = false; };
  }, [chat, phase, sketchRev, boardRev]);

  useEffect(() => {
    let live = true;
    getJson<unknown>('/api/review').then(hasReview, () => false).then((v) => live && setReview(v));
    return () => { live = false; };
  }, [chat, phase, reviewRev]);

  return { figma, sketch, review };
}
