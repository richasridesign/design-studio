(() => {
  // server/src/follow.ts
  function offView(figma2, last) {
    const vp = figma2.viewport;
    const z = vp.zoom;
    return figma2.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 5e-3 || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
  }
  async function followIn(figma2, ids, last, screensOnly) {
    const MAX_ZOOM = 2;
    const MIN_ZOOM = 0.5;
    const TALL_ZOOM = 1;
    const MARGIN = 0.84;
    const READABLE = 0.9;
    if (typeof figma2 === "undefined" || !figma2 || !figma2.getNodeByIdAsync) return { status: "noapi" };
    const vp = figma2.viewport;
    const read = (targets2) => ({ page: figma2.currentPage.id, targets: targets2, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
    if (last && offView(figma2, last)) return { status: "moved" };
    const all0 = await Promise.all(ids.map((id) => figma2.getNodeByIdAsync(id).catch(() => null)));
    const found = all0.filter((n) => !!n && !n.removed && n.type !== "PAGE" && n.type !== "DOCUMENT" && !!n.absoluteBoundingBox);
    if (!found.length) return { status: "nonode" };
    const pageOf = (n) => {
      let p = n;
      while (p && p.type !== "PAGE") p = p.parent;
      return p;
    };
    const page = pageOf(found[0]);
    if (!page) return { status: "nonode" };
    const onPage = found.filter((n) => pageOf(n) === page);
    const screenOf = (n) => {
      let p = n;
      while (p.parent && p.parent.type !== "PAGE" && p.parent.type !== "SECTION") p = p.parent;
      return p;
    };
    const all = [];
    for (const n of onPage) {
      const s = screenOf(n);
      if (all.indexOf(s) < 0) all.push(s);
    }
    const screens = all.filter((s) => s.type !== "SECTION");
    if (!screens.length && screensOnly) return { status: "nonode" };
    const picked = screens.length ? screens : all;
    const targets = picked.length > 3 ? picked.slice(0, 1) : picked;
    const key = targets.map((t) => t.id).join(",");
    const within2 = (a, b2) => {
      for (let p = a.parent; p; p = p.parent) if (p === b2) return true;
      return false;
    };
    const tips = onPage.filter((n) => !onPage.some((m) => m !== n && within2(m, n)));
    const deepest = tips.slice(0, 20);
    const select = () => {
      try {
        figma2.currentPage.selection = deepest;
      } catch (e) {
      }
    };
    const parts = tips.filter((n) => targets.some((t) => t === n || within2(n, t)));
    const boxes = (parts.length ? parts : targets).map((t) => t.absoluteBoundingBox);
    const x0 = Math.min(...boxes.map((b2) => b2.x));
    const y0 = Math.min(...boxes.map((b2) => b2.y));
    const x1 = Math.max(...boxes.map((b2) => b2.x + b2.width));
    const y1 = Math.max(...boxes.map((b2) => b2.y + b2.height));
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const w = vp.bounds.width * vp.zoom;
    const h = vp.bounds.height * vp.zoom;
    const fit = Math.min(w / bw, h / bh) * MARGIN;
    let zoom = Math.min(MAX_ZOOM, fit);
    let center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    if (fit < MIN_ZOOM) {
      zoom = Math.max(MIN_ZOOM, Math.min(TALL_ZOOM, w / bw * MARGIN));
      const vw = w / zoom;
      const vh = h / zoom;
      const pad = vh * (1 - MARGIN) / 2;
      center = { x: bw * zoom <= w * MARGIN ? center.x : x0 - pad + vw / 2, y: y0 - pad + vh / 2 };
    }
    const b = vp.bounds;
    if (figma2.currentPage.id === page.id && vp.zoom >= Math.min(zoom, 1) * READABLE && x0 >= b.x && y0 >= b.y && x1 <= b.x + b.width && y1 <= b.y + b.height) {
      select();
      return { status: "shown", view: read(key) };
    }
    if (figma2.currentPage.id !== page.id) await figma2.setCurrentPageAsync(page);
    vp.zoom = Math.max(0.02, zoom);
    vp.center = center;
    select();
    return { status: "ok", view: read(key) };
  }
  function viewWatch(figma2, onMoved) {
    let left = null;
    let busy = 0;
    return {
      async run(fn) {
        busy++;
        try {
          return await fn();
        } finally {
          busy--;
        }
      },
      left(view) {
        left = view;
      },
      get view() {
        return left;
      },
      check() {
        if (busy || !left || !offView(figma2, left)) return false;
        left = null;
        onMoved();
        return true;
      }
    };
  }

  // figma-plugin/code.ts
  var SIZE = { w: 280, h: 148 };
  var SMALL = { w: 280, h: 48 };
  figma.showUI(__html__, { width: SIZE.w, height: SIZE.h, title: "Design Studio", themeColors: true });
  var api = figma;
  var STALL_MS = 6e3;
  var within = (p, ms) => new Promise((r) => {
    const t = setTimeout(() => r("stalled"), ms);
    p.then((v) => {
      clearTimeout(t);
      r(v);
    }, () => {
      clearTimeout(t);
      r("stalled");
    });
  });
  var watch = viewWatch(api, () => figma.ui.postMessage({ t: "moved" }));
  var fileKey = () => {
    try {
      return typeof figma.fileKey === "string" ? figma.fileKey : null;
    } catch (e) {
      return null;
    }
  };
  var hello = () => figma.ui.postMessage({ t: "hello", fileKey: fileKey(), fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name });
  figma.ui.onmessage = async (m) => {
    if (!m || typeof m !== "object") return;
    if (m.t === "ready") hello();
    else if (m.t === "ping") figma.ui.postMessage({ t: "pong" });
    else if (m.t === "follow" && typeof m.id === "number" && Array.isArray(m.ids)) {
      let result = null;
      try {
        const ids = m.ids.filter((id) => typeof id === "string").slice(0, 200);
        const r = await watch.run(() => {
          var _a;
          return within(followIn(api, ids, (_a = m.last) != null ? _a : null, m.start === true), STALL_MS);
        });
        result = r === "stalled" ? { status: "stalled" } : r;
        if (result.view) watch.left(result.view);
        else if (result.status === "moved") watch.left(null);
      } catch (e) {
        result = null;
      }
      figma.ui.postMessage({ t: "result", id: m.id, result });
    } else if (m.t === "focus" && typeof m.id === "number" && typeof m.nodeId === "string") {
      let status = "nonode";
      try {
        status = await watch.run(async () => {
          const n = await figma.getNodeByIdAsync(m.nodeId);
          if (!n || n.type === "DOCUMENT") return "nonode";
          let p = n;
          while (p && p.type !== "PAGE") p = p.parent;
          if (p && figma.currentPage !== p) await figma.setCurrentPageAsync(p);
          if (n.type !== "PAGE") figma.viewport.scrollAndZoomIntoView([n]);
          return "ok";
        });
      } catch (e) {
        status = "nonode";
      }
      watch.left(null);
      figma.ui.postMessage({ t: "result", id: m.id, result: { status } });
    } else if (m.t === "editing") {
      editing = m.on === true;
      if (editing) listen();
      else unlisten();
    } else if (m.t === "forget") watch.left(null);
    else if (m.t === "small") {
      const s = m.on ? SMALL : SIZE;
      figma.ui.resize(s.w, s.h);
    }
  };
  var editing = false;
  var changes = [];
  var sendTimer = null;
  var GATHER_MS = 200;
  var MAX_IDS = 40;
  var onNodeChange = (e) => {
    var _a;
    if (!editing) return;
    for (const c of (_a = e == null ? void 0 : e.nodeChanges) != null ? _a : []) if (c && c.type !== "DELETE" && typeof c.id === "string") changes.push(c.id);
    if (changes.length > 400) changes = changes.slice(-MAX_IDS);
    if (!sendTimer && changes.length) sendTimer = setTimeout(sendChanges, GATHER_MS);
  };
  function sendChanges() {
    sendTimer = null;
    const ids = editing ? [...new Set(changes.reverse())].slice(0, MAX_IDS) : [];
    changes = [];
    if (ids.length) figma.ui.postMessage({ t: "changed", ids });
  }
  var listened = null;
  function listen() {
    if (listened === figma.currentPage) return;
    unlisten();
    try {
      figma.currentPage.on("nodechange", onNodeChange);
      listened = figma.currentPage;
    } catch (e) {
    }
  }
  function unlisten() {
    try {
      listened == null ? void 0 : listened.off("nodechange", onNodeChange);
    } catch (e) {
    }
    listened = null;
  }
  setInterval(() => watch.check(), 400);
  figma.on("currentpagechange", () => {
    watch.check();
    if (editing) listen();
    figma.ui.postMessage({ t: "page", pageId: figma.currentPage.id, pageName: figma.currentPage.name });
  });
})();
