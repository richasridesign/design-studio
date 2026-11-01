// Helpers that Design Studio puts in front of every use_figma script that uses them, so Claude's edit scripts stay
// short and the usual slips (a null node, an unloaded font, a hover that points at the wrong variant) fail with a
// plain message instead. Claude calls them as DS.<name>, and the PreToolUse hook adds them to the scripts that do.
// use_figma does not support figma.saveVersionHistoryAsync (it throws "not a supported API"), so no version is saved.

/** Plain Plugin API JavaScript. Defines one constant, DS. Read only until a helper that edits is called. */
export const FIGMA_KIT = `const DS = (() => {
  const norm = (id) => String(id).replace('-', ':');
  const short = (s, n = 60) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const sure = (n, what) => {
    if (n && typeof n.then === 'function') throw new Error(what + ' got a Promise: write await DS.node(id) first.');
    if (typeof n === 'string') throw new Error(what + ' needs a node, not an id: use await DS.node("' + n + '").');
    if (!n) throw new Error(what + ' got no node.');
    return n;
  };
  const get = async (x) => (x && typeof x.then === 'function' ? await x : typeof x === 'string' ? await node(x) : x);
  const box = (n) => { sure(n, 'DS.box'); const b = n.absoluteBoundingBox || { x: n.x || 0, y: n.y || 0, width: n.width || 0, height: n.height || 0 }; return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const pageOf = (n) => { while (n && n.type !== 'PAGE') n = n.parent; return n; };
  async function node(id) {
    const n = await figma.getNodeByIdAsync(norm(id));
    if (!n) throw new Error('Node ' + id + ' does not exist. It may be newer than the file map or deleted: look it up by name with DS.find.');
    const p = pageOf(n);
    if (p && p !== figma.currentPage && p.loadAsync) await p.loadAsync();
    return n;
  }
  async function page(id) { const n = await node(id); const p = pageOf(n); if (p && p !== figma.currentPage) await figma.setCurrentPageAsync(p); return n; }
  // figma.createSection() lands on the current page, which is the first page in every call: make it on the named page.
  async function section(pg, name, props = {}) {
    pg = pg && pg.type === 'PAGE' ? pg : figma.root.children.find((p) => p.id === norm(pg) || p.name === String(pg));
    if (!pg) throw new Error('DS.section: no page named or with id ' + short(String(arguments[0])) + '. Pages: ' + figma.root.children.map((p) => p.name).join(', ') + '.');
    if (pg !== figma.currentPage) await figma.setCurrentPageAsync(pg);
    name = String(name || '').trim();
    if (!name) throw new Error('DS.section needs a name, like "V0.5 · Flow 2 · Connectors · Sat 24 Oct 2026".');
    let s = pg.children.find((k) => k.type === 'SECTION' && k.name === name);
    if (!s) { s = figma.createSection(); pg.appendChild(s); s.name = name; s.resizeWithoutConstraints(props.width || 1600, props.height || 1200); }
    else if (props.width || props.height) s.resizeWithoutConstraints(props.width || s.width, props.height || s.height);
    if (props.below) { const b = box(await get(props.below)); moveTo(s, b[0], b[1] + b[3] + (props.gap == null ? 400 : props.gap)); }
    else if (props.x != null || props.y != null) moveTo(s, props.x == null ? s.x : props.x, props.y == null ? s.y : props.y);
    if (props.fills) s.fills = props.fills;
    return s;
  }
  function matcher(m) {
    if (typeof m === 'function') return m;
    if (m instanceof RegExp) return (n) => m.test(n.name);
    const s = String(m);
    if (s.startsWith('~')) { const t = s.slice(1).toLowerCase(); return (n) => String(n.name).toLowerCase().includes(t); }
    return (n) => n.name === s;
  }
  // { where: true } gives [{ id, name, type, text, where }] instead of nodes. A text layer as root is searched as itself.
  function find(root, m, type, opts) {
    if (type && typeof type === 'object' && !Array.isArray(type)) { opts = type; type = null; }
    sure(root, 'DS.find');
    const ok = matcher(m);
    const types = type ? [].concat(type) : null;
    const list = !('children' in root) ? [root].filter((n) => !types || types.includes(n.type)) : types && root.findAllWithCriteria ? root.findAllWithCriteria({ types }) : root.findAll(() => true);
    return found(list.filter((n) => ok(n)), opts);
  }
  function one(root, m, type) {
    const hit = find(root, m, type && typeof type === 'object' && !Array.isArray(type) ? null : type);
    if (!hit.length) throw new Error('Nothing named ' + String(m) + (type ? ' (' + type + ')' : '') + ' inside ' + root.name + ' (' + root.id + ').');
    return hit[0];
  }
  function texts(root, m, opts) {
    sure(root, 'DS.texts');
    const ok = typeof m === 'function' ? m : m instanceof RegExp ? (t) => m.test(t) : (t) => t.includes(String(m));
    const list = root.type === 'TEXT' ? [root] : root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['TEXT'] }) : [];
    return found(list.filter((t) => ok(t.characters)), opts);
  }
  async function fonts(t) {
    const list = t.characters.length ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    for (const f of list) if (f && typeof f === 'object') await figma.loadFontAsync(f);
  }
  // DS.setText(text, chars), or DS.setText(root, name|"~part"|/re/, chars) to look the layer up by name, then by its text.
  async function setText(t, a, b) {
    let chars = a;
    if (arguments.length >= 3) {
      const root = sure(await get(t), 'DS.setText');
      const all = root.type === 'TEXT' ? [root] : root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['TEXT'] }) : [];
      const ok = matcher(a);
      const byText = a instanceof RegExp ? (x) => a.test(x.characters) : typeof a === 'function' ? () => false : String(a).startsWith('~') ? (x) => x.characters.toLowerCase().includes(String(a).slice(1).toLowerCase()) : (x) => x.characters === String(a);
      t = all.find(ok) || all.find(byText);
      if (!t) throw new Error('DS.setText: no text layer named or reading ' + short(String(a)) + ' inside ' + root.name + ' (' + root.id + '). List its text layers with DS.tree or DS.texts.');
      chars = b;
    } else {
      if (t == null) throw new Error('DS.setText got ' + t + ' instead of a text layer: the lookup before it found nothing. Check that lookup, or call DS.setText(parent, "layer name or text", "new text") so the message names what is missing.');
      t = await get(t);
    }
    if (t.type !== 'TEXT') throw new Error(t.name + ' (' + t.id + ') is a ' + t.type + ', not a text layer.');
    await fonts(t);
    t.characters = String(chars);
    return t;
  }
  function hoverOf(main) {
    const set = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
    if (!set) return null;
    const props = main.variantProperties || {};
    const keys = Object.keys(props).filter((k) => /state|interaction/i.test(k));
    for (const k of keys) {
      const hit = set.children.find((c) => {
        const p = c.variantProperties || {};
        if (!/hover/i.test(String(p[k]))) return false;
        return Object.keys(props).every((o) => o === k || p[o] === props[o]);
      });
      if (hit) return hit === main ? null : hit;
    }
    return null;
  }
  const plain = (r) => ({ trigger: r.trigger, actions: r.actions && r.actions.length ? r.actions : r.action ? [r.action] : [] });
  // States that never change to Hover: a Disabled control has no hover, press or click (a tooltip overlay on hover
  // is the one exception), and a selected, pressed, focused, open or working one keeps its look under the pointer.
  const stateOf = (main) => { const p = (main && main.variantProperties) || {}; const k = Object.keys(p).find((x) => /state|interaction/i.test(x)); return k ? String(p[k]).trim().toLowerCase() : ''; };
  const flag = (main, re) => { const p = (main && main.variantProperties) || {}; return Object.keys(p).some((k) => re.test(k) && /^(true|yes|on)$/i.test(String(p[k]))); };
  const isDisabled = (main) => /^disabled/.test(stateOf(main)) || flag(main, /^disabled$/i);
  const quiet = (main) => isDisabled(main) || /^(selected|pressed|focus|focused|open|working|loading|typing)\\b/.test(stateOf(main)) || flag(main, /^selected$/i);
  const tooltipOnly = (r) => { const p = plain(r); const t = p.trigger && p.trigger.type; return /^(ON_HOVER|MOUSE_ENTER|MOUSE_LEAVE)$/.test(t) && p.actions.length > 0 && p.actions.every((a) => a.type === 'CLOSE' || a.navigation === 'OVERLAY'); };
  async function wireHover(inst) {
    inst = await get(inst);
    if (inst.type !== 'INSTANCE') return null;
    const main = await inst.getMainComponentAsync();
    if (main && quiet(main)) {
      // Drop a hover left over from the state it was switched from, keep tooltip overlays and clicks.
      const set = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
      const ids = new Set(set ? set.children.map((c) => c.id) : []);
      const all = inst.reactions || [];
      const keep = all.filter((r) => !(r.trigger && r.trigger.type === 'ON_HOVER' && plain(r).actions.some((a) => a.navigation === 'CHANGE_TO' && ids.has(a.destinationId))));
      if (keep.length !== all.length) await inst.setReactionsAsync(keep.map(plain));
      return null;
    }
    const hover = hoverOf(main);
    if (!hover) return null;
    const keep = (inst.reactions || []).filter((r) => !(r.trigger && r.trigger.type === 'ON_HOVER')).map(plain);
    keep.push({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: hover.id, navigation: 'CHANGE_TO', transition: null }] });
    await inst.setReactionsAsync(keep);
    return hover.id;
  }
  async function setVariant(inst, props) {
    inst = await get(inst);
    if (inst.type !== 'INSTANCE') throw new Error(inst.name + ' (' + inst.id + ') is a ' + inst.type + ', not an instance.');
    inst.setProperties(props);
    await wireHover(inst);
    return inst;
  }
  function moveTo(n, x, y) {
    sure(n, 'DS.moveTo');
    const p = n.parent;
    const t = p && p.type !== 'PAGE' && p.absoluteTransform ? p.absoluteTransform : [[1, 0, 0], [0, 1, 0]];
    n.x = Math.round(x - t[0][2]);
    n.y = Math.round(y - t[1][2]);
    return n;
  }
  function placeBelow(n, ref, gap = 96) { const b = box(ref); return moveTo(n, b[0], b[1] + b[3] + gap); }
  function placeRight(n, ref, gap = 160) { const b = box(ref); return moveTo(n, b[0] + b[2] + gap, b[1]); }
  function clone(screen, opts = {}) {
    sure(screen, 'DS.clone');
    const c = screen.clone();
    // A clone lands on the current page, which is the first page in every call: put it next to the original.
    if (opts.parent) opts.parent.appendChild(c);
    else screen.parent.insertChild(screen.parent.children.indexOf(screen) + 1, c);
    if (opts.name) c.name = opts.name;
    if (opts.below) placeBelow(c, screen, opts.gap == null ? 160 : opts.gap); else placeRight(c, screen, opts.gap == null ? 160 : opts.gap);
    return c;
  }
  function fit(section, pad = 320) {
    sure(section, 'DS.fit');
    const kids = section.children.filter((k) => k.visible !== false);
    if (!kids.length) return section;
    const s = box(section);
    let r = 0, b = 0;
    for (const k of kids) { const x = box(k); r = Math.max(r, x[0] + x[2] - s[0]); b = Math.max(b, x[1] + x[3] - s[1]); }
    section.resizeWithoutConstraints(Math.max(s[2], r + pad), Math.max(s[3], b + pad));
    return section;
  }
  const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  function overlaps(parent) {
    sure(parent, 'DS.overlaps');
    const kids = parent.children.filter((k) => k.visible !== false && k.type !== 'TEXT');
    const out = [];
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(box(kids[i]), box(kids[j]))) out.push([kids[i].id, kids[j].id]);
    return out.slice(0, 40);
  }
  async function check(list) {
    const out = { hoverMissing: [], hoverWrong: [], disabledReacts: [], outside: [], overlaps: [], fewStickies: [] };
    const seen = new Set();
    for (const id of [].concat(list)) {
      const root = await get(id);
      const instances = root.type === 'INSTANCE' ? [root] : root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : [];
      for (const inst of instances.slice(0, 400)) {
        if (inst.visible === false) continue;
        const main = await inst.getMainComponentAsync();
        if (isDisabled(main)) {
          const bad = (inst.reactions || []).filter((r) => !tooltipOnly(r));
          if (bad.length) out.disabledReacts.push([inst.id, short(inst.name, 40), bad.map((r) => (r.trigger && r.trigger.type) || '?').join(' ')]);
          continue;
        }
        if (quiet(main)) continue;
        const hover = hoverOf(main);
        if (!hover) continue;
        const r = (inst.reactions || []).find((x) => x.trigger && x.trigger.type === 'ON_HOVER');
        const dest = r ? plain(r).actions.map((a) => a.destinationId).find(Boolean) : null;
        if (!r) out.hoverMissing.push([inst.id, short(inst.name, 40)]);
        else if (dest !== hover.id) out.hoverWrong.push([inst.id, short(inst.name, 40), dest, hover.id]);
      }
      if ('children' in root && root.type !== 'PAGE') {
        const b = box(root);
        for (const k of root.children) {
          if (k.visible === false) continue;
          const x = box(k);
          if (x[0] < b[0] - 1 || x[1] < b[1] - 1 || x[0] + x[2] > b[0] + b[2] + 1 || x[1] + x[3] > b[1] + b[3] + 1) out.outside.push([k.id, short(k.name, 40)]);
        }
      }
      const p = root.parent;
      if (p && p.type === 'SECTION' && (root.type === 'FRAME' || root.type === 'COMPONENT') && !/\\(entry, unchanged\\)/i.test(String(root.name)) && !(optionId(p) && firstScreen(p) !== root)) {
        const count = stickiesOf(root).length;
        if (count < 3) out.fewStickies.push([root.id, short(root.name, 40), count]);
      }
      if (p && p.type === 'SECTION' && !seen.has(p.id)) { seen.add(p.id); out.overlaps.push(...overlaps(p).filter((pair) => pair.includes(root.id))); }
    }
    for (const k of Object.keys(out)) out[k] = out[k].slice(0, 30);
    out.ok = !out.hoverMissing.length && !out.hoverWrong.length && !out.disabledReacts.length && !out.outside.length && !out.overlaps.length && !out.fewStickies.length;
    return out;
  }
  // Decision stickies: the what and why of an iteration, 3 to 5 right below each screen. Tagged with plugin data
  // (namespace designstudio_decision: iteration, screen, n) so Design Studio copies them into the flow's history file.
  const DNS = 'designstudio_decision';
  const DECISION_COMP = /^decision( sticky)?$/i;
  const stickyName = (n, screen) => 'Decision ' + n + ' · ' + screen.name;
  async function decisionMain(screen) {
    const ok = (c) => DECISION_COMP.test(String(c.name).trim()) && !(c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET');
    const look = (root) => (root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }) : []).find(ok);
    let hit = look(pageOf(screen) || figma.currentPage);
    // Other pages one by one (the MCP cannot load every page at once), stopping at the first hit.
    for (const pg of hit ? [] : figma.root.children) {
      if (pg === (pageOf(screen) || figma.currentPage)) continue;
      if (pg.loadAsync) await pg.loadAsync();
      hit = look(pg);
      if (hit) break;
    }
    if (!hit) throw new Error('No Decision sticky component: make one first (a local component or component set named "Decision").');
    return hit.type === 'COMPONENT_SET' ? hit.defaultVariant || hit.children[0] : hit;
  }
  function stickiesOf(screen) {
    const p = screen.parent;
    if (!p || !p.children) return [];
    const named = /^\\s*decision\\s*(\\d+)\\s*·\\s*(.*)$/i;
    const out = [];
    for (const k of p.children) {
      if (k === screen) continue;
      const tagged = k.getSharedPluginData ? k.getSharedPluginData(DNS, 'screen') : '';
      const m = named.exec(String(k.name));
      const n = Number(k.getSharedPluginData ? k.getSharedPluginData(DNS, 'n') : '') || (m ? Number(m[1]) : 0);
      if (tagged === screen.id || (!tagged && m && m[2].trim() === String(screen.name).trim())) out.push({ node: k, n, iteration: k.getSharedPluginData ? k.getSharedPluginData(DNS, 'iteration') : '' });
    }
    return out.sort((a, b) => a.n - b.n);
  }
  function asItem(x) {
    if (x && typeof x === 'object') return { decision: String(x.decision || x.what || '').trim(), why: String(x.why || '').replace(/^\\s*why\\s*:\\s*/i, '').trim() };
    const parts = String(x).split(/\\s*why\\s*:\\s*/i);
    return { decision: parts[0].trim(), why: parts.slice(1).join(' ').trim() };
  }
  async function fillSticky(inst, item, n) {
    for (const t of inst.findAll ? inst.findAll((x) => x.type === 'TEXT') : []) await fonts(t);
    const why = item.why ? 'Why: ' + item.why : '';
    const props = inst.componentProperties || {};
    const keys = Object.keys(props).filter((k) => props[k].type === 'TEXT');
    const whyKey = keys.find((k) => /why|reason/i.test(k));
    const label = keys.find((k) => k !== whyKey && /^label|number|^decision\\s*n/i.test(k));
    const main = keys.find((k) => k !== whyKey && k !== label && /decision|title|heading|text|body/i.test(k)) || keys.find((k) => k !== whyKey && k !== label);
    if (main) {
      const set = {};
      set[main] = whyKey ? item.decision : item.decision + (why ? '\\n' + why : '');
      if (whyKey) set[whyKey] = why;
      if (label) set[label] = 'Decision ' + n;
      inst.setProperties(set);
      return;
    }
    let list = inst.findAll ? inst.findAll((x) => x.type === 'TEXT') : [];
    if (list.length && /^decision\\s*\\d*$/i.test(String(list[0].characters).trim()) && list.length > 1) { await setText(list[0], 'Decision ' + n); list = list.slice(1); }
    if (!list.length) throw new Error('The Decision sticky component has no text layer to write into.');
    if (list.length === 1) await setText(list[0], item.decision + (why ? '\\n' + why : ''));
    else { await setText(list[0], item.decision); await setText(list[1], why); }
  }
  async function decisions(screen, items, opts = {}) {
    screen = await get(screen);
    const list = [].concat(items || []).map(asItem).filter((x) => x.decision);
    if (!list.length) throw new Error('DS.decisions needs 3 to 5 decisions, like { decision: "...", why: "..." }.');
    if (list.length > 5) throw new Error('DS.decisions takes at most 5 decisions per screen: keep the most important ones.');
    const parent = screen.parent;
    if (!parent || parent.type === 'PAGE') throw new Error(screen.name + ' (' + screen.id + ') is not inside a section: put it in its flow subsection first.');
    const iteration = opts.iteration ? String(opts.iteration) : '';
    const have = stickiesOf(screen);
    const other = have.find((h) => iteration && h.iteration && h.iteration !== iteration);
    if (other) throw new Error('Sticky ' + other.node.id + ' belongs to iteration ' + other.iteration + ', not ' + iteration + ': edit that iteration, or copy the screen into this one first.');
    let main = null;
    const nodes = [];
    for (let i = 0; i < list.length; i++) {
      let s = have.find((h) => h.n === i + 1);
      s = s ? s.node : null;
      if (!s) { main = main || (await decisionMain(screen)); s = main.createInstance(); parent.appendChild(s); }
      s.name = stickyName(i + 1, screen);
      s.setSharedPluginData(DNS, 'screen', screen.id);
      s.setSharedPluginData(DNS, 'n', String(i + 1));
      s.setSharedPluginData(DNS, 'iteration', iteration);
      await fillSticky(s, list[i], i + 1);
      nodes.push(s);
    }
    let removed = 0;
    for (const h of have) if (h.n > list.length || !h.n) { if (nodes.indexOf(h.node) < 0) { h.node.remove(); removed++; } }
    // Layout: 96px under the screen (32px under its Flow note), 16px apart, as many per row as fit the screen's width; one height per row.
    const sb = box(screen);
    const w = Math.round(nodes[0].width);
    const cols = Math.max(1, Math.floor((sb[2] + 16) / (w + 16)));
    const nt = noteUnder(screen);
    let y = nt ? box(nt)[1] + box(nt)[3] + 32 : sb[1] + sb[3] + 96;
    for (let r = 0; r * cols < nodes.length; r++) {
      const row = nodes.slice(r * cols, r * cols + cols);
      for (const s of row) { try { s.layoutSizingVertical = 'HUG'; } catch (e) { /* not auto layout */ } }
      const h = Math.max(...row.map((s) => Math.round(s.height)));
      row.forEach((s, i) => {
        try { s.layoutSizingVertical = 'FIXED'; } catch (e) { /* not auto layout */ }
        if (Math.round(s.height) !== h && s.resize) s.resize(Math.round(s.width), h);
        moveTo(s, sb[0] + i * (w + 16), y);
      });
      y += h + 16;
    }
    if (parent.type === 'SECTION') fit(parent);
    const out = { screen: screen.id, stickies: nodes.map((s) => s.id), removed };
    if (list.length < 3) out.note = 'Fewer than 3 decisions: add the next most important ones.';
    return out;
  }
  // Lo-fi options (From scratch, Explore): subsections "V1.19 · Flow 3 · Option A: Cards" inside the flow
  // subsection, side by side 400px apart, tagged in their own namespace so they never read as the flow's subsection.
  // Only the first screen of an option carries Decision stickies (the idea, who it serves, what it gives up).
  const ONS = 'designstudio_option';
  const OPTION = /·\\s*option\\s+([abc])\\s*:\\s*(.*)$/i;
  const optionId = (s) => { if (!s || s.type !== 'SECTION') return ''; const t = s.getSharedPluginData ? s.getSharedPluginData(ONS, 'id') : ''; const m = OPTION.exec(String(s.name)); return String(t || (m ? m[1] : '')).toUpperCase(); };
  const screensOf = (s) => (s.children || []).filter((k) => (k.type === 'FRAME' || k.type === 'COMPONENT') && !/^\\s*decision\\s*\\d/i.test(String(k.name)));
  const firstScreen = (s) => screensOf(s).sort((a, b) => box(a)[0] - box(b)[0] || box(a)[1] - box(b)[1])[0] || null;
  function options(flowSub) {
    sure(flowSub, 'DS.options');
    return (flowSub.children || []).filter((k) => optionId(k)).map((k) => { const m = OPTION.exec(String(k.name)); return { id: optionId(k), name: (m ? m[2] : k.getSharedPluginData(ONS, 'name')).trim(), node: k.id }; }).sort((a, b) => a.id.localeCompare(b.id));
  }
  async function option(flowSub, opts = {}) {
    flowSub = await get(flowSub);
    if (flowSub.type !== 'SECTION') throw new Error('DS.option needs the flow subsection (a section), not a ' + flowSub.type + '.');
    const id = String(opts.id || '').trim().toUpperCase();
    if (!/^[ABC]$/.test(id)) throw new Error('DS.option needs id "A", "B" or "C".');
    const name = String(opts.name || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    if (!name) throw new Error('DS.option needs a short name for the option, like "Cards".');
    const m = /^(.*?·\\s*flow\\s*\\d+)/i.exec(String(flowSub.name));
    const label = (m ? m[1] : (opts.iteration ? 'V' + opts.iteration : String(flowSub.name))) + ' · Option ' + id + ': ' + name;
    const kids = (flowSub.children || []).filter((k) => k.visible !== false);
    let s = kids.find((k) => optionId(k) === id);
    const had = kids.filter((k) => optionId(k)).sort((a, b) => optionId(a).localeCompare(optionId(b)));
    if (!s) {
      s = figma.createSection();
      flowSub.appendChild(s);
      s.resizeWithoutConstraints(opts.width || 1600, opts.height || 1200);
    }
    s.name = label;
    s.setSharedPluginData(ONS, 'id', id);
    s.setSharedPluginData(ONS, 'name', name);
    s.setSharedPluginData(ONS, 'iteration', opts.iteration ? String(opts.iteration) : '');
    // Line the options up in id order: under the flow's other content, 400px apart, all on one top edge.
    // Options made earlier keep their top left corner, so screens added beside them later are never jumped over.
    const list = had.concat(had.indexOf(s) < 0 ? [s] : []).sort((a, b) => optionId(a).localeCompare(optionId(b)));
    const rest = kids.filter((k) => !optionId(k) && k !== s);
    const fb = box(flowSub);
    const y = had.length ? box(had[0])[1] : rest.length ? Math.max(...rest.map((k) => box(k)[1] + box(k)[3])) + 400 : fb[1] + 320;
    let x = had.length ? Math.min(...had.map((k) => box(k)[0])) : rest.length ? Math.min(...rest.map((k) => box(k)[0])) : fb[0] + 320;
    for (const o of list) { moveTo(o, x, y); x += Math.round(o.width) + 400; }
    fit(flowSub);
    return { id, name, node: s.id };
  }
  function tree(n, depth = 2, max = 150) {
    sure(n, 'DS.tree');
    const lines = [];
    const walk = (x, d) => {
      if (lines.length >= max) return;
      const b = box(x);
      let line = '  '.repeat(d) + x.id + ' ' + x.type + ' "' + short(x.name) + '" ' + b[2] + 'x' + b[3] + ' @' + b[0] + ',' + b[1];
      if (x.type === 'TEXT') line += ' text="' + short(x.characters, 80) + '"';
      if (x.visible === false) line += ' hidden';
      lines.push(line);
      if (d < depth && 'children' in x) for (const c of x.children) walk(c, d + 1);
    };
    walk(n, 0);
    if (lines.length >= max) lines.push('… more layers, pass a smaller depth or a deeper node');
    return lines.join('\\n');
  }
  async function vars(m) {
    const ok = matcher(m == null ? () => true : m);
    return (await figma.variables.getLocalVariablesAsync()).filter((v) => ok(v));
  }
  async function bindColor(n, field, name) {
    n = await get(n);
    const v = (await vars(name))[0];
    if (!v) throw new Error('No local variable named ' + name + '. List them with DS.vars("~part of name").');
    const list = (n[field] && n[field].length ? n[field] : [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]).slice();
    list[0] = figma.variables.setBoundVariableForPaint(list[0], 'color', v);
    n[field] = list;
    return n;
  }
  function done(value) {
    let s = JSON.stringify(value === undefined ? null : value);
    if (s.length <= 18000) return value;
    return { truncated: true, note: 'The result was cut to fit: return fewer fields.', head: s.slice(0, 17000) };
  }
  // In Design Studio's plugin the script gets __dsShot (figma-plugin/run.ts); use_figma has node.screenshot instead.
  async function shot(n, opts) { n = await get(n); if (typeof __dsShot === 'function') await __dsShot(n, opts); else await n.screenshot(opts); return n.id; }
  // Only the properties this node has: a section has no layout ones, and reading one throws.
  function props(n, keys) { const out = {}; for (const k of keys) if (k in n) out[k] = n[k]; return out; }
  // Where a layer sits, in the file's own terms (docs/figma-api.md): version section, flow subsection, option,
  // screen and its number, the label above the layer, and the instance it is part of.
  const NOT_SCREEN = /^\\s*(decision|flow note|scenario note|arrow|goal)\\b/i;
  const isScreen = (n) => (n.type === 'FRAME' || n.type === 'COMPONENT') && !!n.parent && (n.parent.type === 'SECTION' || n.parent.type === 'PAGE') && !NOT_SCREEN.test(String(n.name)) && n.width >= 240 && n.height >= 240;
  const topLevel = (n) => (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE') && !!n.parent && (n.parent.type === 'SECTION' || n.parent.type === 'PAGE');
  const numberOf = (name) => { const m = /^\\s*(\\d+(?:\\.\\d+)*[a-z]?)(?![\\w.])/.exec(String(name)); return m ? m[1] : undefined; };
  const screenOf = (n) => { for (let p = n; p; p = p.parent) if (isScreen(p)) return p; return null; };
  const brief = (n) => ({ id: n.id, name: n.name });
  const labels = new Map();
  function labelAbove(n, scr) {
    if (!scr || n === scr) return undefined;
    let list = labels.get(scr.id);
    if (!list) { list = scr.findAllWithCriteria({ types: ['TEXT'] }).filter((t) => t.visible !== false && String(t.characters).trim()).map((t) => ({ t, b: box(t) })); labels.set(scr.id, list); }
    const b = box(n);
    let best = null, gap = Infinity;
    for (const x of list) {
      if (x.t === n) continue;
      const g = b[1] - (x.b[1] + x.b[3]);
      if (g < -2 || g > 400 || x.b[0] > b[0] + b[2] || x.b[0] + x.b[2] < b[0]) continue;
      if (g < gap) { gap = g; best = x.t; }
    }
    return best ? short(best.characters, 80) : undefined;
  }
  function where(n) {
    sure(n, 'DS.where');
    const out = { page: '' };
    let scr = null, inst = null;
    for (let p = n; p && p.type !== 'DOCUMENT'; p = p.parent) {
      if (p.type === 'PAGE') out.page = p.name;
      else if (p.type === 'SECTION') {
        const o = optionId(p);
        if (o) out.option = out.option || o;
        else if (p.parent && p.parent.type === 'PAGE') out.version = brief(p);
        else if (!out.flow) out.flow = brief(p);
      } else if (!scr && isScreen(p)) scr = p;
      else if (!scr && p.type === 'INSTANCE') inst = p;
    }
    if (scr) {
      out.screen = brief(scr);
      const num = numberOf(scr.name);
      if (num) out.screen.number = num;
      const l = labelAbove(n, scr);
      if (l) out.label = l;
    }
    if (inst && inst !== n) out.inInstance = { id: inst.id, component: inst.name };
    return out;
  }
  const found = (list, opts) => (opts && opts.where ? list.map((n) => { const o = { id: n.id, name: n.name, type: n.type }; if (n.type === 'TEXT') o.text = short(n.characters, 160); o.where = where(n); return o; }) : list);

  // Screens by number ("3.1") or name, in flow order (rows top to bottom, then left to right).
  function screensIn(root) {
    const out = [];
    const walk = (p) => { for (const k of p.children || []) { if (k.type === 'SECTION') walk(k); else if (isScreen(k)) out.push(k); } };
    if (isScreen(root)) out.push(root); else walk(root);
    const key = (n) => { const b = box(n); return [Math.round(b[1] / 200), b[0]]; };
    return out.sort((a, b) => { const A = key(a), B = key(b); return A[0] - B[0] || A[1] - B[1]; });
  }
  async function screens(scope) {
    const root = scope ? await get(scope) : figma.currentPage;
    return screensIn(root).map((n) => { const o = brief(n); const num = numberOf(n.name); if (num) o.number = num; o.section = n.parent.name; return o; });
  }
  async function screen(ref, scope) {
    if (ref && typeof ref === 'object') return get(ref);
    const s = String(ref).trim();
    if (/^\\d+[:-]\\d+$/.test(s)) return node(s);
    const root = scope ? await get(scope) : figma.currentPage;
    const all = screensIn(root);
    let hit = all.filter((n) => numberOf(n.name) === s);
    if (!hit.length) hit = all.filter((n) => String(n.name).trim() === s);
    if (!hit.length) hit = all.filter((n) => String(n.name).toLowerCase().includes(s.toLowerCase()));
    if (hit.length === 1) return hit[0];
    const list = (hit.length ? hit : all).slice(0, 12).map((n) => n.name + ' (' + n.id + ')').join(', ');
    throw new Error(hit.length ? 'DS.screen: ' + hit.length + ' screens match "' + s + '" in ' + root.name + ': ' + list + '. Pass the flow section as scope, or the full name.' : 'DS.screen: no screen "' + s + '" in ' + root.name + '. Screens there: ' + (list || 'none') + '.');
  }

  // A compact outline of what an edit needs: layout, variables, text, instances and overrides, prototype links.
  async function describe(target, opts = {}) {
    const depth = opts.depth == null ? 4 : opts.depth, max = opts.max || 300;
    const cache = new Map();
    const once = async (k, f) => { if (!cache.has(k)) { let v = null; try { v = await f(); } catch (e) { /* gone or not readable */ } cache.set(k, v); } return cache.get(k); };
    const varName = async (id) => { const v = await once('v' + id, () => figma.variables.getVariableByIdAsync(id)); return v ? v.name : id; };
    const nodeName = async (id) => { const v = await once('n' + id, () => figma.getNodeByIdAsync(id)); return v ? v.name : 'missing ' + id; };
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    async function paint(list) {
      if (!Array.isArray(list)) return list && list.length === undefined ? 'mixed' : '';
      const p = list.find((x) => x.visible !== false);
      if (!p) return '';
      if (p.type !== 'SOLID') return p.type.toLowerCase();
      const v = p.boundVariables && p.boundVariables.color;
      return (v ? await varName(v.id) : hex(p.color)) + (p.opacity != null && p.opacity < 1 ? ' ' + Math.round(p.opacity * 100) + '%' : '');
    }
    async function line(n, o) {
      const b = box(n);
      const out = [n.id, n.type, '"' + short(n.name, 50) + '"', b[2] + 'x' + b[3], '@' + (b[0] - o[0]) + ',' + (b[1] - o[1])];
      if (n.visible === false) out.push('hidden');
      if (n.layoutPositioning === 'ABSOLUTE') out.push('absolute');
      if ('layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE') out.push('auto ' + (n.layoutMode === 'HORIZONTAL' ? 'H' : n.layoutMode === 'VERTICAL' ? 'V' : n.layoutMode) + ' pad ' + [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].join('/') + ' gap ' + n.itemSpacing + ' align ' + String(n.primaryAxisAlignItems).toLowerCase() + '/' + String(n.counterAxisAlignItems).toLowerCase());
      try { if ('layoutSizingHorizontal' in n && ((n.layoutMode && n.layoutMode !== 'NONE') || (n.parent && n.parent.layoutMode && n.parent.layoutMode !== 'NONE'))) out.push('w:' + String(n.layoutSizingHorizontal).toLowerCase() + ' h:' + String(n.layoutSizingVertical).toLowerCase()); } catch (e) { /* no sizing here */ }
      if ('fills' in n && n.type !== 'TEXT') { const f = await paint(n.fills); if (f) out.push('fill ' + f); }
      if ('strokes' in n && n.strokes && n.strokes.length) { const s = await paint(n.strokes); if (s) out.push('stroke ' + (typeof n.strokeWeight === 'number' ? n.strokeWeight : 'mixed') + ' ' + s + (n.strokeAlign && n.strokeAlign !== 'INSIDE' ? ' ' + String(n.strokeAlign).toLowerCase() : '')); }
      if (typeof n.cornerRadius === 'number' && n.cornerRadius) out.push('r ' + n.cornerRadius);
      if ('effects' in n && n.effects && n.effects.length) out.push('effects ' + n.effects.filter((e) => e.visible !== false).map((e) => String(e.type).toLowerCase()).join('+'));
      if (typeof n.opacity === 'number' && n.opacity < 1) out.push('opacity ' + Math.round(n.opacity * 100) + '%');
      if (n.type === 'TEXT') {
        const fn = n.fontName, lh = n.lineHeight;
        const font = fn && typeof fn === 'object' ? fn.family + ' ' + fn.style : 'mixed font';
        const lead = lh && typeof lh === 'object' ? (lh.unit === 'PIXELS' ? Math.round(lh.value) : lh.unit === 'PERCENT' ? lh.value + '%' : 'auto') : 'mixed';
        out.push('"' + short(n.characters, 120) + '"', font + ' ' + (typeof n.fontSize === 'number' ? n.fontSize : 'mixed') + '/' + lead);
        if (typeof n.textStyleId === 'string' && n.textStyleId) { const st = await once('s' + n.textStyleId, () => figma.getStyleByIdAsync(n.textStyleId)); if (st) out.push('style ' + st.name); }
        const f = await paint(n.fills);
        if (f) out.push(f);
        if (n.textAutoResize && n.textAutoResize !== 'NONE') out.push(String(n.textAutoResize).toLowerCase().replace('_', ' '));
      }
      if (n.type === 'INSTANCE') {
        const main = await once('m' + n.id, () => n.getMainComponentAsync());
        out.push('of ' + (main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.name : main ? main.name : '?'));
        const props = n.componentProperties || {};
        const shown = [];
        for (const k of Object.keys(props)) {
          const p = props[k];
          shown.push(k.split('#')[0] + '=' + (p.type === 'INSTANCE_SWAP' ? await nodeName(p.value) : p.type === 'TEXT' ? '"' + short(p.value, 40) + '"' : p.value));
        }
        if (shown.length) out.push('{' + shown.join(', ') + '}');
        const fields = new Map();
        for (const o of n.overrides || []) for (const f of o.overriddenFields || []) fields.set(f, (fields.get(f) || 0) + 1);
        if (fields.size) out.push('overrides ' + [...fields].map(([f, c]) => (c > 1 ? f + '×' + c : f)).join(' '));
      }
      if ('reactions' in n && n.reactions && n.reactions.length) {
        for (const r of n.reactions) {
          const p = plain(r);
          for (const a of p.actions) out.push('→ ' + trigName(p.trigger) + ' ' + String(a.navigation || a.type || '').toLowerCase() + (a.destinationId ? ' ' + await nodeName(a.destinationId) : ''));
        }
      }
      return out.join(' ');
    }
    const lines = [];
    let cut = false;
    async function walk(n, d, o) {
      if (lines.length >= max) { cut = true; return; }
      let l = '  '.repeat(d) + (await line(n, o));
      const kids = 'children' in n && n.visible !== false ? n.children : [];
      if (kids.length && d >= depth) l += ' [' + kids.length + ' inside]';
      lines.push(l);
      if (d < depth) for (const k of kids) await walk(k, d + 1, o);
    }
    for (const t of [].concat(target)) { const r = await get(t); await walk(r, 0, box(r).slice(0, 2)); }
    if (cut) lines.push('… stopped at ' + max + ' lines: describe a deeper node, or pass { depth } or { max }');
    return lines.join('\\n');
  }

  // Prototype links: read them all, or set one with the destination checked first.
  const TRIG = { click: 'ON_CLICK', hover: 'ON_HOVER', press: 'ON_PRESS', drag: 'ON_DRAG', timeout: 'AFTER_TIMEOUT' };
  const NAV = { navigate: 'NAVIGATE', overlay: 'OVERLAY', swap: 'SWAP', change: 'CHANGE_TO', scroll: 'SCROLL_TO' };
  const trigName = (t) => (!t ? '?' : t.type === 'AFTER_TIMEOUT' ? 'after ' + t.timeout + 's' : String(t.type).replace(/^ON_/, '').toLowerCase());
  async function links(root) {
    root = await get(root);
    const has = (n) => 'reactions' in n && !!n.reactions && n.reactions.length > 0;
    const nodes = (has(root) ? [root] : []).concat(root.findAll ? root.findAll(has) : []);
    const seen = new Map();
    const look = async (id) => { if (!seen.has(id)) seen.set(id, await figma.getNodeByIdAsync(id)); return seen.get(id); };
    const out = [];
    for (const n of nodes) {
      const s = screenOf(n);
      for (const r of n.reactions) {
        const p = plain(r);
        for (const a of p.actions) {
          if (out.length >= 400) return out.concat([{ note: 'Stopped at 400 links: pass a smaller root.' }]);
          const d = a.destinationId ? await look(a.destinationId) : null;
          const ds = d ? screenOf(d) : null;
          const o = { from: n.id, fromName: short(n.name, 40), screen: s ? s.name : undefined, trigger: trigName(p.trigger), nav: String(a.navigation || a.type || '').toLowerCase() };
          if (a.destinationId) { o.to = a.destinationId; o.toName = d ? short(d.name, 40) : 'missing'; if (ds && ds !== d) o.toScreen = ds.name; }
          out.push(o);
        }
      }
    }
    return out;
  }
  async function link(from, to, opts = {}) {
    from = await get(from);
    to = await get(to);
    const on = TRIG[opts.on || 'click'], nav = NAV[opts.nav || 'navigate'];
    if (!on) throw new Error('DS.link: on is one of ' + Object.keys(TRIG).join(', ') + '.');
    if (!nav) throw new Error('DS.link: nav is one of ' + Object.keys(NAV).join(', ') + '.');
    if (!('reactions' in from)) throw new Error(from.name + ' (' + from.id + ') is a ' + from.type + ', which cannot have prototype links.');
    if (nav === 'CHANGE_TO') {
      const main = from.type === 'INSTANCE' ? await from.getMainComponentAsync() : from;
      const set = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
      if (!set || to.parent !== set) throw new Error('DS.link: change goes to a variant of ' + (set ? set.name : 'the same component set') + ', and ' + to.name + ' (' + to.id + ') is not one.');
    } else {
      const a = pageOf(from), b = pageOf(to);
      if (a !== b) throw new Error('DS.link: ' + to.name + ' (' + to.id + ') is on page ' + (b ? b.name : '?') + ', not ' + (a ? a.name : '?') + '. Prototype links stay on one page.');
      if (!topLevel(to)) throw new Error('DS.link: ' + to.name + ' (' + to.id + ') is not a top-level frame (a screen or overlay directly in a section). Point the link at the screen.');
    }
    const trigger = on === 'AFTER_TIMEOUT' ? { type: on, timeout: opts.seconds == null ? 2 : opts.seconds } : { type: on };
    const action = { type: 'NODE', destinationId: to.id, navigation: nav, transition: null };
    if (nav === 'OVERLAY' && opts.position) action.overlayRelativePosition = opts.position;
    const keep = (from.reactions || []).filter((r) => !(r.trigger && r.trigger.type === on)).map(plain);
    keep.push({ trigger, actions: [action] });
    await from.setReactionsAsync(keep);
    return { from: from.id, to: to.id, on: opts.on || 'click', nav: opts.nav || 'navigate' };
  }

  // A copy of a section whose links, Decision stickies and flow notes belong to the copy, not the source.
  async function cloneSection(src, opts = {}) {
    src = await get(src);
    if (src.type !== 'SECTION') throw new Error('DS.cloneSection takes a section, not a ' + src.type + ': use DS.clone for a screen.');
    const parent = src.parent;
    const c = src.clone();
    parent.insertChild(parent.children.indexOf(src) + 1, c);
    if (opts.name) c.name = opts.name;
    const sb = box(src);
    if (opts.x != null || opts.y != null) moveTo(c, opts.x == null ? sb[0] : opts.x, opts.y == null ? sb[1] : opts.y);
    else if (opts.below) { const b = box(await get(opts.below)); moveTo(c, b[0], b[1] + b[3] + (opts.gap == null ? 400 : opts.gap)); }
    else {
      // Under the lowest section in the source's column, so the copy never lands on another version.
      let bottom = sb[1] + sb[3];
      for (const k of parent.children) { if (k === c || k.type !== 'SECTION') continue; const b = box(k); if (b[0] < sb[0] + sb[2] && sb[0] < b[0] + b[2]) bottom = Math.max(bottom, b[1] + b[3]); }
      moveTo(c, sb[0], bottom + (opts.gap == null ? 400 : opts.gap));
    }
    const a = [src].concat(src.findAll(() => true)), b = [c].concat(c.findAll(() => true));
    if (a.length !== b.length) throw new Error('DS.cloneSection: the copy has ' + b.length + ' layers and the source ' + a.length + '; links were not moved. Check ' + c.id + '.');
    const map = new Map();
    a.forEach((n, i) => map.set(n.id, b[i]));
    const page = pageOf(src);
    let moved = 0, dropped = 0;
    const failed = [];
    for (const n of b) {
      if ('reactions' in n && n.reactions && n.reactions.length) {
        let changed = false;
        const next = [];
        for (const r of n.reactions) {
          const p = plain(r);
          const acts = [];
          for (const x of p.actions) {
            if (x && x.destinationId && map.has(x.destinationId)) { acts.push(Object.assign({}, x, { destinationId: map.get(x.destinationId).id })); moved++; changed = true; continue; }
            // Hover and other variant changes point at the component, wherever it is. A screen link that leaves the page is dropped.
            if (x && x.destinationId && x.navigation !== 'CHANGE_TO') {
              const d = await figma.getNodeByIdAsync(x.destinationId);
              if (!d || pageOf(d) !== page) { dropped++; changed = true; continue; }
            }
            acts.push(x);
          }
          if (acts.length) next.push({ trigger: p.trigger, actions: acts });
        }
        if (changed) { try { await n.setReactionsAsync(next); } catch (e) { failed.push(n.id + ': ' + e.message); } }
      }
      if (n.parent && n.parent.type === 'SECTION' && n.getSharedPluginData) {
        for (const ns of [DNS, FNS]) for (const key of ['screen', 'from', 'to']) {
          const v = n.getSharedPluginData(ns, key);
          if (v && map.has(v)) n.setSharedPluginData(ns, key, map.get(v).id);
        }
      }
    }
    const pairs = {};
    for (const n of a) if (n !== src && isScreen(n)) pairs[n.id] = map.get(n.id).id;
    if (parent.type === 'SECTION') fit(parent);
    return { section: c.id, screens: pairs, linksMoved: moved, linksDropped: dropped, failed: failed.slice(0, 10) };
  }

  // Flow notes, arrows and Branch labels, laid out by the design-process rules: a Note 96px under each screen with its
  // Decision stickies 32px under the note, and between screens a 6px arrow 30px clear of each, 416px below the top,
  // with a 300px Branch label naming the click under it. Tagged in their own namespace, so a rerun updates them.
  const FNS = 'designstudio_flow';
  const tagOf = (k, key) => (k.getSharedPluginData ? k.getSharedPluginData(FNS, key) : '');
  const tagged = (sec, kind, to, from) => (sec.children || []).find((k) => tagOf(k, 'kind') === kind && tagOf(k, 'to') === to && (from == null || tagOf(k, 'from') === from));
  const tag = (k, kind, to, from) => { k.setSharedPluginData(FNS, 'kind', kind); k.setSharedPluginData(FNS, 'to', to); if (from) k.setSharedPluginData(FNS, 'from', from); };
  const near = (k, x, y, d) => { const b = box(k); return Math.abs(b[0] - x) < d && Math.abs(b[1] - y) < d; };
  let flowSet = null;
  async function flowVariant(scr, type) {
    if (!flowSet) {
      const inst = (scr.parent.children || []).find((k) => k.type === 'INSTANCE' && /^flow note/i.test(String(k.name)));
      const m = inst ? await inst.getMainComponentAsync() : null;
      if (m && m.parent && m.parent.type === 'COMPONENT_SET') flowSet = m.parent;
      const look = (root) => (root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['COMPONENT_SET'] }) : []).find((c) => /^flow note$/i.test(String(c.name).trim()));
      if (!flowSet) flowSet = look(pageOf(scr) || figma.currentPage);
      for (const pg of flowSet ? [] : figma.root.children) { if (pg.loadAsync) await pg.loadAsync(); flowSet = look(pg); if (flowSet) break; }
      if (!flowSet) throw new Error('No Flow note component: a component set named "Flow note" with Type=Note and Type=Branch label.');
    }
    return flowSet.children.find((c) => Object.values(c.variantProperties || {}).some((v) => String(v).toLowerCase() === type.toLowerCase())) || flowSet.defaultVariant || flowSet.children[0];
  }
  async function noteText(inst, vals) {
    const props = inst.componentProperties || {};
    const set = {};
    for (const k of Object.keys(vals)) {
      if (vals[k] == null) continue;
      const key = Object.keys(props).find((p) => props[p].type === 'TEXT' && p.split('#')[0].trim().toLowerCase() === k.toLowerCase());
      if (key) set[key] = String(vals[k]);
    }
    if (!Object.keys(set).length) throw new Error('The Flow note component has no Step, Title or Body text property.');
    for (const t of inst.findAll ? inst.findAll((x) => x.type === 'TEXT') : []) await fonts(t);
    inst.setProperties(set);
  }
  function noteUnder(scr) {
    const sec = scr.parent, sb = box(scr);
    if (!sec || !sec.children) return null;
    return tagged(sec, 'note', scr.id) || sec.children.find((k) => k.type === 'INSTANCE' && /^flow note/i.test(String(k.name)) && !/label/i.test(String(k.name)) && !tagOf(k, 'kind') && near(k, sb[0], sb[1] + sb[3] + 96, 120)) || null;
  }
  async function note(scr, item = {}) {
    scr = await get(scr);
    const sec = scr.parent;
    if (!sec || sec.type !== 'SECTION') throw new Error(scr.name + ' (' + scr.id + ') is not in a section.');
    let n = noteUnder(scr);
    if (!n) {
      n = (await flowVariant(scr, 'Note')).createInstance();
      sec.appendChild(n);
      const other = sec.children.find((k) => k !== n && tagOf(k, 'kind') === 'note');
      if (other) n.resize(Math.round(other.width), n.height);
    }
    const step = item.step || numberOf(scr.name) || '';
    tag(n, 'note', scr.id);
    n.name = 'Flow note · ' + (step || scr.name);
    await noteText(n, { Step: step, Title: item.title, Body: item.body });
    const sb = box(scr);
    moveTo(n, sb[0], sb[1] + sb[3] + 96);
    const st = stickiesOf(scr).map((s) => s.node);
    if (st.length) { const top = Math.min(...st.map((s) => box(s)[1])); const dy = box(n)[1] + box(n)[3] + 32 - top; for (const s of st) moveTo(s, box(s)[0], box(s)[1] + dy); }
    return n;
  }
  async function arrow(a, b, item = {}) {
    a = await get(a);
    b = await get(b);
    const sec = b.parent;
    const A = box(a), B = box(b);
    const beside = A[0] + A[2] < B[0] && Math.abs(A[1] - B[1]) < 40;
    const y = (beside ? A : B)[1] + 416;
    const x2 = B[0] - 30, x1 = beside ? A[0] + A[2] + 30 : x2 - 260;
    const len = Math.max(40, Math.round(x2 - x1));
    let v = tagged(sec, 'arrow', b.id, a.id) || sec.children.find((k) => /^arrow/i.test(String(k.name)) && !tagOf(k, 'kind') && (k.type === 'VECTOR' || k.type === 'LINE') && near(k, x1, y, 40));
    const ref = v || sec.children.find((k) => /^arrow/i.test(String(k.name)) && k.type === 'VECTOR');
    if (!v || v.type !== 'VECTOR') {
      if (v) v.remove();
      v = figma.createVector();
      sec.appendChild(v);
      v.strokes = ref && ref.strokes && ref.strokes.length ? ref.strokes : [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.45 } }];
    }
    const net = { vertices: [{ x: 0, y: 0 }, { x: len, y: 0, strokeCap: 'ARROW_LINES' }], segments: [{ start: 0, end: 1 }], regions: [] };
    if (v.setVectorNetworkAsync) await v.setVectorNetworkAsync(net); else v.vectorNetwork = net;
    v.strokeWeight = 6;
    const from = numberOf(a.name) || a.name, to = numberOf(b.name) || b.name;
    v.name = 'arrow · ' + from + '-' + to;
    tag(v, 'arrow', b.id, a.id);
    moveTo(v, x1, y);
    let l = tagged(sec, 'label', b.id, a.id) || sec.children.find((k) => k.type === 'INSTANCE' && /^flow note · label/i.test(String(k.name)) && !tagOf(k, 'kind') && near(k, x1 - 20, y + 20, 60));
    if (!l) { l = (await flowVariant(b, 'Branch label')).createInstance(); sec.appendChild(l); }
    tag(l, 'label', b.id, a.id);
    l.name = 'Flow note · label ' + from + '-' + to;
    await noteText(l, { Step: from, Title: item.click || '', Body: item.detail || '' });
    l.resize(300, l.height);
    moveTo(l, x1 - 20, y + 20);
    return { arrow: v.id, label: l.id };
  }
  async function flow(scope, steps, opts = {}) {
    scope = await get(scope);
    const list = [].concat(steps || []);
    if (!list.length) throw new Error('DS.flow needs the steps: [{ screen: "1", title, body }, { screen: "1.1", click: "Click Save", title, body }].');
    const out = { notes: [], arrows: [], labels: [] };
    const touched = new Set();
    let prev = null;
    for (const st of list) {
      const s = await screen(st.screen, scope);
      if (st.title || st.body) out.notes.push((await note(s, { step: st.step, title: st.title, body: st.body })).id);
      const from = st.from != null ? await screen(st.from, scope) : prev;
      if (st.click && from) { const r = await arrow(from, s, { click: st.click, detail: st.detail }); out.arrows.push(r.arrow); out.labels.push(r.label); }
      prev = s;
      touched.add(s.parent);
    }
    for (const sec of touched) if (sec && sec.type === 'SECTION') fit(sec);
    return out;
  }
  // Every font in a layer and its text layers, before setting text properties such as textAutoResize by hand.
  async function fontsIn(n) {
    n = await get(n);
    const list = n.type === 'TEXT' ? [n] : n.findAllWithCriteria ? n.findAllWithCriteria({ types: ['TEXT'] }) : [];
    for (const t of list) await fonts(t);
    return list.length;
  }
  return { node, page, section, find, one, texts, setText, hoverOf, wireHover, setVariant, moveTo, placeBelow, placeRight, clone, fit, overlaps, check, decisions, option, options, tree, vars, bindColor, box, done, shot, props, where, screen, screens, describe, links, link, cloneSection, flow, note, arrow, fonts: fontsIn };
})();`;

