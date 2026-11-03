import { useEffect, useState } from 'react';
import type { CanvasOp } from '../../../../../shared/canvas';
import {
  dimOf, KEYWORDS, keyword, layoutOf, pixels, RADIUS, setClass, setDim, setKeyword, setLayout, SPACE, styleClasses, TEXT,
  type ClassKind, type Dim, type KeywordGroup, type Layout, type StyleClass, type Tokens,
} from '../../../../../shared/canvas';

// The element's Tailwind classes as design controls, grouped like Figma's right panel: Layout, Size, Text, Fill.
// Each control rewrites one class in className; hover:, breakpoint and unknown classes are left alone and stay in
// the raw Classes field. Classes the groups do not cover (margins, one-side padding) are listed under More.

type Apply = (op: CanvasOp, label: string) => Promise<void>;

const LAYOUTS: [Layout, string][] = [['block', 'Block'], ['row', 'Row'], ['column', 'Column'], ['grid', 'Grid']];
const DIMS: [Dim['mode'], string][] = [['auto', 'Auto'], ['fill', 'Fill'], ['hug', 'Hug'], ['fixed', 'Fixed']];
/** The prefix and kind pairs the groups show; any other style class goes under More. */
const GROUPED = new Set(['gap:space', 'p:space', 'px:space', 'py:space', 'text:size', 'text:color', 'bg:color', 'border:color', 'rounded:radius']);

function optionsFor(kind: ClassKind, t: Tokens): string[] {
  if (kind === 'space') return SPACE;
  if (kind === 'radius') return [...Object.keys(RADIUS), ...t.radius.map((r) => r.name)];
  if (kind === 'size') return [...t.text.map((r) => r.name), ...Object.keys(TEXT)];
  return t.colors.map((r) => r.name);
}

export function StyleRows({ className, tokens, apply }: { className: string; tokens: Tokens; apply: Apply }) {
  const found = styleClasses(className, tokens);
  const write = (next: string, label: string) => { if (next !== className) void apply({ kind: 'attr', name: 'className', value: next }, label); };

  /** A token menu for one prefix and kind, with None to take the class out. */
  const token = (prefix: string, kind: ClassKind, label: string) => {
    const value = found.find((c) => c.prefix === prefix && c.kind === kind)?.value ?? '';
    const options = optionsFor(kind, tokens);
    return (
      <label key={`${prefix}:${kind}`} className="cv-field cv-style-row">
        <span>{label}</span>
        {kind === 'color' && value && <i className="cv-swatch" style={{ background: pixels({ kind }, value, tokens) }} />}
        <select value={value} onChange={(e) => write(setClass(className, prefix, kind, e.target.value || null, tokens), `${label} ${e.target.value || 'removed'}`)}>
          <option value="">None</option>
          {(value && !options.includes(value) ? [value, ...options] : options).map((o) => <option key={o} value={o}>{kind === 'color' ? o : `${pixels({ kind }, o, tokens)} · ${o}`}</option>)}
        </select>
      </label>
    );
  };
  const kw = (g: KeywordGroup) => {
    const k = KEYWORDS[g];
    const value = keyword(className, g);
    return (
      <label key={g} className="cv-field cv-style-row">
        <span>{k.label}</span>
        <select value={value} onChange={(e) => write(setKeyword(className, g, e.target.value), `${k.label} ${(k.options as Record<string, string>)[e.target.value]}`)}>
          {Object.entries(k.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    );
  };

  const layout = layoutOf(className);
  const flex = layout === 'row' || layout === 'column';
  const hasBorder = keyword(className, 'border') !== '';
  const more = found.filter((c) => !GROUPED.has(`${c.prefix}:${c.kind}`));

  return (
    <>
      <section className="cv-style" aria-label="Layout">
        <span className="cv-label">Layout</span>
        <div className="cv-segments" role="group" aria-label="Layout">
          {LAYOUTS.map(([l, label]) => <button key={l} className={layout === l ? 'active' : ''} aria-pressed={layout === l} onClick={() => write(setLayout(className, l), `Layout ${label}`)}>{label}</button>)}
        </div>
        {(flex || layout === 'grid') && kw('align')}
        {flex && kw('justify')}
        {layout === 'row' && kw('wrap')}
        {layout !== 'block' && token('gap', 'space', 'Gap')}
        {found.some((c) => c.prefix === 'p') ? token('p', 'space', 'Padding') : <>{token('px', 'space', 'Padding x')}{token('py', 'space', 'Padding y')}</>}
      </section>
      <section className="cv-style" aria-label="Size">
        <span className="cv-label">Size</span>
        <DimRow label="Width" dim={dimOf(className, 'w')} set={(d) => write(setDim(className, 'w', d), `Width ${d.mode === 'fixed' ? `${d.px}px` : d.mode}`)} />
        <DimRow label="Height" dim={dimOf(className, 'h')} set={(d) => write(setDim(className, 'h', d), `Height ${d.mode === 'fixed' ? `${d.px}px` : d.mode}`)} />
      </section>
      <section className="cv-style" aria-label="Text">
        <span className="cv-label">Text</span>
        {token('text', 'size', 'Size')}
        {kw('weight')}
        {token('text', 'color', 'Colour')}
        {kw('textAlign')}
        {kw('truncate')}
      </section>
      <section className="cv-style" aria-label="Fill and border">
        <span className="cv-label">Fill and border</span>
        {token('bg', 'color', 'Fill')}
        {kw('border')}
        {hasBorder && token('border', 'color', 'Border colour')}
        {token('rounded', 'radius', 'Radius')}
        {kw('shadow')}
      </section>
      {more.length > 0 && (
        <section className="cv-style" aria-label="More">
          <span className="cv-label">More</span>
          {more.map((c: StyleClass) => token(c.prefix, c.kind, c.label))}
        </section>
      )}
    </>
  );
}

/** Width or height as Auto, Fill, Hug or Fixed, with the pixels when fixed. */
function DimRow({ label, dim, set }: { label: string; dim: Dim; set: (d: Dim) => void }) {
  const [px, setPx] = useState(String(dim.px ?? ''));
  useEffect(() => setPx(String(dim.px ?? '')), [dim.px]);
  const commit = () => { const n = Math.round(Number(px)); if (n > 0 && n <= 4000 && n !== dim.px) set({ mode: 'fixed', px: n }); else setPx(String(dim.px ?? '')); };
  return (
    <div className={`cv-field cv-style-row cv-dim${dim.mode === 'fixed' ? ' fixed' : ''}`}>
      <span>{label}</span>
      <select aria-label={label} value={dim.mode} onChange={(e) => {
        const mode = e.target.value as Dim['mode'];
        set(mode === 'fixed' ? { mode, px: dim.px ?? 160 } : { mode });
      }}>
        {DIMS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
      </select>
      {dim.mode === 'fixed' && <input className="cv-px" aria-label={`${label} in pixels`} inputMode="numeric" value={px} onChange={(e) => setPx(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />}
    </div>
  );
}
