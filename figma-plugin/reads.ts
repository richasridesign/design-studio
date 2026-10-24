// Design Studio's background reads of a file, run by the plugin (agent.ts) when the server asks for one by name.
// The server sends a name and plain arguments, never code. Each read is the same Plugin API code as the use_figma
// body the server sends through Claude when no plugin runs in the file (fileMap.ts MAP_SCRIPT, figmaCache.ts
// OUTLINE_SCRIPT and containingScript, dsSources.ts FIGMA_KIT_BODY, history.ts stickyScript, iterations.ts
// READ_SCRIPT), so both give the same value. server/src/figmaReads.test.ts runs both on one fake file to keep it so.
// All of them only read: pages are loaded, never switched to, and nothing is set.

const ids = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200).slice(0, max) : []);
const word = (v: unknown, fallback: string) => (typeof v === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : fallback);

/** Top-level frames, components and sections of every page (OUTLINE_SCRIPT). */
async function outline(figma: any) {
  const pages: any[] = [];
  for (const page of figma.root.children) {
    await page.loadAsync();
    const frames: any[] = [];
    for (const n of page.children) {
      if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(n.type)) frames.push([n.id, String(n.name).slice(0, 200), n.type, Math.round(n.width), Math.round(n.height)]);
    }
    pages.push([page.id, String(page.name).slice(0, 200), frames]);
  }
  return pages;
}

/** Pages, sections, screens, component sets, components, variables and styles (MAP_SCRIPT). */
async function map(figma: any) {
  const r = (v: any) => Math.round(Number(v || 0));
  const nm = (n: any, k = 90) => String(n.name == null ? '' : n.name).slice(0, k);
  const LETTER: Record<string, string> = { SECTION: 'S', FRAME: 'F', COMPONENT: 'C', COMPONENT_SET: 'K', INSTANCE: 'I', GROUP: 'G' };
  const isScreen = (n: any) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'GROUP' || (n.type === 'INSTANCE' && n.width >= 900);
  const isBox = (n: any) => n.type === 'SECTION' || (n.type === 'FRAME' && n.children.some((c: any) => c.type === 'SECTION'));
  function walk(n: any, depth: number): any[] {
    const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
    const row: any[] = [LETTER[n.type] || n.type, n.id, nm(n), r(b.x), r(b.y), r(b.width), r(b.height)];
    if (isBox(n) && depth < 6) {
      const kids: any[] = [];
      let other = 0;
      for (const c of n.children) { if (c.type === 'SECTION' || isScreen(c)) kids.push(walk(c, depth + 1)); else other++; }
      row.push(kids, other);
      if (n.type === 'SECTION') {
        let tag = null;
        try {
          const kind = n.getSharedPluginData('designstudio', 'kind');
          if (kind) tag = kind + ';' + n.getSharedPluginData('designstudio', 'iteration') + ';' + n.getSharedPluginData('designstudio', 'flow');
        } catch (e) {}
        row.push(tag);
      }
    }
    return row;
  }
  const pages: any[] = [];
  const sets: any[] = [];
  const comps: any[] = [];
  for (const page of figma.root.children) {
    await page.loadAsync();
    const top: any[] = [];
    for (const n of page.children) if (n.type === 'SECTION' || isScreen(n)) top.push(walk(n, 0));
    const starts = (page.flowStartingPoints || []).map((s: any) => [s.nodeId, String(s.name).slice(0, 80)]);
    pages.push([page.id, nm(page, 120), top, starts]);
    for (const s of page.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
      let defs: any[] = [];
      try {
        const d = s.componentPropertyDefinitions;
        defs = Object.keys(d).map((k) => [k, d[k].type, d[k].type === 'VARIANT' ? (d[k].variantOptions || []).slice(0, 30) : []]);
      } catch (e) {}
      const hasState = defs.some((d) => d[1] === 'VARIANT' && /state|interaction/i.test(d[0]));
      const variants = hasState ? s.children.slice(0, 120).map((c: any) => [c.id, nm(c, 160)]) : [];
      sets.push([s.id, nm(s), nm(page, 60), defs, variants]);
    }
    for (const c of page.findAllWithCriteria({ types: ['COMPONENT'] })) if (!c.parent || c.parent.type !== 'COMPONENT_SET') comps.push([c.id, nm(c), nm(page, 60)]);
  }
  const collections: Record<string, string> = {};
  for (const c of await figma.variables.getLocalVariableCollectionsAsync()) collections[c.id] = c.name;
  const vars = (await figma.variables.getLocalVariablesAsync()).slice(0, 1500).map((v: any) => [v.id, v.name, v.resolvedType, collections[v.variableCollectionId] || '']);
  const styles: any[] = [];
  for (const s of await figma.getLocalTextStylesAsync()) styles.push([s.id, s.name, 'text ' + (typeof s.fontSize === 'number' ? s.fontSize : '')]);
  for (const s of await figma.getLocalPaintStylesAsync()) styles.push([s.id, s.name, 'paint']);
  for (const s of await figma.getLocalEffectStylesAsync()) styles.push([s.id, s.name, 'effect']);
  return { pages, sets, comps, vars, styles };
}