/** Short reference for Claude, kept next to the code so the two stay in step. */
export const KIT_GUIDE = [
  'Design Studio adds a helper object DS to every use_figma script that mentions it (do not paste or define it):',
  '- DS.node(id): node by id, its page loaded; throws a clear message when the id is gone. DS.page(id): same, and makes its page current.',
  '- DS.section(page|pageId|"Page name", "V0.5 · Flow 2 · topic · Sat 24 Oct 2026", { below: prevSection, gap=400 } or { x, y, width, height, fills }): finds or makes a top level section on that page (figma.createSection alone lands on the first page).',
  '- DS.describe(node|id|[ids], { depth=4, max=300 }): one outline line per layer with id, size, position, auto layout, sizing, fills and strokes as variable names, text with font and style, instance component, variant and properties, overridden fields, and prototype links. Read a screen with it once before editing, instead of several small reads.',
  '- DS.screen("3.1" | "screen name", scope?) gives the screen node (by number, then name; throws with the near matches), DS.screens(scope) lists [{ id, name, number, section }] in flow order. DS.where(node): { page, version, flow, option, screen: { id, name, number }, label (the text above it, like a step label), inInstance }.',
  '- DS.find(root, name|"~part"|/re/|fn, type?, { where: true }) and DS.one(...) (first, or throws). DS.texts(root, "words"|/re/, { where: true }) finds text layers by content. With where, each match comes back as { id, name, text, where }, so one call tells which screen and step each match is on: do not walk .parent.',
  '- DS.links(root): every prototype link under it as { from, fromName, screen, trigger, nav, to, toName, toScreen }. DS.link(from, to, { on: "click"|"hover"|"timeout", nav: "navigate"|"overlay"|"change", seconds?, position? }) sets one link, keeps the others, and refuses a destination on another page or inside a screen.',
  '- DS.cloneSection(section, { name, below?, gap=400 }): copies a version or flow section under the lowest section in its column, points links inside it at the copies, drops links that left the page, and moves Decision sticky and flow note tags to the copied screens. Returns { section, screens: { oldId: newId }, linksMoved, linksDropped }.',
  '- DS.flow(section, [{ screen: "1", title, body }, { screen: "1.1", click: "Click Nudge managers", detail?, from?, title, body }]): the flow notes per the design-process rules, in one call. A Note 96px under each screen (Decision stickies moved 32px under it), and from the step before (or from) a 6px arrow with a 300px Branch label naming the click. A rerun updates them in place. DS.note(screen, { title, body }) and DS.arrow(from, to, { click }) do one each.',
  '- DS.fonts(node): loads every font in it, before setting textAutoResize or other text properties by hand.',
  '- DS.setText(textNode|id, "new text"), or DS.setText(parent, "layer name"|"exact text"|"~part"|/re/, "new text") to look it up first: loads its fonts, and says what it could not find. DS.bindColor(node, "fills"|"strokes", "variable/name").',
  '- DS.setVariant(instance|id, { State: "Default", Size: "Small" }): switches variant and points ON_HOVER at the matching Hover variant (none for Disabled, Selected, Pressed, Focus, Open or Working, and a stale hover is dropped). DS.wireHover(instance) only rewires the hover. DS.hoverOf(variant) gives the Hover sibling.',
  '- DS.clone(screen, { name, below?, gap? }), DS.placeRight(node, ref, gap=160), DS.placeBelow(node, ref, gap=96), DS.moveTo(node, absX, absY), DS.fit(section, pad=320) grows a section around its children.',
  '- DS.decisions(screen|id, [{ decision, why }, ...], { iteration: "1.19" }): writes the screen\'s 3 to 5 Decision stickies (the Decision sticky component), updates them in place, removes extra ones, lays them out 96px under the screen with one height per row and fits the section. Call it after every new or changed screen.',
  '- DS.option(flowSubsection|id, { id: "A", name: "Cards", iteration: "1.19" }): finds or makes the low fidelity option subsection "V1.19 · Flow 3 · Option A: Cards" inside the flow subsection, lines the options up 400px apart and fits the flow subsection. Put the option\'s screens in the returned node, then DS.fit it. DS.options(flowSubsection) lists [{ id, name, node }] for set_status options. Only the first screen of an option needs Decision stickies.',
  '- DS.check([ids]): hover missing or pointing at the wrong variant (Disabled, Selected and other fixed states are skipped), Disabled instances with any reaction but a hover tooltip overlay (disabledReacts: clear them with setReactionsAsync([])), children outside their frame, overlaps in the section, screens with fewer than 3 Decision stickies. DS.overlaps(parent). DS.tree(node, depth=2): compact layer list for discovery.',
  '- DS.shot(node|id): screenshot returned inline with the result, so no get_screenshot call is needed. DS.done(value) keeps the return value under the size limit.',
  '- DS.props(node, ["layoutSizingVertical", "paddingBottom"]): only the properties the node has (a section has no layout properties, and reading one throws and fails the whole call).',
  '- Search by type: page.findAllWithCriteria({ types: ["TEXT"] }).filter(...), not page.findAll(n => n.type === "TEXT" && ...), which runs your function on every layer.',
  '- Await DS.node, DS.page, DS.section, DS.check, DS.decisions, DS.setText, DS.setVariant, DS.wireHover, DS.bindColor, DS.shot, DS.describe, DS.screen, DS.screens, DS.links, DS.link, DS.cloneSection, DS.flow, DS.note, DS.arrow and DS.fonts. The others are not async and take nodes, not ids.',
  'Example, one call that fixes, checks and shows: const s = await DS.node("1:31"); await DS.wireHover(DS.one(s, "~Button", "INSTANCE")); const t = DS.one(s, "~Toast"); DS.moveTo(t, DS.box(s)[0] + (s.width - t.width) / 2, DS.box(s)[1] + 24); await DS.shot(s); return DS.done({ check: await DS.check([s.id]) });',
].join('\n');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/** Throws when the code does not parse as the body of an async function, the way use_figma runs it. */
export function parses(code: string) {
  new AsyncFunction(code);
  return true;
}

