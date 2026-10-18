import { CHECKPOINT } from './flow.js';

// Helpers that Design Studio puts in front of every use_figma script that uses them, so Claude's edit scripts stay
// short and the usual slips (a null node, an unloaded font, a hover that points at the wrong variant) fail with a
// plain message instead. Claude calls them as DS.<name>. The PreToolUse hook adds them and, on the first Figma call
// of a turn, a version save, so Claude no longer spends a call on either.

/** Plain Plugin API JavaScript. Defines one constant, DS. Read only until a helper that edits is called. */
export const FIGMA_KIT = `const DS = (() => {
  const norm = (id) => String(id).replace('-', ':');
  const short = (s, n = 60) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const box = (n) => { const b = n.absoluteBoundingBox || { x: n.x || 0, y: n.y || 0, width: n.width || 0, height: n.height || 0 }; return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const pageOf = (n) => { while (n && n.type !== 'PAGE') n = n.parent; return n; };
  async function node(id) {
    const n = await figma.getNodeByIdAsync(norm(id));
    if (!n) throw new Error('Node ' + id + ' does not exist. It may be newer than the file map or deleted: look it up by name with DS.find.');
    const p = pageOf(n);
    if (p && p !== figma.currentPage && p.loadAsync) await p.loadAsync();
    return n;
  }
  async function page(id) { const n = await node(id); const p = pageOf(n); if (p && p !== figma.currentPage) await figma.setCurrentPageAsync(p); return n; }
  function matcher(m) {
    if (typeof m === 'function') return m;
    if (m instanceof RegExp) return (n) => m.test(n.name);
    const s = String(m);
    if (s.startsWith('~')) { const t = s.slice(1).toLowerCase(); return (n) => String(n.name).toLowerCase().includes(t); }
    return (n) => n.name === s;
  }
  function find(root, m, type) {
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
    const ok = typeof m === 'function' ? m : m instanceof RegExp ? (t) => m.test(t) : (t) => t.includes(String(m));
    return root.findAllWithCriteria({ types: ['TEXT'] }).filter((t) => ok(t.characters));
  }
  async function fonts(t) {
    const list = t.characters.length ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    for (const f of list) if (f && typeof f === 'object') await figma.loadFontAsync(f);
  }
  async function setText(t, chars) {
    if (typeof t === 'string') t = await node(t);
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
  async function wireHover(inst) {
    if (typeof inst === 'string') inst = await node(inst);
    if (inst.type !== 'INSTANCE') return null;
    const main = await inst.getMainComponentAsync();
    const hover = hoverOf(main);
    if (!hover) return null;
    const keep = (inst.reactions || []).filter((r) => !(r.trigger && r.trigger.type === 'ON_HOVER')).map(plain);
    keep.push({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: hover.id, navigation: 'CHANGE_TO', transition: null }] });
    await inst.setReactionsAsync(keep);
    return hover.id;
  }
  async function setVariant(inst, props) {
    if (typeof inst === 'string') inst = await node(inst);
    if (inst.type !== 'INSTANCE') throw new Error(inst.name + ' (' + inst.id + ') is a ' + inst.type + ', not an instance.');
    inst.setProperties(props);
    await wireHover(inst);
    return inst;
  }
  function moveTo(n, x, y) {
    const p = n.parent;
    const t = p && p.type !== 'PAGE' && p.absoluteTransform ? p.absoluteTransform : [[1, 0, 0], [0, 1, 0]];
    n.x = Math.round(x - t[0][2]);
    n.y = Math.round(y - t[1][2]);
    return n;
  }
  function placeBelow(n, ref, gap = 96) { const b = box(ref); return moveTo(n, b[0], b[1] + b[3] + gap); }
  function placeRight(n, ref, gap = 160) { const b = box(ref); return moveTo(n, b[0] + b[2] + gap, b[1]); }
  function clone(screen, opts = {}) {
    const c = screen.clone();
    if (opts.parent) opts.parent.appendChild(c);
    if (opts.name) c.name = opts.name;
    if (opts.below) placeBelow(c, screen, opts.gap == null ? 160 : opts.gap); else placeRight(c, screen, opts.gap == null ? 160 : opts.gap);
    return c;
  }
  function fit(section, pad = 320) {
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
    const kids = parent.children.filter((k) => k.visible !== false && k.type !== 'TEXT');
    const out = [];
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(box(kids[i]), box(kids[j]))) out.push([kids[i].id, kids[j].id]);
    return out.slice(0, 40);
  }
  async function check(list) {
    const out = { hoverMissing: [], hoverWrong: [], outside: [], overlaps: [] };
    const seen = new Set();
    for (const id of [].concat(list)) {
      const root = typeof id === 'string' ? await node(id) : id;
      const instances = root.type === 'INSTANCE' ? [root] : root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : [];
      for (const inst of instances.slice(0, 400)) {
        if (inst.visible === false) continue;
        const main = await inst.getMainComponentAsync();
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
      if (p && p.type === 'SECTION' && !seen.has(p.id)) { seen.add(p.id); out.overlaps.push(...overlaps(p).filter((pair) => pair.includes(root.id))); }
    }
    for (const k of Object.keys(out)) out[k] = out[k].slice(0, 30);
    out.ok = !out.hoverMissing.length && !out.hoverWrong.length && !out.outside.length && !out.overlaps.length;
    return out;
  }
  function tree(n, depth = 2, max = 150) {
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
  async function shot(n, opts) { if (typeof n === 'string') n = await node(n); await n.screenshot(opts); return n.id; }
  return { node, page, find, one, texts, setText, hoverOf, wireHover, setVariant, moveTo, placeBelow, placeRight, clone, fit, overlaps, check, tree, vars, bindColor, box, done, shot };
})();`;