/** Variables, paint and text styles, component sets and loose components, for the design system profile (FIGMA_KIT_BODY). */
async function kit(figma: any) {
  const hex = (c: any) => '#' + [c.r, c.g, c.b].map((x: number) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const colName: Record<string, string> = {}; const modeOf: Record<string, string> = {};
  for (const c of cols) { colName[c.id] = c.name; modeOf[c.id] = c.defaultModeId; }
  const variables: any[] = [];
  for (const v of (await figma.variables.getLocalVariablesAsync()).slice(0, 600)) {
    let val = v.valuesByMode[modeOf[v.variableCollectionId]];
    if (val && val.type === 'VARIABLE_ALIAS') {
      const t = await figma.variables.getVariableByIdAsync(val.id);
      val = t ? t.valuesByMode[modeOf[t.variableCollectionId]] ?? Object.values(t.valuesByMode)[0] : null;
    }
    if (v.resolvedType === 'COLOR' && val && typeof val === 'object' && 'r' in val) variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: 'COLOR', value: hex(val) });
    else if (v.resolvedType === 'FLOAT' && typeof val === 'number') variables.push({ name: v.name, collection: colName[v.variableCollectionId], type: 'FLOAT', value: val });
  }
  const paints = (await figma.getLocalPaintStylesAsync()).slice(0, 200).map((s: any) => {
    const p = s.paints[0];
    return { name: s.name, hex: p && p.type === 'SOLID' ? hex(p.color) : null };
  });
  const texts = (await figma.getLocalTextStylesAsync()).slice(0, 120).map((s: any) => ({
    name: s.name, family: s.fontName.family, style: s.fontName.style, size: s.fontSize,
    lineHeight: s.lineHeight.unit === 'PIXELS' ? s.lineHeight.value : s.lineHeight.unit === 'PERCENT' ? Math.round(s.lineHeight.value) + '%' : 'auto',
  }));
  const components: any[] = [];
  for (const page of figma.root.children) {
    if (components.length >= 200) break;
    try { await page.loadAsync(); } catch (e) { continue; }
    let found: any[] = [];
    try { found = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }); } catch (e) { found = []; }
    for (const n of found) {
      if (components.length >= 200) break;
      if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') continue;
      // A set with variant errors throws on its definitions; skip its variants, never the whole read.
      let variants: string[] = [];
      if (n.type === 'COMPONENT_SET') {
        try { variants = Object.entries(n.componentPropertyDefinitions as Record<string, any>).filter(([, d]) => d.type === 'VARIANT').map(([k, d]) => k + ': ' + (d.variantOptions || []).join(' / ')); } catch (e) { variants = []; }
      }
      try { components.push({ name: n.name, key: n.key, variants, description: n.description || '' }); } catch (e) { components.push({ name: n.name, key: '', variants, description: '' }); }
    }
  }
  return { file: figma.root.name, variables, paints, texts, components };
}

/** For each id, the screen it sits in (containingScript). */
async function containing(figma: any, args: any) {
  const out: Record<string, string> = {};
  const holder = (p: any) => p.type === 'PAGE' || p.type === 'DOCUMENT' || p.type === 'SECTION' || (p.type === 'FRAME' && (p.children || []).some((c: any) => c.type === 'SECTION'));
  const screen = (n: any) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'GROUP' || (n.type === 'INSTANCE' && n.width >= 900);
  for (const id of ids(args?.ids, 50)) {
    let n = await figma.getNodeByIdAsync(id);
    while (n && n.parent && !holder(n.parent)) n = n.parent;
    if (n && n.parent && !holder(n) && screen(n)) out[id] = n.id;
  }
  return out;
}

