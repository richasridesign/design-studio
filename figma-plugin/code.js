(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a2, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a2, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a2, prop, b[prop]);
      }
    return a2;
  };
  var __spreadProps = (a2, b) => __defProps(a2, __getOwnPropDescs(b));

  // server/src/follow.ts
  function offView(figma2, last) {
    const vp = figma2.viewport;
    const z = vp.zoom;
    return figma2.currentPage.id !== last.page || Math.abs(z - last.zoom) / last.zoom > 5e-3 || Math.abs(vp.center.x - last.cx) * z > 1.5 || Math.abs(vp.center.y - last.cy) * z > 1.5;
  }
  async function followIn(figma2, ids2, last, screensOnly) {
    const MAX_ZOOM = 2;
    const MIN_ZOOM = 0.5;
    const TALL_ZOOM = 1;
    const MARGIN = 0.84;
    const READABLE = 0.9;
    if (typeof figma2 === "undefined" || !figma2 || !figma2.getNodeByIdAsync) return { status: "noapi" };
    const vp = figma2.viewport;
    const read = (targets2) => ({ page: figma2.currentPage.id, targets: targets2, cx: vp.center.x, cy: vp.center.y, zoom: vp.zoom });
    if (last && offView(figma2, last)) return { status: "moved" };
    const all0 = await Promise.all(ids2.map((id) => figma2.getNodeByIdAsync(id).catch(() => null)));
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
    const within = (a2, b2) => {
      for (let p = a2.parent; p; p = p.parent) if (p === b2) return true;
      return false;
    };
    const tips = onPage.filter((n) => !onPage.some((m) => m !== n && within(m, n)));
    const deepest = tips.slice(0, 20);
    const select = () => {
      try {
        figma2.currentPage.selection = deepest;
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

  // figma-plugin/reads.ts
  var ids = (v, max) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, max) : [];
  var word = (v, fallback) => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : fallback;
  async function outline(figma2) {
    const pages = [];
    for (const page of figma2.root.children) {
      await page.loadAsync();
      const frames = [];
      for (const n of page.children) {
        if (["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(n.type)) frames.push([n.id, String(n.name).slice(0, 200), n.type, Math.round(n.width), Math.round(n.height)]);
      }
      pages.push([page.id, String(page.name).slice(0, 200), frames]);
    }
    return pages;
  }
  async function map(figma2) {
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
    for (const page of figma2.root.children) {
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
    for (const c of await figma2.variables.getLocalVariableCollectionsAsync()) collections[c.id] = c.name;
    const vars = (await figma2.variables.getLocalVariablesAsync()).slice(0, 1500).map((v) => [v.id, v.name, v.resolvedType, collections[v.variableCollectionId] || ""]);
    const styles = [];
    for (const s of await figma2.getLocalTextStylesAsync()) styles.push([s.id, s.name, "text " + (typeof s.fontSize === "number" ? s.fontSize : "")]);
    for (const s of await figma2.getLocalPaintStylesAsync()) styles.push([s.id, s.name, "paint"]);
    for (const s of await figma2.getLocalEffectStylesAsync()) styles.push([s.id, s.name, "effect"]);
    return { pages, sets, comps, vars, styles };
  }
  async function kit(figma2) {
    var _a;
    const hex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
    const cols = await figma2.variables.getLocalVariableCollectionsAsync();
    const colName = {};
    const modeOf = {};
    for (const c of cols) {
      colName[c.id] = c.name;
      modeOf[c.id] = c.defaultModeId;
    }
    const variables = [];
    for (const v of (await figma2.variables.getLocalVariablesAsync()).slice(0, 600)) {
      let val = v.valuesByMode[modeOf[v.variableCollectionId]];
      if (val && val.type === "VARIABLE_ALIAS") {
        const t = await figma2.variables.getVariableByIdAsync(val.id);
        val = t ? (_a = t.valuesByMode[modeOf[t.variableCollectionId]]) != null ? _a : Object.values(t.valuesByMode)[0] : null;
      }
      if (v.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: "COLOR", value: hex(val) });
      else if (v.resolvedType === "FLOAT" && typeof val === "number") variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: "FLOAT", value: val });
    }
    const paints = (await figma2.getLocalPaintStylesAsync()).slice(0, 200).map((s) => {
      const p = s.paints[0];
      return { name: s.name, hex: p && p.type === "SOLID" ? hex(p.color) : null };
    });
    const texts = (await figma2.getLocalTextStylesAsync()).slice(0, 120).map((s) => ({
      name: s.name,
      family: s.fontName.family,
      style: s.fontName.style,
      size: s.fontSize,
      lineHeight: s.lineHeight.unit === "PIXELS" ? s.lineHeight.value : s.lineHeight.unit === "PERCENT" ? Math.round(s.lineHeight.value) + "%" : "auto"
    }));
    const components = [];
    for (const page of figma2.root.children) {
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
    return { file: figma2.root.name, variables, paints, texts, components };
  }
  async function containing(figma2, args) {
    const out = {};
    const holder = (p) => p.type === "PAGE" || p.type === "DOCUMENT" || p.type === "SECTION" || p.type === "FRAME" && (p.children || []).some((c) => c.type === "SECTION");
    const screen = (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "COMPONENT_SET" || n.type === "GROUP" || n.type === "INSTANCE" && n.width >= 900;
    for (const id of ids(args == null ? void 0 : args.ids, 50)) {
      let n = await figma2.getNodeByIdAsync(id);
      while (n && n.parent && !holder(n.parent)) n = n.parent;
      if (n && n.parent && !holder(n) && screen(n)) out[id] = n.id;
    }
    return out;
  }
  async function stickies(figma2, args) {
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
      const sec = await figma2.getNodeByIdAsync(id);
      if (!sec || !("children" in sec)) {
        out.missing.push(id);
        continue;
      }
      await walk(sec, 0);
    }
    return out;
  }
  async function restack(figma2, args) {
    const id = ids([args == null ? void 0 : args.id], 1)[0];
    const TAG = word(args == null ? void 0 : args.tag, "designstudio");
    const s = id ? await figma2.getNodeByIdAsync(id) : null;
    if (!s || s.type !== "SECTION") return null;
    const box = (n) => {
      const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const kids = s.children.filter((c) => c.type === "SECTION").map((c) => __spreadProps(__spreadValues({ id: c.id }, box(c)), { flow: c.getSharedPluginData(TAG, "flow") || null }));
    const page = s.parent;
    const others = page && page.type === "PAGE" ? page.children.filter((c) => c !== s) : [];
    const belowAll = others.filter((c) => c.y > s.y);
    const below = belowAll.length ? belowAll.reduce((a2, b) => b.y < a2.y ? b : a2) : null;
    const aboveAll = others.filter((c) => c.y < s.y);
    const above = aboveAll.length ? aboveAll.reduce((a2, b) => b.y + b.height > a2.y + a2.height ? b : a2) : null;
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
  function agent(figma2, post, fileKey2, extra = {}, hooks = {}) {
    const api = figma2;
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
    const hello = () => post(__spreadValues({ t: "hello", fileKey: fileKey2(), fileName: figma2.root.name, pageId: figma2.currentPage.id, pageName: figma2.currentPage.name, reads: READ_NAMES }, extra));
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
      if (listened === figma2.currentPage) return;
      unlisten();
      try {
        figma2.currentPage.on("nodechange", onNodeChange);
        listened = figma2.currentPage;
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
            const n = await figma2.getNodeByIdAsync(m.nodeId);
            if (!n || n.type === "DOCUMENT") return "nonode";
            let p = n;
            while (p && p.type !== "PAGE") p = p.parent;
            if (p && figma2.currentPage !== p) await figma2.setCurrentPageAsync(p);
            if (n.type !== "PAGE") figma2.viewport.scrollAndZoomIntoView([n]);
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
      const answered = await within(figma2.getNodeByIdAsync(figma2.currentPage.id).then(() => true), PROBE_MS);
      if (answered !== true) return post({ t: "readResult", id, error: "stalled" });
      post({ t: "readResult", id, started: true });
      let text;
      try {
        const value = await fn(figma2, args && typeof args === "object" ? args : {});
        text = JSON.stringify(value === void 0 ? null : value);
      } catch (err) {
        return post({ t: "readResult", id, error: String((_a = err == null ? void 0 : err.message) != null ? _a : err).slice(0, 300) });
      }
      const parts = Math.max(1, Math.ceil(text.length / SLICE));
      for (let part = 0; part < parts; part++) post({ t: "readResult", id, part, parts, data: text.slice(part * SLICE, (part + 1) * SLICE) });
    }
    setInterval(() => watch.check(), 400);
    try {
      figma2.on("currentpagechange", () => {
        watch.check();
        if (editing) listen();
        post({ t: "page", pageId: figma2.currentPage.id, pageName: figma2.currentPage.name });
      });
    } catch (e) {
    }
    return { onmessage, hello };
  }

  // figma-plugin/code.ts
  var SIZE = { w: 280, h: 148 };
  var SMALL = { w: 280, h: 48 };
  figma.showUI(__html__, { width: SIZE.w, height: SIZE.h, title: "Design Studio", themeColors: true });
  var fileKey = () => {
    try {
      return typeof figma.fileKey === "string" ? figma.fileKey : null;
    } catch (e) {
      return null;
    }
  };
  var a = agent(figma, (m) => figma.ui.postMessage(m), fileKey);
  figma.ui.onmessage = (m) => {
    if (m && m.t === "small") {
      const s = m.on ? SMALL : SIZE;
      figma.ui.resize(s.w, s.h);
    } else void a.onmessage(m);
  };
})();
