import { useCallback, useMemo, useRef, useState } from 'react';
import type { Frame } from '../../../../../shared/canvas';

// The iframes of the board and the messages to their frame script (canvas/plugin/client.js).
//
// A frame keeps the page its iframe was given while the app navigates inside it, so following a link does not reload
// the frame; the frame's route follows the app instead (see `moved`). A frame with clicks gets them replayed each time
// its page is ready, to show a side state such as an open dialog.

export const withScenario = (route: string, scenario: string) => `${route}${route.includes('?') ? '&' : '?'}scenario=${encodeURIComponent(scenario)}`;

export function useFrames(url: string) {
  const origin = useMemo(() => new URL(url).origin, [url]);
  const els = useRef(new Map<string, HTMLIFrameElement>());
  const loaded = useRef(new Map<string, string>());
  const selfNav = useRef(new Map<string, string>());
  // A reload remounts the iframe: its key carries a count per frame.
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});

  const tell = useCallback((win: Window | null | undefined, msg: Record<string, unknown>) => win?.postMessage({ ds: true, ...msg }, origin), [origin]);
  // Only frames whose app said it is ready get messages; one still on about:blank would refuse them with a warning.
  const ready = useRef(new WeakSet<Window>());
  const heard = useCallback((win: MessageEventSource | null) => { if (win) ready.current.add(win as Window); }, []);
  const tellReady = useCallback((win: Window | null | undefined, msg: Record<string, unknown>) => { if (win && ready.current.has(win)) tell(win, msg); }, [tell]);
  const tellFrame = useCallback((id: string, msg: Record<string, unknown>) => tellReady(els.current.get(id)?.contentWindow, msg), [tellReady]);
  const tellAll = useCallback((msg: Record<string, unknown>, except?: string) => { for (const [id, f] of els.current) if (id !== except) tellReady(f.contentWindow, msg); }, [tellReady]);
  const idOf = useCallback((win: MessageEventSource | null) => [...els.current].find(([, f]) => f.contentWindow === win)?.[0], []);

  const src = (f: Frame) => {
    const want = `${url}${withScenario(f.route, f.scenario)}`;
    const had = loaded.current.get(f.id);
    if (had && selfNav.current.get(f.id) === f.route && had.endsWith(`scenario=${encodeURIComponent(f.scenario)}`)) return had;
    loaded.current.set(f.id, want);
    selfNav.current.delete(f.id);
    return want;
  };
  const key = (f: Frame) => `${f.id}:${reloads[f.id] ?? 0}:${(f.clicks ?? []).join('>')}`;
  const ref = (id: string) => (el: HTMLIFrameElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); };
  /** The frame went out of view and its iframe was dropped; it loads its own route again when back. */
  const unloaded = (id: string) => loaded.current.delete(id);
  /** The app moved inside the frame: the frame's route follows without reloading it. */
  const moved = (id: string, route: string) => selfNav.current.set(id, route);
  const reload = useCallback((id: string) => {
    loaded.current.delete(id);
    setFailed(({ [id]: _, ...rest }) => rest);
    setReloads((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
  }, []);
  const replay = useCallback((f: Frame) => { if (f.clicks?.length) tellFrame(f.id, { type: 'replay', clicks: f.clicks }); }, [tellFrame]);
  const replayFailed = useCallback((id: string, label: string | null) => setFailed(({ [id]: _, ...rest }) => (label ? { ...rest, [id]: label } : rest)), []);

  return { origin, heard, tell, tellFrame, tellAll, idOf, src, key, ref, unloaded, moved, reload, replay, failed, replayFailed };
}
