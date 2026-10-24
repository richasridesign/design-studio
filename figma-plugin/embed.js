(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
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
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // server/src/follow.ts
  function offView(figma, last) {
    const vp = figma.viewport;
    const z = vp.zoom;
    return figma.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 5e-3 || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
  }
  async function followIn(figma, ids2, last, screensOnly) {
    const MAX_ZOOM = 2;
    const MIN_ZOOM = 0.5;
    const TALL_ZOOM = 1;
    const MARGIN = 0.84;
    const READABLE = 0.9;
    if (typeof figma === "undefined" || !figma || !figma.getNodeByIdAsync) return { status: "noapi" };
    const vp = figma.viewport;
    const read = (targets2) => ({ page: figma.currentPage.id, targets: targets2, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
    if (last && offView(figma, last)) return { status: "moved" };
    const all0 = await Promise.all(ids2.map((id) => figma.getNodeByIdAsync(id).catch(() => null)));
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

  // figma-plugin/reads.ts
  var ids = (v, max) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, max) : [];
  var word = (v, fallback) => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : fallback;
  async function outline(figma) {
    const pages = [];
    for (const page of figma.root.children) {
      await page.loadAsync();
      const frames = [];
      for (const n of page.children) {
        if (["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(n.type)) frames.push([n.id, String(n.name).slice(0, 200), n.type, Math.round(n.width), Math.round(n.height)]);
      }
      pages.push([page.id, String(page.name).slice(0, 200), frames]);
    }
    return pages;
  }
  async function map(figma) {
    const r = (v) => Math.round(Number(v || 0));
    const nm = (n, k = 90) => String(n.name == null ? "" : n.name).slice(0, k);
    const LETTER = { SECTION: "S", FRAME: "F", COMPONENT: "C", COMPONENT_SET: "K", INSTANCE: "I", GROUP: "G" };
    const isScreen = (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "COMPONENT_SET" || n.type === "GROUP" || n.type === "INSTANCE" && n.width >= 900;
    const isBox = (n) => n.type === "SECTION" || n.type === "FRAME" && n.children.some((c) => c.type === "SECTION");
    function walk(n, depth) {
      const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
      const row = [LETTER[n.type] || n.type, n.id, nm(n), r(b.x), r(b.y), r(b.width), r(b.height)];
      if (isBox(n) && depth < 6) {
        const kids = [];
        let other = 0;
        for (const c of n.children) {
          if (c.type === "SECTION" || isScreen(c)) kids.push(walk(c, depth + 1));
          else other++;
        }
        row.push(kids, other);
        if (n.type === "SECTION") {
          let tag = null;
          try {
            const kind = n.getSharedPluginData("designstudio", "kind");
            if (kind) tag = kind + ";" + n.getSharedPluginData("designstudio", "iteration") + ";" + n.getSharedPluginData("designstudio", "flow");
          } catch (e) {
          }
          row.push(tag);
        }
      }
      return row;
    }
    const pages = [];
    const sets = [];
    const comps = [];
    for (const page of figma.root.children) {
      await page.loadAsync();
      const top = [];
      for (const n of page.children) if (n.type === "SECTION" || isScreen(n)) top.push(walk(n, 0));
      const starts = (page.flowStartingPoints || []).map((s) => [s.nodeId, String(s.name).slice(0, 80)]);
      pages.push([page.id, nm(page, 120), top, starts]);
      for (const s of page.findAllWithCriteria({ types: ["COMPONENT_SET"] })) {
        let defs = [];
        try {
          const d = s.componentPropertyDefinitions;
          defs = Object.keys(d).map((k) => [k, d[k].type, d[k].type === "VARIANT" ? (d[k].variantOptions || []).slice(0, 30) : []]);
        } catch (e) {
        }
        const hasState = defs.some((d) => d[1] === "VARIANT" && /state|interaction/i.test(d[0]));
        const variants = hasState ? s.children.slice(0, 120).map((c) => [c.id, nm(c, 160)]) : [];
        sets.push([s.id, nm(s), nm(page, 60), defs, variants]);
      }
      for (const c of page.findAllWithCriteria({ types: ["COMPONENT"] })) if (!c.parent || c.parent.type !== "COMPONENT_SET") comps.push([c.id, nm(c), nm(page, 60)]);
    }
    const collections = {};
    for (const c of await figma.variables.getLocalVariableCollectionsAsync()) collections[c.id] = c.name;
    const vars = (await figma.variables.getLocalVariablesAsync()).slice(0, 1500).map((v) => [v.id, v.name, v.resolvedType, collections[v.variableCollectionId] || ""]);
    const styles = [];
    for (const s of await figma.getLocalTextStylesAsync()) styles.push([s.id, s.name, "text " + (typeof s.fontSize === "number" ? s.fontSize : "")]);
    for (const s of await figma.getLocalPaintStylesAsync()) styles.push([s.id, s.name, "paint"]);
    for (const s of await figma.getLocalEffectStylesAsync()) styles.push([s.id, s.name, "effect"]);
    return { pages, sets, comps, vars, styles };
  }
  async function kit(figma) {
    var _a;
    const hex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const colName = {};
    const modeOf = {};
    for (const c of cols) {
      colName[c.id] = c.name;
      modeOf[c.id] = c.defaultModeId;
    }
    const variables = [];
    for (const v of (await figma.variables.getLocalVariablesAsync()).slice(0, 600)) {
      let val = v.valuesByMode[modeOf[v.variableCollectionId]];
      if (val && val.type === "VARIABLE_ALIAS") {
        const t = await figma.variables.getVariableByIdAsync(val.id);
        val = t ? (_a = t.valuesByMode[modeOf[t.variableCollectionId]]) != null ? _a : Object.values(t.valuesByMode)[0] : null;
      }
      if (v.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: "COLOR", value: hex(val) });
      else if (v.resolvedType === "FLOAT" && typeof val === "number") variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: "FLOAT", value: val });
    }
    const paints = (await figma.getLocalPaintStylesAsync()).slice(0, 200).map((s) => {
      const p = s.paints[0];
      return { name: s.name, hex: p && p.type === "SOLID" ? hex(p.color) : null };
    });
    const texts = (await figma.getLocalTextStylesAsync()).slice(0, 120).map((s) => ({
      name: s.name,
      family: s.fontName.family,
      style: s.fontName.style,
      size: s.fontSize,
      lineHeight: s.lineHeight.unit === "PIXELS" ? s.lineHeight.value : s.lineHeight.unit === "PERCENT" ? Math.round(s.lineHeight.value) + "%" : "auto"
    }));
    const components = [];
    for (const page of figma.root.children) {
      if (components.length >= 200) break;
      try {
        await page.loadAsync();
      } catch (e) {
        continue;
      }
      let found = [];
      try {
        found = page.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] });
      } catch (e) {
        found = [];
      }
      for (const n of found) {
        if (components.length >= 200) break;
        if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET") continue;
        let variants = [];
        if (n.type === "COMPONENT_SET") {
          try {
            variants = Object.entries(n.componentPropertyDefinitions).filter(([, d]) => d.type === "VARIANT").map(([k, d]) => k + ": " + (d.variantOptions || []).join(" / "));
          } catch (e) {
            variants = [];
          }
        }
        try {
          components.push({ name: n.name, key: n.key, variants, description: n.description || "" });
        } catch (e) {
          components.push({ name: n.name, key: "", variants, description: "" });
        }
      }
    }
    return { file: figma.root.name, variables, paints, texts, components };
  }
  async function containing(figma, args) {
    const out = {};
    const holder = (p) => p.type === "PAGE" || p.type === "DOCUMENT" || p.type === "SECTION" || p.type === "FRAME" && (p.children || []).some((c) => c.type === "SECTION");
    const screen = (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "COMPONENT_SET" || n.type === "GROUP" || n.type === "INSTANCE" && n.width >= 900;
    for (const id of ids(args == null ? void 0 : args.ids, 50)) {
      let n = await figma.getNodeByIdAsync(id);
      while (n && n.parent && !holder(n.parent)) n = n.parent;
      if (n && n.parent && !holder(n) && screen(n)) out[id] = n.id;
    }
    return out;
  }
  async function stickies(figma, args) {
    const list = ids(args == null ? void 0 : args.ids, 200);
    const NS = word(args == null ? void 0 : args.ns, "designstudio_decision");
    const TAG = word(args == null ? void 0 : args.tag, "designstudio");
    const r = (v) => Math.round(Number(v || 0));
    const box = (n) => {
      const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
      return { id: n.id, name: String(n.name || "").slice(0, 120), x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) };
    };
    const cut = (s) => String(s == null ? "" : s).slice(0, 600);
    const DECISION = /^decision( sticky)?$/i;
    const NAMED = /^\s*decision\s*\d+\s*[·•:|-]/i;
    async function stickyOf(n) {
      const screen = n.getSharedPluginData ? n.getSharedPluginData(NS, "screen") : "";
      if (n.type === "STICKY") return { parts: [{ text: cut(n.text && n.text.characters) }], screen };
      if (n.type !== "INSTANCE" && n.type !== "FRAME" && n.type !== "GROUP") return null;
      let isDecision = !!screen || NAMED.test(n.name || "");
      if (n.type === "INSTANCE") {
        const main = await n.getMainComponentAsync();
        const owner = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : main;
        if (owner && DECISION.test(String(owner.name || "").trim())) isDecision = true;
      }
      if (!isDecision) return null;
      const parts = [];
      if (n.type === "INSTANCE") {
        for (const [key, p] of Object.entries(n.componentProperties || {})) if (p && p.type === "TEXT") parts.push({ key, text: cut(p.value) });
      }
      if (!parts.length) for (const t of n.findAll((x) => x.type === "TEXT")) parts.push({ text: cut(t.characters) });
      return { parts, screen };
    }
    const out = { screens: [], stickies: [], missing: [] };
    async function walk(sec, depth) {
      for (const n of sec.children) {
        if (n.type === "SECTION") {
          if (depth < 1) await walk(n, depth + 1);
          continue;
        }
        const s = await stickyOf(n);
        if (s) {
          const num = Number(n.getSharedPluginData ? n.getSharedPluginData(NS, "n") : "") || void 0;
          const it = n.getSharedPluginData ? n.getSharedPluginData(NS, "iteration") : "";
          out.stickies.push(__spreadProps(__spreadValues(__spreadValues(__spreadValues(__spreadValues({}, box(n)), s.screen ? { screen: s.screen } : {}), num ? { n: num } : {}), it ? { iteration: it } : {}), { parts: s.parts }));
          continue;
        }
        if (n.type !== "FRAME" && n.type !== "COMPONENT" && n.type !== "INSTANCE") continue;
        if (/\(entry, unchanged\)/i.test(n.name || "") || n.getSharedPluginData && n.getSharedPluginData(TAG, "kind") === "entry") continue;
        out.screens.push(box(n));
      }
    }
    for (const id of list) {
      const sec = await figma.getNodeByIdAsync(id);
      if (!sec || !("children" in sec)) {
        out.missing.push(id);
        continue;
      }
      await walk(sec, 0);
    }
    return out;
  }
  async function restack(figma, args) {
    const id = ids([args == null ? void 0 : args.id], 1)[0];
    const TAG = word(args == null ? void 0 : args.tag, "designstudio");
    const s = id ? await figma.getNodeByIdAsync(id) : null;
    if (!s || s.type !== "SECTION") return null;
    const box = (n) => {
      const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const kids = s.children.filter((c) => c.type === "SECTION").map((c) => __spreadProps(__spreadValues({ id: c.id }, box(c)), { flow: c.getSharedPluginData(TAG, "flow") || null }));
    const page = s.parent;
    const others = page && page.type === "PAGE" ? page.children.filter((c) => c !== s) : [];
    const belowAll = others.filter((c) => c.y > s.y);
    const below = belowAll.length ? belowAll.reduce((a, b) => b.y < a.y ? b : a) : null;
    const aboveAll = others.filter((c) => c.y < s.y);
    const above = aboveAll.length ? aboveAll.reduce((a, b) => b.y + b.height > a.y + a.height ? b : a) : null;
    return { section: __spreadValues({ id: s.id }, box(s)), kids, below: below ? __spreadValues({ id: below.id }, box(below)) : null, above: above ? __spreadValues({ id: above.id }, box(above)) : null };
  }
  var READS = { outline, map, kit, containing, stickies, restack };
  var READ_NAMES = Object.keys(READS);

  // figma-plugin/agent.ts
  var STALL_MS = 6e3;
  var GATHER_MS = 200;
  var MAX_IDS = 40;
  var PROBE_MS = 2e3;
  var SLICE = 256e3;
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
    const hello = () => post(__spreadValues({ t: "hello", fileKey: fileKey(), fileName: figma.root.name, pageId: figma.currentPage.id, pageName: figma.currentPage.name, reads: READ_NAMES }, extra));
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
      const ids2 = editing ? [...new Set(changes.reverse())].slice(0, MAX_IDS) : [];
      changes = [];
      if (ids2.length) {
        post({ t: "changed", ids: ids2 });
        (_a = hooks.changed) == null ? void 0 : _a.call(hooks, ids2);
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
          const ids2 = m.ids.filter((id) => typeof id === "string").slice(0, 200);
          const r = await watch.run(() => {
            var _a2;
            return within(followIn(api, ids2, (_a2 = m.last) != null ? _a2 : null, m.start === true), STALL_MS);
          });
          result = r === "stalled" ? { status: "stalled" } : r;
          if (result.view) watch.left(result.view);
          else if (result.status === "moved") watch.left(null);
          (_a = hooks.followed) == null ? void 0 : _a.call(hooks, ids2, m.start === true, result);
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
      } else if (m.t === "read" && typeof m.id === "number" && typeof m.name === "string") {
        await read(m.id, m.name, m.args);
      } else if (m.t === "editing") {
        editing = m.on === true;
        if (editing) listen();
        else unlisten();
        (_b = hooks.editing) == null ? void 0 : _b.call(hooks, editing);
      } else if (m.t === "forget") watch.left(null);
    }
    async function read(id, name, args) {
      var _a;
      const fn = Object.prototype.hasOwnProperty.call(READS, name) ? READS[name] : null;
      if (!fn) return post({ t: "readResult", id, error: `no read named ${String(name).slice(0, 40)}` });
      const answered = await within(figma.getNodeByIdAsync(figma.currentPage.id).then(() => true), PROBE_MS);
      if (answered !== true) return post({ t: "readResult", id, error: "stalled" });
      post({ t: "readResult", id, started: true });
      let text;
      try {
        const value = await fn(figma, args && typeof args === "object" ? args : {});
        text = JSON.stringify(value === void 0 ? null : value);
      } catch (err) {
        return post({ t: "readResult", id, error: String((_a = err == null ? void 0 : err.message) != null ? _a : err).slice(0, 300) });
      }
      const parts = Math.max(1, Math.ceil(text.length / SLICE));
      for (let part = 0; part < parts; part++) post({ t: "readResult", id, part, parts, data: text.slice(part * SLICE, (part + 1) * SLICE) });
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
      const map2 = toScreen();
      if (!map2) return;
      if (at) {
        const p = map2.pt(at.x, at.y);
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
        const p = map2.pt(f.box.x, f.box.y);
        f.el.style.transform = `translate(${Math.round(p.x) - 2}px, ${Math.round(p.y) - 2}px)`;
        f.el.style.width = `${Math.max(4, Math.round(f.box.width * map2.sx) + 4)}px`;
        f.el.style.height = `${Math.max(4, Math.round(f.box.height * map2.sy) + 4)}px`;
        if (now > f.until) f.el.style.opacity = "0";
      }
    };
    requestAnimationFrame(tick);
    const boxes = async (ids2) => {
      const page = figma.currentPage;
      const nodes = await Promise.all(ids2.slice(0, 40).map((id) => figma.getNodeByIdAsync(id).catch(() => null)));
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
    async function moveTo(ids2) {
      var _a;
      const nodes = deepest(await boxes(ids2));
      if (!nodes.length) return;
      const b = nodes[0].absoluteBoundingBox;
      const z = ((_a = figma.viewport) == null ? void 0 : _a.zoom) || 1;
      const inset = 16 / z;
      mount();
      glide = !!at;
      at = { x: b.x + Math.min(inset, b.width / 2), y: b.y + Math.min(inset, b.height / 2) };
      lastMove = Date.now();
    }
    let lastFlash = { key: "", at: 0 };
    async function flash(ids2) {
      const key = [...ids2].sort().join(",");
      if (key === lastFlash.key && Date.now() - lastFlash.at < 2e3) return;
      lastFlash = { key, at: Date.now() };
      const nodes = deepest(await boxes(ids2)).slice(0, MAX_FLASH);
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
      async followed(ids2) {
        try {
          await moveTo(ids2);
        } catch (e) {
        }
      },
      /** Changes landed: they flash, and the cursor moves to them. */
      async changed(ids2) {
        try {
          await flash(ids2);
          await moveTo(ids2);
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
        followed: (ids2, start2, result) => {
          var _a;
          if (result.status !== "ok" && result.status !== "shown") return;
          void (start2 ? show.followed(ids2) : show.changed(ids2));
          void screenName(figma, (_a = result.view) == null ? void 0 : _a.targets).then((name) => {
            if (name) post({ t: "screen", name });
          });
        },
        changed: (ids2) => void show.changed(ids2),
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
