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
  function agent(figma, post, fileKey, extra = {}, hooks = {}) {
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
      var _a;
      sendTimer = null;
      const ids = editing ? [...new Set(changes.reverse())].slice(0, MAX_IDS) : [];
      changes = [];
      if (ids.length) {
        post({ t: "changed", ids });
        (_a = hooks.changed) == null ? void 0 : _a.call(hooks, ids);
      }
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
      var _a, _b;
      if (!m || typeof m !== "object") return;
      if (m.t === "ready") hello();
      else if (m.t === "ping") post({ t: "pong" });
      else if (m.t === "follow" && typeof m.id === "number" && Array.isArray(m.ids)) {
        let result = null;
        try {
          const ids = m.ids.filter((id) => typeof id === "string").slice(0, 200);
          const r = await watch.run(() => {
            var _a2;
            return within(followIn(api, ids, (_a2 = m.last) != null ? _a2 : null, m.start === true), STALL_MS);
          });
          result = r === "stalled" ? { status: "stalled" } : r;
          if (result.view) watch.left(result.view);
          else if (result.status === "moved") watch.left(null);
          (_a = hooks.followed) == null ? void 0 : _a.call(hooks, ids, m.start === true, result);
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
        (_b = hooks.editing) == null ? void 0 : _b.call(hooks, editing);
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

  // figma-plugin/overlay.ts
  var PINK = "#D65C89";
  var INK = "#141414";
  var LINGER_MS = 3e3;
  var FLASH_MS = 1e3;
  var IDLE_MS = 8e3;
  var MAX_FLASH = 12;
  function overlay(figma) {
    const reduce = () => {
      try {
        return matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (e) {
        return false;
      }
    };
    const root = document.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;";
    const cursor = document.createElement("div");
    cursor.style.cssText = "position:absolute;left:0;top:0;opacity:0;transition:opacity 200ms ease;will-change:transform;";
    cursor.innerHTML = `<svg width="20" height="22" viewBox="0 0 20 22" style="display:block"><path d="M2 1.5 L2 18 L6.4 13.9 L9.3 20.4 L12.3 19.1 L9.5 12.7 L15.6 12.7 Z" fill="${INK}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span style="position:absolute;left:16px;top:18px;padding:2px 8px;border-radius:999px;background:${PINK};color:#fff;font:500 12px/16px Inter,-apple-system,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">Claude</span>`;
    root.appendChild(cursor);
    const mount = () => {
      if (!root.isConnected && document.body) document.body.appendChild(root);
    };
    let at = null;
    let editing = false;
    let lastMove = 0;
    let hideAt = 0;
    let glide = false;
    const flashes = [];
    const canvas = () => {
      let best = null;
      let area = 0;
      document.querySelectorAll("canvas").forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.width * r.height > area) {
          area = r.width * r.height;
          best = c;
        }
      });
      return best;
    };
    const toScreen = () => {
      var _a;
      const c = canvas();
      const b = (_a = figma.viewport) == null ? void 0 : _a.bounds;
      if (!c || !b || !b.width || !b.height) return null;
      const r = c.getBoundingClientRect();
      const sx = r.width / b.width;
      const sy = r.height / b.height;
      return { pt: (x, y) => ({ x: r.left + (x - b.x) * sx, y: r.top + (y - b.y) * sy }), sx, sy, r };
    };
    const tick = () => {
      requestAnimationFrame(tick);
      const now = Date.now();
      const visible = !!at && (editing || now < hideAt || now - lastMove < IDLE_MS);
      if (!visible && !flashes.length) {
        if (cursor.style.opacity !== "0") cursor.style.opacity = "0";
        return;
      }
      const map = toScreen();
      if (!map) return;
      if (at) {
        const p = map.pt(at.x, at.y);
        cursor.style.transition = `opacity 200ms ease${glide && !reduce() ? ", transform 400ms ease" : ""}`;
        cursor.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        glide = false;
        cursor.style.opacity = visible ? "1" : "0";
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        if (now > f.until + 400) {
          f.el.remove();
          flashes.splice(i, 1);
          continue;
        }
        const p = map.pt(f.box.x, f.box.y);
        f.el.style.transform = `translate(${Math.round(p.x) - 2}px, ${Math.round(p.y) - 2}px)`;
        f.el.style.width = `${Math.max(4, Math.round(f.box.width * map.sx) + 4)}px`;
        f.el.style.height = `${Math.max(4, Math.round(f.box.height * map.sy) + 4)}px`;
        if (now > f.until) f.el.style.opacity = "0";
      }
    };
    requestAnimationFrame(tick);
    const boxes = async (ids) => {
      const page = figma.currentPage;
      const nodes = await Promise.all(ids.slice(0, 40).map((id) => figma.getNodeByIdAsync(id).catch(() => null)));
      const onPage = (n) => {
        for (let p = n; p; p = p.parent) if (p === page) return true;
        return false;
      };
      return nodes.filter((n) => n && !n.removed && n.type !== "PAGE" && n.type !== "DOCUMENT" && n.absoluteBoundingBox && onPage(n));
    };
    const deepest = (nodes) => nodes.filter((n) => !nodes.some((m) => m !== n && (() => {
      for (let p = m.parent; p; p = p.parent) if (p === n) return true;
      return false;
    })()));
    async function moveTo(ids) {
      var _a;
      const nodes = deepest(await boxes(ids));
      if (!nodes.length) return;
      const b = nodes[0].absoluteBoundingBox;
      const z = ((_a = figma.viewport) == null ? void 0 : _a.zoom) || 1;
      const inset = 16 / z;
      mount();
      glide = !!at;
      at = { x: b.x + Math.min(inset, b.width / 2), y: b.y + Math.min(inset, b.height / 2) };
      lastMove = Date.now();
    }
    async function flash(ids) {
      const nodes = deepest(await boxes(ids)).slice(0, MAX_FLASH);
      if (!nodes.length) return;
      mount();
      const until = Date.now() + FLASH_MS;
      for (const n of nodes) {
        const el = document.createElement("div");
        el.style.cssText = `position:absolute;left:0;top:0;border:2px solid ${PINK};border-radius:2px;box-sizing:border-box;opacity:1;transition:opacity 400ms ease;`;
        root.appendChild(el);
        flashes.push({ el, box: __spreadValues({}, n.absoluteBoundingBox), until });
      }
    }
    return {
      /** A follow moved the view (or found it already there): the cursor goes to what it named. */
      async followed(ids) {
        try {
          await moveTo(ids);
        } catch (e) {
        }
      },
      /** Changes landed: they flash, and the cursor moves to them. */
      async changed(ids) {
        try {
          await flash(ids);
          await moveTo(ids);
        } catch (e) {
        }
      },
      editing(on) {
        editing = on;
        if (!on) hideAt = Date.now() + LINGER_MS;
      }
    };
  }

  // figma-plugin/embed.ts
  async function screenName(figma, targets) {
    const id = targets == null ? void 0 : targets.split(",")[0];
    if (!id) return "";
    try {
      const n = await figma.getNodeByIdAsync(id);
      return n && typeof n.name === "string" ? n.name.slice(0, 120) : "";
    } catch (e) {
      return "";
    }
  }
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
      const show = overlay(figma);
      a = agent(figma, post, fileKey, { embed: true }, {
        followed: (ids, start2, result) => {
          var _a;
          if (result.status !== "ok" && result.status !== "shown") return;
          void show.followed(ids);
          void screenName(figma, (_a = result.view) == null ? void 0 : _a.targets).then((name) => {
            if (name) post({ t: "screen", name });
          });
        },
        changed: (ids) => void show.changed(ids),
        editing: (on) => show.editing(on)
      });
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
