import { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from '../../../store';
import { Icon } from '../../../Icon';
import { insertPrompt } from '../../composerEvents';
import type { CanvasAttr, CanvasComponent, CanvasElement, CanvasOp, CanvasProp, Frame } from '../../../../../shared/canvas';
import type { Tokens } from '../../../../../shared/canvas';
import { StyleRows } from './StyleRows';

// The inspector for a picked element. A pick has layers: the element itself and the component uses around it
// (the h1 inside PageHeader, then <PageHeader title="..."> in the screen). Text that comes from a prop can only be
// changed at the use, so the panel opens on the innermost layer outside the base components, and shows that
// component's props like Figma component properties: variants as menus, booleans as switches, text as fields.

export type Layer = { src: string; name: string; component: boolean };
export type Picked = { frame: string; src: string; tag: string; layers: Layer[] };

const fileOf = (src: string) => src.replace(/:\d+:\d+$/, '');
const isBase = (src: string) => /^src\/components\//.test(fileOf(src));
const unquote = (v?: string) => (v && /^(['"`]).*\1$/.test(v) ? v.slice(1, -1) : v);
/** Props a designer has no reason to touch here. */
const HIDDEN = new Set(['key', 'ref', 'children', 'className', 'style']);

/** The layer to open first: the innermost one written outside the base components, else the element. */
export const defaultLayer = (layers: Layer[]) => Math.max(0, layers.findIndex((l) => !isBase(l.src)));

// The app's theme tokens change only when the profile is refreshed, so one read per page load is enough.
let tokensOnce: Promise<Tokens> | null = null;
const loadTokens = () => (tokensOnce ??= getJson<Tokens>('/api/canvas/tokens').catch(() => { tokensOnce = null; return { colors: [], text: [], radius: [] }; }));

export function ElementPanel({ picked, frame, onEdited, onGone }: { picked: Picked; frame: Frame | null; onEdited: () => void; onGone: () => void }) {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  useEffect(() => { void loadTokens().then(setTokens); }, []);
  const layers = picked.layers.length ? picked.layers : [{ src: picked.src, name: picked.tag, component: false }];
  const [at, setAt] = useState(() => defaultLayer(layers));
  useEffect(() => setAt(defaultLayer(layers)), [picked.src, picked.frame]); // eslint-disable-line react-hooks/exhaustive-deps
  const layer = layers[Math.min(at, layers.length - 1)];

  const [el, setEl] = useState<CanvasElement | null>(null);
  const [component, setComponent] = useState<CanvasComponent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getJson<{ element: CanvasElement }>(`/api/canvas/inspect?src=${encodeURIComponent(layer.src)}`);
      setEl(r.element);
      setError('');
      // A component's props come from the file it is defined in, which the engine finds through this file's imports.
      if (/^[A-Z]/.test(r.element.tag)) {
        const p = await getJson<{ file: string; components: CanvasComponent[] }>(`/api/canvas/props?file=${encodeURIComponent(fileOf(layer.src))}&name=${encodeURIComponent(r.element.tag)}`).catch(() => null);
        setComponent(p?.components[0] ?? null);
      } else setComponent(null);
    } catch (e) {
      setEl(null);
      setError((e as Error).message);
    }
  }, [layer.src]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEl(null); setComponent(null); void load(); }, [load]);

  const apply = async (op: CanvasOp, label: string) => {
    if (!el) return;
    setBusy(true);
    try {
      await postJson('/api/canvas/edit', { src: layer.src, tag: el.tag, op, label: `${label} · ${fileOf(layer.src).replace(/^src\//, '')}` });
      setError('');
      onEdited();
      // Removing, copying or moving shifts the element's place in its file, so the pick no longer points at it.
      if (op.kind !== 'text' && op.kind !== 'attr' && op.kind !== 'flag') { onGone(); return; }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    const where = frame ? ` in the "${frame.name}" frame (${frame.route}, ${frame.scenario} state)` : '';
    insertPrompt(`On the canvas${where}, the ${layer.component ? `<${layer.name}>` : layer.name} at app/${layer.src}: `);
  };

  const attrs = el?.attrs ?? [];
  const attr = (name: string) => attrs.find((a) => a.name === name);
  const propNames = new Set(component?.props.map((p) => p.name));
  const rest = attrs.filter((a) => !propNames.has(a.name) && !HIDDEN.has(a.name));
  const classes = attr('className');

  return (
    <div className="cv-panel" aria-busy={busy}>
      {layers.length > 1 && (
        <nav className="cv-layers" aria-label="Layers">
          {[...layers].reverse().map((l) => {
            const i = layers.indexOf(l);
            return (
              <button key={l.src} className={i === at ? 'active' : ''} aria-pressed={i === at} onClick={() => setAt(i)} title={l.src}>
                {l.component ? l.name : `<${l.name}>`}
              </button>
            );
          })}
        </nav>
      )}
      <h2>{layer.component ? layer.name : <code>&lt;{el?.tag ?? layer.name}&gt;</code>}</h2>
      <p className="cv-src" title={layer.src}>{fileOf(layer.src).replace(/^src\//, '')}</p>
      {isBase(layer.src) && <p className="cv-note">This is inside a base component, so a change here applies to every use of it.</p>}
      {el && (
        <>
          {el.text !== null && <Field key={`text:${layer.src}:${el.text}`} label="Text" value={el.text} multiline onCommit={(v) => apply({ kind: 'text', value: v }, `Text "${v.slice(0, 40)}"`)} />}
          {component?.props.filter((p) => !HIDDEN.has(p.name)).map((p) => <PropRow key={`${layer.src}:${p.name}:${JSON.stringify(attr(p.name))}`} prop={p} attr={attr(p.name)} apply={apply} />)}
          {rest.map((a) => <AttrRow key={`${layer.src}:${a.name}:${a.value ?? a.raw}`} a={a} apply={apply} />)}
          {classes?.kind === 'string' && tokens && <StyleRows className={classes.value ?? ''} tokens={tokens} apply={apply} />}
          {classes && (
            <details className="cv-more">
              <summary>Classes</summary>
              <AttrRow key={`${layer.src}:className:${classes.value ?? classes.raw}`} a={classes} apply={apply} />
            </details>
          )}
        </>
      )}
      {el && (
        <div className="cv-el-actions" role="group" aria-label="Element">
          <button className="ghost" title="Move up, before the element above it" aria-label="Move up" onClick={() => void apply({ kind: 'move', by: -1 }, `Moved ${el.tag} up`)}><Icon name="arrow-up" /></button>
          <button className="ghost" title="Move down, after the element below it" aria-label="Move down" onClick={() => void apply({ kind: 'move', by: 1 }, `Moved ${el.tag} down`)}><Icon name="arrow-down" /></button>
          <button className="ghost" title="Duplicate" aria-label="Duplicate" onClick={() => void apply({ kind: 'duplicate' }, `Duplicated ${el.tag}`)}><Icon name="copy" /></button>
          <button className="ghost danger" title="Delete" aria-label="Delete" onClick={() => void apply({ kind: 'remove' }, `Removed ${el.tag}`)}><Icon name="trash" /></button>
          <select className="cv-el-more" value="" aria-label="Wrap or add" onChange={(e) => { const a = MORE[Number(e.target.value)]; if (a) void apply(a.op, `${a.label} · ${el.tag}`); }}>
            <option value="">Wrap or add…</option>
            {MORE.map((a, i) => <option key={a.label} value={i}>{a.label}</option>)}
          </select>
        </div>
      )}
      {error && <p className="cv-error" role="alert">{error}</p>}
      <button className="cv-ask" onClick={ask}><Icon name="comment" small /> Ask Claude about this</button>
    </div>
  );
}

type Apply = (op: CanvasOp, label: string) => Promise<void>;

/** Structure changes: a new auto layout around the element, or a new element after it. */
const MORE: { label: string; op: CanvasOp }[] = [
  { label: 'Wrap in a row', op: { kind: 'wrap', class: 'flex items-center gap-2' } },
  { label: 'Wrap in a column', op: { kind: 'wrap', class: 'flex flex-col gap-2' } },
  { label: 'Add text after', op: { kind: 'add', tag: 'p', class: 'text-sm', text: 'New text' } },
  { label: 'Add a heading after', op: { kind: 'add', tag: 'h2', class: 'text-lg font-semibold', text: 'New heading' } },
  { label: 'Add a box after', op: { kind: 'add', tag: 'div', class: 'p-4 rounded-lg border', text: '' } },
];

/** One component prop at its use. A string written at the use is always editable, whatever the prop's type says. */
function PropRow({ prop, attr, apply }: { prop: CanvasProp; attr?: CanvasAttr; apply: Apply }) {
  const t = prop.type;
  const fallback = unquote(prop.default);
  if (attr?.kind === 'expr' && !(t.kind === 'boolean' && (attr.raw === '{true}' || attr.raw === '{false}'))) {
    return <div className="cv-field"><span>{prop.name}</span><code className="cv-expr" title="Set by code. Ask Claude to change it">{attr.raw}</code></div>;
  }
  if (t.kind === 'variant') {
    const value = attr?.value ?? fallback ?? '';
    return (
      <label className="cv-field">
        <span>{prop.name}</span>
        <select value={value} onChange={(e) => {
          const v = e.target.value;
          void apply(v === fallback || v === '' ? { kind: 'attr', name: prop.name, value: null } : { kind: 'attr', name: prop.name, value: v }, `${prop.name} ${v || 'default'}`);
        }}>
          {!fallback && <option value="">None</option>}
          {t.options.map((o) => <option key={o} value={o}>{o}{o === fallback ? ' (default)' : ''}</option>)}
        </select>
      </label>
    );
  }
  if (t.kind === 'boolean') {
    const on = attr ? attr.kind === 'bool' || attr.raw === '{true}' : fallback === 'true';
    // Back at the default, the attribute goes; otherwise it is written as `name` or `name={false}`.
    const set = (v: boolean) => apply(v === (fallback === 'true') ? { kind: 'attr', name: prop.name, value: null } : { kind: 'flag', name: prop.name, value: v }, `${prop.name} ${v ? 'on' : 'off'}`);
    return (
      <label className="cv-field cv-row">
        <span>{prop.name}</span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void set(e.target.checked)} />
      </label>
    );
  }
  if (attr?.kind === 'string' || t.kind === 'string') {
    return <Field label={prop.name} value={attr?.value ?? ''} placeholder={fallback} onCommit={(v) => apply({ kind: 'attr', name: prop.name, value: v === '' && prop.optional ? null : v }, `${prop.name} "${v.slice(0, 40)}"`)} />;
  }
  return null;
}

function AttrRow({ a, apply }: { a: CanvasAttr; apply: Apply }) {
  if (a.kind === 'string') {
    return (
      <Field label={a.name} value={a.value ?? ''} multiline={a.name === 'className'} mono={a.name === 'className'}
        onCommit={(v) => apply({ kind: 'attr', name: a.name, value: v }, `${a.name} "${v.slice(0, 40)}"`)} onRemove={() => apply({ kind: 'attr', name: a.name, value: null }, `Removed ${a.name}`)} />
    );
  }
  if (a.kind === 'bool') return <div className="cv-field cv-row"><span>{a.name}</span><button className="ghost" onClick={() => apply({ kind: 'attr', name: a.name, value: null }, `Removed ${a.name}`)}>Remove</button></div>;
  return <div className="cv-field"><span>{a.name}</span><code className="cv-expr" title="Set by code. Ask Claude to change it">{a.raw}</code></div>;
}

function Field({ label, value, placeholder, multiline, mono, onCommit, onRemove }: { label: string; value: string; placeholder?: string; multiline?: boolean; mono?: boolean; onCommit: (v: string) => void; onRemove?: () => void }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v !== value) onCommit(v); };
  const props = {
    value: v,
    placeholder,
    className: mono ? 'mono' : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') setV(value);
    },
  };
  return (
    <label className="cv-field">
      <span className="cv-row">{label}{onRemove && <button type="button" className="ghost cv-remove" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={onRemove}><Icon name="close" small /></button>}</span>
      {multiline ? <textarea rows={Math.min(5, Math.max(2, Math.ceil(v.length / 34)))} {...props} /> : <input {...props} />}
    </label>
  );
}
