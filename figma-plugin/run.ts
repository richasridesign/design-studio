// Claude's Figma scripts, run here instead of through the Figma MCP's use_figma: the same body of an async function
// with `figma` in scope, so the DS helpers and Claude's habits carry over. On her files a call took 5.6 s (median) and
// up to 4 minutes through the MCP; here the script itself is all that runs. The server sends code only from a chat's
// tool call, after the scope guard and the write lock (server/src/figmaRun.ts).

/** Claude's images are at most this many pixels on the long side. */
const SHOT_MAX = 1568;

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

/**
 * The figma object Claude's script gets: closePlugin and showUI would close or replace Design Studio's own plugin.
 * The proxy wraps an empty object, not figma: figma's methods are non-writable and non-configurable, and a proxy may
 * not hand back a bound copy of such a property of its target.
 */
function guarded(figma: any) {
  return new Proxy({}, {
    get(_, k) {
      if (k === 'closePlugin' || k === 'showUI') return () => {};
      const v = figma[k];
      return typeof v === 'function' ? v.bind(figma) : v;
    },
    set(_, k, v) {
      figma[k] = v;
      return true;
    },
    has: (_, k) => k in figma,
  });
}

/**
 * Runs one script and gives its value, how long it ran, and the screenshots DS.shot asked for (PNG, base64). The page
 * shown before stays shown, so a script that switches page does not move her view; Follow Claude moves it on purpose.
 */
export async function script(figma: any, args: any) {
  const shots: { id: string; png: string }[] = [];
  const shoot = async (n: any) => {
    const long = Math.max(n.width || 1, n.height || 1);
    const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: Math.min(1, SHOT_MAX / long) } });
    shots.push({ id: n.id, png: figma.base64Encode(bytes) });
  };
  const before = figma.currentPage;
  const t = Date.now();
  try {
    const value = await new AsyncFn('figma', '__dsShot', String(args.code))(guarded(figma), shoot);
    return { value: value === undefined ? null : value, ms: Date.now() - t, shots };
  } finally {
    try {
      if (figma.currentPage !== before) await figma.setCurrentPageAsync(before);
    } catch {}
  }
}