/** The screens and Decision stickies directly inside the given sections, and one level of sections in them (stickyScript). */
async function stickies(figma: any, args: any) {
  const list = ids(args?.ids, 200);
  const NS = word(args?.ns, 'designstudio_decision');
  const TAG = word(args?.tag, 'designstudio');
  const r = (v: any) => Math.round(Number(v || 0));
  const box = (n: any) => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { id: n.id, name: String(n.name || '').slice(0, 120), x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) }; };
  const cut = (s: any) => String(s == null ? '' : s).slice(0, 600);
  const DECISION = /^decision( sticky)?$/i;
  const NAMED = /^\s*decision\s*\d+\s*[·•:|-]/i;
  async function stickyOf(n: any) {
    const screen = n.getSharedPluginData ? n.getSharedPluginData(NS, 'screen') : '';
    if (n.type === 'STICKY') return { parts: [{ text: cut(n.text && n.text.characters) }], screen };
    if (n.type !== 'INSTANCE' && n.type !== 'FRAME' && n.type !== 'GROUP') return null;
    let isDecision = !!screen || NAMED.test(n.name || '');
    if (n.type === 'INSTANCE') {
      const main = await n.getMainComponentAsync();
      const owner = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
      if (owner && DECISION.test(String(owner.name || '').trim())) isDecision = true;
    }
    if (!isDecision) return null;
    const parts: Array<{ key?: string; text: string }> = [];
    if (n.type === 'INSTANCE') {
      for (const [key, p] of Object.entries(n.componentProperties || {}) as Array<[string, any]>) if (p && p.type === 'TEXT') parts.push({ key, text: cut(p.value) });
    }
    if (!parts.length) for (const t of n.findAll((x: any) => x.type === 'TEXT')) parts.push({ text: cut(t.characters) });
    return { parts, screen };
  }
  const out: { screens: any[]; stickies: any[]; missing: string[] } = { screens: [], stickies: [], missing: [] };
  async function walk(sec: any, depth: number) {
    for (const n of sec.children) {
      if (n.type === 'SECTION') { if (depth < 1) await walk(n, depth + 1); continue; }
      const s = await stickyOf(n);
      if (s) {
        const num = Number(n.getSharedPluginData ? n.getSharedPluginData(NS, 'n') : '') || undefined;
        const it = n.getSharedPluginData ? n.getSharedPluginData(NS, 'iteration') : '';
        out.stickies.push({ ...box(n), ...(s.screen ? { screen: s.screen } : {}), ...(num ? { n: num } : {}), ...(it ? { iteration: it } : {}), parts: s.parts });
        continue;
      }
      if (n.type !== 'FRAME' && n.type !== 'COMPONENT' && n.type !== 'INSTANCE') continue;
      if (/\(entry, unchanged\)/i.test(n.name || '') || (n.getSharedPluginData && n.getSharedPluginData(TAG, 'kind') === 'entry')) continue;
      out.screens.push(box(n));
    }
  }
  for (const id of list) {
    const sec = await figma.getNodeByIdAsync(id);
    if (!sec || !('children' in sec)) { out.missing.push(id); continue; }
    await walk(sec, 0);
  }
  return out;
}

/** An iteration section, its flow subsections and its nearest neighbours above and below, for the restack (READ_SCRIPT). */
async function restack(figma: any, args: any) {
  const id = ids([args?.id], 1)[0];
  const TAG = word(args?.tag, 'designstudio');
  const s = id ? await figma.getNodeByIdAsync(id) : null;
  if (!s || s.type !== 'SECTION') return null;
  const box = (n: any) => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const kids = s.children.filter((c: any) => c.type === 'SECTION').map((c: any) => ({ id: c.id, ...box(c), flow: c.getSharedPluginData(TAG, 'flow') || null }));
  const page = s.parent;
  const others = page && page.type === 'PAGE' ? page.children.filter((c: any) => c !== s) : [];
  // Below: the nearest node whose top is under this section's top, so a section that already grew into it still counts.
  const belowAll = others.filter((c: any) => c.y > s.y);
  const below = belowAll.length ? belowAll.reduce((a: any, b: any) => (b.y < a.y ? b : a)) : null;
  const aboveAll = others.filter((c: any) => c.y < s.y);
  const above = aboveAll.length ? aboveAll.reduce((a: any, b: any) => (b.y + b.height > a.y + a.height ? b : a)) : null;
  return { section: { id: s.id, ...box(s) }, kids, below: below ? { id: below.id, ...box(below) } : null, above: above ? { id: above.id, ...box(above) } : null };
}

export const READS: Record<string, (figma: any, args: any) => Promise<unknown>> = { outline, map, kit, containing, stickies, restack };
export const READ_NAMES = Object.keys(READS);