/** Short reference for Claude, kept next to the code so the two stay in step. */
export const KIT_GUIDE = [
  'Design Studio adds a helper object DS to every use_figma script that mentions it (do not paste or define it):',
  '- DS.node(id): node by id, its page loaded; throws a clear message when the id is gone. DS.page(id): same, and makes its page current.',
  '- DS.find(root, name|"~part"|/re/|fn, type?) and DS.one(...) (first, or throws). DS.texts(root, "words") finds text layers by content.',
  '- DS.setText(textNode|id, "new text"): loads its fonts first. DS.bindColor(node, "fills"|"strokes", "variable/name").',
  '- DS.setVariant(instance|id, { State: "Default", Size: "Small" }): switches variant and points ON_HOVER at the matching Hover variant. DS.wireHover(instance) only rewires the hover. DS.hoverOf(variant) gives the Hover sibling.',
  '- DS.clone(screen, { name, below?, gap? }), DS.placeRight(node, ref, gap=160), DS.placeBelow(node, ref, gap=96), DS.moveTo(node, absX, absY), DS.fit(section, pad=320) grows a section around its children.',
  '- DS.check([ids]): hover missing or pointing at the wrong variant, children outside their frame, overlaps in the section. DS.overlaps(parent). DS.tree(node, depth=2): compact layer list for discovery.',
  '- DS.shot(node|id): screenshot returned inline with the result, so no get_screenshot call is needed. DS.done(value) keeps the return value under the size limit.',
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
 * Builds the code that runs: an optional version save, then the helpers and Claude's code in its own scope, so a
 * name Claude declares never clashes with one of ours. Returns null when nothing needs to change.
 */
export function wrapFigmaCode(code: string, opts: { save?: string | null }): string | null {
  const save = opts.save && !code.includes(CHECKPOINT) ? `await figma.${CHECKPOINT}(${JSON.stringify(opts.save.slice(0, 120))});\n` : '';
  const kit = usesKit(code);
  if (!save && !kit) return null;
  const out = kit ? `${save}${FIGMA_KIT}\nreturn await (async () => {\n${code}\n})();` : `${save}${code}`;
  return out.length <= MAX_CODE ? out : save ? `${save}${code}` : null;
}

export type FigmaCall = { code?: unknown; description?: unknown; [k: string]: unknown };

/**
 * What the use_figma hook does with one call. `needSave` is true until a version is saved in this turn.
 * The version save goes into the call itself, so the first edit of a turn costs no extra round trip.
 */
export function prepareFigmaCall(input: FigmaCall, needSave: boolean): { input: FigmaCall | null; saved: boolean } {
  const code = typeof input.code === 'string' ? input.code : '';
  // Code that does not parse fails before the save would run, so leave it alone and save with the next call.
  if (!code || !parsesSafely(code)) return { input: null, saved: false };
  const alreadySaves = code.includes(CHECKPOINT);
  const label = `Design Studio: ${String(input.description ?? 'edit').replace(/\s+/g, ' ').trim().slice(0, 80) || 'edit'}`;
  const wrapped = code ? wrapFigmaCode(code, { save: needSave ? label : null }) : null;
  return { input: wrapped ? { ...input, code: wrapped } : null, saved: needSave && (alreadySaves || (wrapped?.includes(CHECKPOINT) ?? false)) };
}
