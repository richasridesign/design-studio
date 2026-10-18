import { useEffect, useState } from 'react';
import { getJson, useRev, useStore } from './store';

export type CanvasContent = { figma: boolean; sketch: boolean; review: boolean; decisions: boolean };

export const hasSketch = (doc: unknown, board: unknown) =>
  (!!doc && typeof doc === 'object' && !('error' in doc)) || (Array.isArray(board) && board.length > 0);

export const hasReview = (doc: unknown) => {
  const runs = (doc as { runs?: unknown } | null)?.runs;
  return Array.isArray(runs) && runs.length > 0;
};

/** The Review tab also shows when a decision waits for her, so a chat with no review can still reach the list. */
export const hasOpenAwaiting = (items: unknown) => Array.isArray(items) && items.some((i) => (i as { state?: unknown } | null)?.state === 'open');

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
    const runs = getJson<unknown>('/api/review').then(hasReview, () => false);
    const waiting = getJson<unknown>('/api/awaiting').then(hasOpenAwaiting, () => false);
    Promise.all([runs, waiting]).then(([a, b]) => live && setReview(a || b));
    return () => { live = false; };
  }, [chat, phase, reviewRev]);

  // The decision log on the Decisions tab starts with sketch picks, before a Figma file is attached.
  return { figma, sketch, review, decisions: figma || sketch };
}
