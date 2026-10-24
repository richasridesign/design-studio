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
  function find(root, m, type) {
    sure(root, 'DS.find');
    const ok = matcher(m);
    const types = type ? [].concat(type) : null;
    const list = types && root.findAllWithCriteria ? root.findAllWithCriteria({ types }) : root.findAll ? root.findAll(() => true) : [];
    return list.filter((n) => ok(n));
  }
  function one(root, m, type) {
    const hit = find(root, m, type);
    if (!hit.length) throw new Error('Nothing named ' + String(m) + (type ? ' (' + type + ')' : '') + ' inside ' + root.name + ' (' + root.id + ').');
    return hit[0];
  }
  function texts(root, m) {
    sure(root, 'DS.texts');
    const ok = typeof m === 'function' ? m : m instanceof RegExp ? (t) => m.test(t) : (t) => t.includes(String(m));
    return root.findAllWithCriteria({ types: ['TEXT'] }).filter((t) => ok(t.characters));
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
    // Layout: 96px under the screen, 16px apart, as many per row as fit the screen's width; one height per row.
    const sb = box(screen);
    const w = Math.round(nodes[0].width);
    const cols = Math.max(1, Math.floor((sb[2] + 16) / (w + 16)));
    let y = sb[1] + sb[3] + 96;
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
  async function shot(n, opts) { n = await get(n); await n.screenshot(opts); return n.id; }
  return { node, page, section, find, one, texts, setText, hoverOf, wireHover, setVariant, moveTo, placeBelow, placeRight, clone, fit, overlaps, check, decisions, option, options, tree, vars, bindColor, box, done, shot };
})();`;

/** Short reference for Claude, kept next to the code so the two stay in step. */
export const KIT_GUIDE = [
  'Design Studio adds a helper object DS to every use_figma script that mentions it (do not paste or define it):',
  '- DS.node(id): node by id, its page loaded; throws a clear message when the id is gone. DS.page(id): same, and makes its page current.',
  '- DS.section(page|pageId|"Page name", "V0.5 · Flow 2 · topic · Sat 24 Oct 2026", { below: prevSection, gap=400 } or { x, y, width, height, fills }): finds or makes a top level section on that page (figma.createSection alone lands on the first page).',
  '- DS.find(root, name|"~part"|/re/|fn, type?) and DS.one(...) (first, or throws). DS.texts(root, "words") finds text layers by content.',
  '- DS.setText(textNode|id, "new text"), or DS.setText(parent, "layer name"|"exact text"|"~part"|/re/, "new text") to look it up first: loads its fonts, and says what it could not find. DS.bindColor(node, "fills"|"strokes", "variable/name").',
  '- DS.setVariant(instance|id, { State: "Default", Size: "Small" }): switches variant and points ON_HOVER at the matching Hover variant (none for Disabled, Selected, Pressed, Focus, Open or Working, and a stale hover is dropped). DS.wireHover(instance) only rewires the hover. DS.hoverOf(variant) gives the Hover sibling.',
  '- DS.clone(screen, { name, below?, gap? }), DS.placeRight(node, ref, gap=160), DS.placeBelow(node, ref, gap=96), DS.moveTo(node, absX, absY), DS.fit(section, pad=320) grows a section around its children.',
  '- DS.decisions(screen|id, [{ decision, why }, ...], { iteration: "1.19" }): writes the screen\'s 3 to 5 Decision stickies (the Decision sticky component), updates them in place, removes extra ones, lays them out 96px under the screen with one height per row and fits the section. Call it after every new or changed screen.',
  '- DS.option(flowSubsection|id, { id: "A", name: "Cards", iteration: "1.19" }): finds or makes the low fidelity option subsection "V1.19 · Flow 3 · Option A: Cards" inside the flow subsection, lines the options up 400px apart and fits the flow subsection. Put the option\'s screens in the returned node, then DS.fit it. DS.options(flowSubsection) lists [{ id, name, node }] for set_status options. Only the first screen of an option needs Decision stickies.',
  '- DS.check([ids]): hover missing or pointing at the wrong variant (Disabled, Selected and other fixed states are skipped), Disabled instances with any reaction but a hover tooltip overlay (disabledReacts: clear them with setReactionsAsync([])), children outside their frame, overlaps in the section, screens with fewer than 3 Decision stickies. DS.overlaps(parent). DS.tree(node, depth=2): compact layer list for discovery.',
  '- DS.shot(node|id): screenshot returned inline with the result, so no get_screenshot call is needed. DS.done(value) keeps the return value under the size limit.',
  '- Await DS.node, DS.page, DS.section, DS.check, DS.decisions, DS.setText, DS.setVariant, DS.wireHover, DS.bindColor and DS.shot. The others are not async and take nodes, not ids.',
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

const MAX_CODE = 50000;

/**
 * Adds the helpers in front of code that uses DS, with Claude's code in its own scope so a name it declares never
 * clashes with one of ours. Returns null when nothing needs to change or the result would be too long.
 */
export function wrapFigmaCode(code: string): string | null {
  if (!usesKit(code)) return null;
  const out = `${FIGMA_KIT}\nreturn await (async () => {\n${code}\n})();`;
  return out.length <= MAX_CODE ? out : null;
}

export type FigmaCall = { code?: unknown; [k: string]: unknown };

/** What the use_figma hook does with one call: the input with the helpers added, or null to leave it as it is. */
export function prepareFigmaCall(input: FigmaCall): FigmaCall | null {
  const code = typeof input.code === 'string' ? input.code : '';
  // Code that does not parse fails the same way with or without the helpers, and Claude's error reads better alone.
  if (!code || !parsesSafely(code)) return null;
  const wrapped = wrapFigmaCode(code);
  return wrapped ? { ...input, code: wrapped } : null;
}
