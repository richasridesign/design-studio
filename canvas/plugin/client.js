// Runs inside each canvas frame. In Select mode the canvas sends the point under the pointer; the nearest element
// with data-ds-src there is outlined or picked, and the canvas is told. The canvas tells it the mode and which element to keep outlined.
(() => {
  if (window.parent === window) return;
  const origin = location.ancestorOrigins?.[0] ?? '*';
  const post = (msg) => window.parent.postMessage({ ds: true, ...msg }, origin);
  let mode = 'select';
  let selected = null;

  const box = (color, width) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:${width}px solid ${color};border-radius:2px;display:none;box-sizing:border-box`;
    document.documentElement.appendChild(el);
    return el;
  };
  const hover = box('#7c5cff', 1);
  const pick = box('#7c5cff', 2);
  const place = (b, el) => {
    if (!el) { b.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(b.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const target = (el) => el?.closest?.('[data-ds-src]') ?? null;
  const bySrc = (src) => (src ? document.querySelector(`[data-ds-src="${CSS.escape(src)}"]`) : null);
  const describe = (el) => ({ src: el.getAttribute('data-ds-src'), tag: el.tagName.toLowerCase(), text: (el.innerText ?? '').trim().slice(0, 200) });

  addEventListener('mousemove', (e) => place(hover, mode === 'select' ? target(e.target) : null), true);
  addEventListener('mouseleave', () => place(hover, null));
  for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'submit']) {
    addEventListener(type, (e) => { if (mode === 'select') { e.preventDefault(); e.stopPropagation(); } }, true);
  }
  addEventListener('click', (e) => {
    if (mode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    const el = target(e.target);
    selected = el ? el.getAttribute('data-ds-src') : null;
    place(pick, el);
    post({ type: 'select', element: el ? describe(el) : null });
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') post({ type: 'key', key: 'Escape' });
  });

  // Keep the selection outlined through scrolling, resizing and hot updates.
  const follow = () => { place(pick, bySrc(selected)); requestAnimationFrame(follow); };
  requestAnimationFrame(follow);

  addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data?.ds) return;
    if (e.data.type === 'mode') {
      mode = e.data.mode;
      document.documentElement.style.cursor = mode === 'select' ? 'default' : '';
      if (mode !== 'select') place(hover, null);
    }
    if (e.data.type === 'select') selected = e.data.src ?? null;
    // The canvas covers the frame with a shield and sends points in the frame's own pixels.
    if (e.data.type === 'hover') place(hover, e.data.x < 0 ? null : target(document.elementFromPoint(e.data.x, e.data.y)));
    if (e.data.type === 'pick') {
      const el = target(document.elementFromPoint(e.data.x, e.data.y));
      selected = el ? el.getAttribute('data-ds-src') : null;
      place(pick, el);
      post({ type: 'select', element: el ? describe(el) : null });
    }
  });

  const ready = () => post({ type: 'ready', path: location.pathname + location.search });
  addEventListener('popstate', ready);
  ready();
})();
