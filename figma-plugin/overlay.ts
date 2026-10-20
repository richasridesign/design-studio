// What Richa sees in figma.com inside the Design Studio window while Claude edits: a "Claude" cursor that glides to
// the part Claude is about to edit and stays there while the script runs, then to what changed, and a pink outline
// that flashes on changed layers for a second. Drawn over Figma's canvas, never in the document, and never clickable.
// Positions are kept in canvas coordinates and mapped to the screen each frame, so they stay put when the view moves.

type Box = { x: number; y: number; width: number; height: number };

const PINK = '#D65C89';
const INK = '#141414';
/** After editing ends, the cursor stays this long, then fades. */
const LINGER_MS = 3000;
/** A flash shows this long, then fades. */
const FLASH_MS = 1000;
/** Without an "editing" message (an older server), the cursor hides this long after the last move. */
const IDLE_MS = 8000;
const MAX_FLASH = 12;

export function overlay(figma: any) {
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;';
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:absolute;left:0;top:0;opacity:0;transition:opacity 200ms ease;will-change:transform;';
  cursor.innerHTML = `<svg width="20" height="22" viewBox="0 0 20 22" style="display:block"><path d="M2 1.5 L2 18 L6.4 13.9 L9.3 20.4 L12.3 19.1 L9.5 12.7 L15.6 12.7 Z" fill="${INK}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
    + `<span style="position:absolute;left:16px;top:18px;padding:2px 8px;border-radius:999px;background:${PINK};color:#fff;font:500 12px/16px Inter,-apple-system,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">Claude</span>`;
  root.appendChild(cursor);
  const mount = () => { if (!root.isConnected && document.body) document.body.appendChild(root); };

  let at: { x: number; y: number } | null = null;
  let editing = false;
  let lastMove = 0;
  let hideAt = 0;
  let glide = false;
  const flashes: Array<{ el: HTMLDivElement; box: Box; until: number }> = [];

  /** The canvas Figma draws the file on: the largest canvas on the page. */
  const canvas = () => {
    let best: HTMLCanvasElement | null = null;
    let area = 0;
    document.querySelectorAll('canvas').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = c; }
    });
    return best as HTMLCanvasElement | null;
  };
  /** A point in the file to a point on screen, through the viewport Figma reports and the canvas element's place. */
  const toScreen = () => {
    const c = canvas();
    const b = figma.viewport?.bounds as Box | undefined;
    if (!c || !b || !b.width || !b.height) return null;
    const r = c.getBoundingClientRect();
    const sx = r.width / b.width;
    const sy = r.height / b.height;
    return { pt: (x: number, y: number) => ({ x: r.left + (x - b.x) * sx, y: r.top + (y - b.y) * sy }), sx, sy, r };
  };

  const tick = () => {
    requestAnimationFrame(tick);
    const now = Date.now();
    const visible = !!at && (editing || now < hideAt || now - lastMove < IDLE_MS);
    if (!visible && !flashes.length) {
      if (cursor.style.opacity !== '0') cursor.style.opacity = '0';
      return;
    }
    const map = toScreen();
    if (!map) return;
    if (at) {
      const p = map.pt(at.x, at.y);
      cursor.style.transition = `opacity 200ms ease${glide && !reduce() ? ', transform 400ms ease' : ''}`;
      cursor.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      glide = false;
      cursor.style.opacity = visible ? '1' : '0';
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      if (now > f.until + 400) { f.el.remove(); flashes.splice(i, 1); continue; }
      const p = map.pt(f.box.x, f.box.y);
      f.el.style.transform = `translate(${Math.round(p.x) - 2}px, ${Math.round(p.y) - 2}px)`;
      f.el.style.width = `${Math.max(4, Math.round(f.box.width * map.sx) + 4)}px`;
      f.el.style.height = `${Math.max(4, Math.round(f.box.height * map.sy) + 4)}px`;
      if (now > f.until) f.el.style.opacity = '0';
    }
  };
  requestAnimationFrame(tick);

  const boxes = async (ids: string[]) => {
    const page = figma.currentPage;
    const nodes = await Promise.all(ids.slice(0, 40).map((id) => figma.getNodeByIdAsync(id).catch(() => null)));
    const onPage = (n: any) => { for (let p = n; p; p = p.parent) if (p === page) return true; return false; };
    return nodes.filter((n: any) => n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT' && n.absoluteBoundingBox && onPage(n)) as any[];
  };
  /** The deepest of the nodes: an edit names a screen and the layers in it, the layers are where it happens. */
  const deepest = (nodes: any[]) => nodes.filter((n) => !nodes.some((m) => m !== n && (() => { for (let p = m.parent; p; p = p.parent) if (p === n) return true; return false; })()));

  /** Glides to a spot inside these nodes: the tip just inside the top left of the first one, where a designer would point. */
  async function moveTo(ids: string[]) {
    const nodes = deepest(await boxes(ids));
    if (!nodes.length) return;
    const b = nodes[0].absoluteBoundingBox as Box;
    const z = figma.viewport?.zoom || 1;
    const inset = 16 / z;
    mount();
    glide = !!at;
    at = { x: b.x + Math.min(inset, b.width / 2), y: b.y + Math.min(inset, b.height / 2) };
    lastMove = Date.now();
  }

  async function flash(ids: string[]) {
    const nodes = deepest(await boxes(ids)).slice(0, MAX_FLASH);
    if (!nodes.length) return;
    mount();
    const until = Date.now() + FLASH_MS;
    for (const n of nodes) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;top:0;border:2px solid ${PINK};border-radius:2px;box-sizing:border-box;opacity:1;transition:opacity 400ms ease;`;
      root.appendChild(el);
      flashes.push({ el, box: { ...(n.absoluteBoundingBox as Box) }, until });
    }
  }

  return {
    /** A follow moved the view (or found it already there): the cursor goes to what it named. */
    async followed(ids: string[]) {
      try { await moveTo(ids); } catch {}
    },
    /** Changes landed: they flash, and the cursor moves to them. */
    async changed(ids: string[]) {
      try {
        await flash(ids);
        await moveTo(ids);
      } catch {}
    },
    editing(on: boolean) {
      editing = on;
      if (!on) hideAt = Date.now() + LINGER_MS;
    },
  };
}
