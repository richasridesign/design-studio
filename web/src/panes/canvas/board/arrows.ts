import type { Frame, Link } from '../../../../../shared/canvas';
import type { View } from './useView';

// Arrows in screen pixels, so they stay 2px and their labels readable at any zoom. A frame to the right is joined
// side to side; one above or below, bottom to top. They leave and enter a frame 416px below its top, as in her Figma
// flows, or at the middle of a short frame.

const armY = (f: Frame) => f.y + Math.min(416, f.h / 2);
const CLEAR = 8;

export type Arrow = { l: Link; d: string; mid: { x: number; y: number } };

export function arrows(frames: Frame[], links: Link[], view: View): Arrow[] {
  const sx = (x: number) => x * view.zoom + view.x;
  const sy = (y: number) => y * view.zoom + view.y;
  return links.flatMap((l) => {
    const a = frames.find((f) => f.id === l.from);
    const b = frames.find((f) => f.id === l.to);
    if (!a || !b) return [];
    if (b.x >= a.x + a.w || b.x + b.w <= a.x) {
      const right = b.x >= a.x + a.w;
      const x1 = sx(right ? a.x + a.w : a.x) + (right ? CLEAR : -CLEAR);
      const x2 = sx(right ? b.x : b.x + b.w) - (right ? CLEAR : -CLEAR);
      const [y1, y2] = [sy(armY(a)), sy(armY(b))];
      const mx = (x1 + x2) / 2;
      return [{ l, d: `M${x1},${y1} H${mx} V${y2} H${x2}`, mid: { x: mx, y: y2 } }];
    }
    const down = b.y >= a.y + a.h;
    const y1 = sy(down ? a.y + a.h : a.y) + (down ? CLEAR : -CLEAR);
    const y2 = sy(down ? b.y : b.y + b.h) - (down ? CLEAR : -CLEAR);
    const [x1, x2] = [sx(a.x + a.w / 2), sx(b.x + b.w / 2)];
    const my = (y1 + y2) / 2;
    return [{ l, d: `M${x1},${y1} V${my} H${x2} V${y2}`, mid: { x: x2, y: my } }];
  });
}