function parsesSafely(code: string) {
  try {
    return parses(code);
  } catch {
    return false;
  }
}

export const usesKit = (code: string) => /\bDS\s*\.\s*[A-Za-z]/.test(code);

/** The Figma MCP's use_figma takes at most this much code. Design Studio's plugin has no such limit. */
export const MCP_MAX_CODE = 50000;

/** The kit as it goes in front of scripts: no comment lines or indentation, so the MCP's limit leaves room for the script. */
const KIT_SENT = FIGMA_KIT.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');

/**
 * Adds the helpers in front of code that uses DS, with Claude's code in its own scope so a name it declares never
 * clashes with one of ours. Returns null when nothing needs to change or the result would be longer than `max`.
 */
export function wrapFigmaCode(code: string, max = MCP_MAX_CODE): string | null {
  if (!usesKit(code)) return null;
  const out = `${KIT_SENT}\nreturn await (async () => {\n${code}\n})();`;
  return out.length <= max ? out : null;
}

export type FigmaCall = { code?: unknown; [k: string]: unknown };

/** What the use_figma hook does with one call: the input with the helpers added, or null to leave it as it is. */
export function prepareFigmaCall(input: FigmaCall, max = MCP_MAX_CODE): FigmaCall | null {
  const code = typeof input.code === 'string' ? input.code : '';
  // Code that does not parse fails the same way with or without the helpers, and Claude's error reads better alone.
  if (!code || !parsesSafely(code)) return null;
  const wrapped = wrapFigmaCode(code, max);
  return wrapped ? { ...input, code: wrapped } : null;
}
