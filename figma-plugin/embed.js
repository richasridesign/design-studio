(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // server/src/follow.ts
  function offView(figma, last) {
    const vp = figma.viewport;
    const z = vp.zoom;
    return figma.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 5e-3 || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
  }
  async function followIn(figma, ids, last, screensOnly) {
    const MAX_ZOOM = 2;
    const MIN_ZOOM = 0.5;
    const TALL_ZOOM = 1;
    const MARGIN = 0.84;
    const READABLE = 0.9;
    if (typeof figma === "undefined" || !figma || !figma.getNodeByIdAsync) return { status: "noapi" };
    const vp = figma.viewport;
    const read = (targets2) => ({ page: figma.currentPage.id, targets: targets2, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
    if (last && offView(figma, last)) return { status: "moved" };
    const all0 = await Promise.all(ids.map((id) => figma.getNodeByIdAsync(id).catch(() => null)));
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
    const within = (a, b2) => {
      for (let p = a.parent; p; p = p.parent) if (p === b2) return true;
      return false;
    };
    const tips = onPage.filter((n) => !onPage.some((m) => m !== n && within(m, n)));
    const deepest = tips.slice(0, 20);
    const select = () => {
      try {
        figma.currentPage.selection = deepest;
      } catch (e) {
      }
    };
    const parts = tips.filter((n) => targets.some((t) => t === n || within(n, t)));
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
    if (figma.currentPage.id === page.id && vp.zoom >= Math.min(zoom, 1) * READABLE && x0 >= b.x && y0 >= b.y && x1 <= b.x + b.width && y1 <= b.y + b.height) {
      select();
      return { status: "shown", view: read(key) };
    }
    if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);
    vp.zoom = Math.max(0.02, zoom);
    vp.center = center;
    select();
    return { status: "ok", view: read(key) };
  }
  function viewWatch(figma, onMoved) {
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
        if (busy || !left || !offView(figma, left)) return false;
        left = null;
        onMoved();
        return true;
      }
    };
  }

  // figma-plugin/agent.ts
  var STALL_MS = 6e3;
  var GATHER_MS = 200;
  var MAX_IDS = 40;
  function agent(figma, post, fileKey, extra = {}) {
    const api = figma;
    const within = (p, ms) => new Promise((r) => {
      const t = setTimeout(() => r("stalled"), ms);
      p.then((v) => {
        clearTimeout(t);
        r(v);
      }, () => {
        clearTimeout(t);
        r("stalled");
      });
    });
    const watch = viewWatch(api, () => post({ t: "moved" }));
    const hello = () => post(__spreadValues({ t: "hello", fileKey: fileKey(), fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name }, extra));
    let editing = false;
    let changes = [];
    let sendTimer = null;
    const onNodeChange = (e) => {
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
      if (ids.length) post({ t: "changed", ids });
    }
    let listened = null;
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
    async function onmessage(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "ready") hello();
      else if (m.t === "ping") post({ t: "pong" });
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
        post({ t: "result", id: m.id, result });
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
        post({ t: "result", id: m.id, result: { status } });
      } else if (m.t === "editing") {
        editing = m.on === true;
        if (editing) listen();
        else unlisten();
      } else if (m.t === "forget") watch.left(null);
    }
    setInterval(() => watch.check(), 400);
    try {
      figma.on("currentpagechange", () => {
        watch.check();
        if (editing) listen();
        post({ t: "page", pageId: figma.currentPage.id, pageName: figma.currentPage.name });
      });
    } catch (e) {
    }
    return { onmessage, hello };
  }

  // figma-plugin/embed.ts
  (() => {
    if (window.__dsEmbed) return;
    const post = (m) => {
      try {
        window.webkit.messageHandlers.dsFigma.postMessage(JSON.stringify(m));
      } catch (e) {
      }
    };
    const fileKey = () => {
      var _a, _b;
      return (_b = (_a = location.pathname.match(/^\/(?:design|file)\/([A-Za-z0-9]{10,64})/)) == null ? void 0 : _a[1]) != null ? _b : null;
    };
    let a = null;
    window.__dsEmbed = {
      recv: (m) => {
        if (a) void a.onmessage(m);
      },
      ready: () => a == null ? void 0 : a.hello()
    };
    const start = () => {
      const figma = window.figma;
      if (!figma || !figma.getNodeByIdAsync || !figma.root || !figma.currentPage || !fileKey()) return false;
      a = agent(figma, post, fileKey, { embed: true });
      a.hello();
      return true;
    };
    if (!start()) {
      const t = setInterval(() => {
        if (start()) clearInterval(t);
      }, 500);
    }
  })();
})();
