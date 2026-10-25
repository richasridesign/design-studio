import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getJson, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { IconButton } from '../Tip';
import { Rules } from './Rules';
import { Section } from '../Section';
import { FORMATS, type TokenFormat } from '../tokens';
import type { DesignSystem as DS } from '../../../shared/design';
import { STARTERS } from '../../../shared/dsProfiles';
import { DsEditor, changeDs } from './DsEditor';
import { COMPONENT_GROUPS, COMPONENT_HEADINGS, CONTENT_SLOTS, DATAVIZ_SLOTS, FOUNDATION_SLOTS, GOVUK_PRINCIPLES, OWN_PRINCIPLES, PATTERN_SLOTS, componentGroup, groupColors, groupComponents, type Principle } from '../../../shared/dsCatalog';
import '../dsNav.css';

type SkillFile = { folder: string; path: string; lines: number };
type SectionId = 'principles' | 'foundations' | 'components' | 'patterns' | 'content' | 'dataviz' | 'guidelines' | 'export';
type FoundationId = 'colour' | 'type' | 'spacing' | 'radius' | 'icons';
/** Where the pane is: the home list, one section, or one item inside it. Elastic UI's docs work the same way. */
type Page = { at: 'home' } | { at: 'section'; id: SectionId } | { at: 'foundation'; id: FoundationId } | { at: 'component'; key: string };

const SECTIONS: Record<SectionId, string> = {
  principles: 'Principles',
  foundations: 'Foundations',
  components: 'Components',
  patterns: 'Patterns',
  content: 'Content',
  dataviz: 'Data visualisation',
  guidelines: 'Guidelines',
  export: 'Export tokens',
};
const FOUNDATIONS: Record<FoundationId, string> = { colour: 'Colour', type: 'Typography', spacing: 'Spacing and sizing', radius: 'Radius and borders', icons: 'Iconography' };

/** Figma variant properties, read as "Type: Primary / Secondary". */
const props = (c: DS['components'][number]) => (c.variants ?? []).map((v) => {
  const at = v.indexOf(':');
  return at < 0 ? { name: 'Variant', values: v.split(' / ') } : { name: v.slice(0, at).trim(), values: v.slice(at + 1).split(' / ').map((x) => x.trim()).filter(Boolean) };
});
const propsLine = (c: DS['components'][number]) => {
  const n = c.variants?.length ?? 0;
  return n ? `${n} ${n === 1 ? 'property' : 'properties'}` : '';
};

function PropList({ list }: { list: ReturnType<typeof props> }) {
  return (
    <dl className="dsn-props">
      {list.map((p) => <div key={p.name}><dt>{p.name}</dt><dd>{p.values.join(', ')}</dd></div>)}
    </dl>
  );
}

const compKey = (c: { key?: string; name: string }, i: number) => c.key ?? `${c.name}#${i}`;
const skillName = (folder: string) => folder.charAt(0).toUpperCase() + folder.slice(1).replace(/-/g, ' ');

/** A row that opens a page: the whole row is the target, with its count and a chevron. Without onClick it is a plain row that says what is missing. */
function Row({ label, meta, onClick, tag }: { label: string; meta?: string; onClick?: () => void; tag?: string }) {
  const inner = <><span className="dsn-label">{label}</span>{tag && <span className="dsn-tag">{tag}</span>}<span className="dsn-meta">{meta}</span>{onClick && <Icon name="chevron-right" small />}</>;
  return onClick
    ? <li><button className="dsn-row" onClick={onClick}>{inner}</button></li>
    : <li className="dsn-row dsn-empty">{inner}</li>;
}

function Back({ to, label, go }: { to: Page; label: string; go: (p: Page) => void }) {
  return <button className="dsn-back" onClick={() => go(to)}><Icon name="arrow-left" small /> {label}</button>;
}

function Principles({ list }: { list: Principle[] }) {
  return (
    <ol className="dsn-principles">
      {list.map((p) => <li key={p.title}><span className="t">{p.title}</span><span className="d">{p.means}</span></li>)}
    </ol>
  );
}

function Swatches({ list }: { list: DS['colors'] }) {
  return (
    <ul className="swatches">
      {list.map((c) => (
        <li key={c.name} title={`${c.name}\n${c.value}${c.variable ? `\n${c.variable}` : ''}`}>
          <span className="swatch" style={{ background: c.value }} />
          <span className="sw-name">{c.name.replace(/\//g, '/\u200b')}</span>
          <span className="sw-value">{c.value}</span>
        </li>
      ))}
    </ul>
  );
}

function TextStyles({ list }: { list: DS['text'] }) {
  return (
    <ul className="type-list">
      {list.map((t) => (
        <li key={t.name}>
          <span className="type-sample" style={{ fontSize: Math.min(28, Math.max(12, t.size ?? 16)), fontWeight: Number(t.weight) || 400 }}>{t.name}</span>
          <span className="sw-value">{[t.size && `${t.size}px`, t.weight, t.lineHeight && `/ ${t.lineHeight}`].filter(Boolean).join(' ')}</span>
        </li>
      ))}
    </ul>
  );
}

/** Slots with nothing in them yet, so it is clear where things will go. */
function Slots({ list }: { list: readonly string[] }) {
  return (
    <>
      <p className="dsn-p">Nothing here yet. These are the parts this section will hold.</p>
      <ul className="dsn-list">{list.map((s) => <Row key={s} label={s} meta="Nothing yet" />)}</ul>
    </>
  );
}


function ExportTokens({ ds }: { ds: DS }) {
  const [format, setFormat] = useState<TokenFormat>('css');
  const [copied, setCopied] = useState(false);
  const f = FORMATS[format];
  const code = useMemo(() => f.build(ds), [ds, f]);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: f.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.file;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="side-section token-export">
      <div className="side-label">Export tokens</div>
      <div className="seg" role="group" aria-label="Token format">
        {(Object.keys(FORMATS) as TokenFormat[]).map((k) => (
          <button key={k} aria-pressed={k === format} className={k === format ? 'on' : ''} onClick={() => setFormat(k)}>{FORMATS[k].label}</button>
        ))}
      </div>
      <pre className="token-code" tabIndex={0}>{code}</pre>
      <div className="token-actions">
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={download}>Download {f.file}</button>
      </div>
    </section>
  );
}

export function DesignSystem() {
  const chat = useStore((s) => s.session.id);
  const figma = useStore((s) => s.session.figma);
  const rev = useRev('design-system.json');
  const [ds, setDs] = useState<DS | null>(null);
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState<Page>({ at: 'home' });
  const [reading, setReading] = useState(false);
  const [readSaid, setReadSaid] = useState('');

  useEffect(() => {
    getJson<DS | null>('/api/design-system').then(setDs).catch(() => setDs(null));
    getJson<{ skills: SkillFile[] }>('/api/design-system/view').then((v) => setSkills(v.skills)).catch(() => setSkills([]));
  }, [chat, rev]);
  useEffect(() => { setReadSaid(''); setPage({ at: 'home' }); setQ(''); }, [chat]);
  const scroller = useRef<HTMLDivElement>(null);
  const go = (p: Page) => { setPage(p); scroller.current?.scrollTo(0, 0); };

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const [editing, setEditing] = useState<false | true | 'code'>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Reads the file quietly through the Figma plugin, the same read as Read again in the editor. Nothing goes in the chat.
  const readFigma = async () => {
    setReading(true);
    setReadSaid('');
    try {
      const before = ds ? ds.colors.length + ds.text.length + ds.components.length : 0;
      const r = await changeDs({ action: 'figma' });
      setDs(r.ds);
      const src = r.ds?.sources?.find((x) => x.kind === 'figma');
      const n = r.ds ? r.ds.colors.filter((c) => c.from === 'figma').length + r.ds.text.filter((t) => t.from === 'figma').length + r.ds.components.filter((c) => c.from === 'figma').length : 0;
      const added = r.ds ? r.ds.colors.length + r.ds.text.length + r.ds.components.length - before : 0;
      const cost = r.costUsd ? ` Cost: $${r.costUsd.toFixed(3)}.` : '';
      setReadSaid(src && 'error' in src && src.error
        ? `Could not read the Figma file: ${src.error}`
        : !n ? `Read the Figma file: no local variables, styles or components.${cost}`
        : `Read the Figma file: ${n} ${n === 1 ? 'item' : 'items'}${added > 0 ? `, ${added} new` : ', nothing new'}.${cost}`);
    } catch (e) {
      setReadSaid((e as Error).message);
    } finally {
      setReading(false);
    }
  };
  const start = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const next = (await changeDs({ action: 'starter', id })).ds;
      setDs(next);
      if (id === 'code') setEditing('code');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const editor = editing && <DsEditor focus={editing === 'code' ? 'code' : undefined} onClose={() => { setEditing(false); getJson<DS | null>('/api/design-system').then(setDs).catch(() => {}); }} />;

  const groups = useMemo(() => groupComponents(ds?.components ?? []), [ds]);
  const keyed = useMemo(() => new Map((ds?.components ?? []).map((c, i) => [compKey(c, i), c])), [ds]);

  if (!ds) {
    return (
      <div className="side-scroll">
        <section className="side-section ds-start">
          <h2 className="ds-start-h">Design system</h2>
          <p className="ds-start-p">Optional. Designs and reviews work without one. Start from:</p>
          <ul className="ds-starters">
            {STARTERS.map((st) => (
              <li key={st.id}>
                <button disabled={busy} onClick={() => start(st.id)} title={st.detail}>
                  <span className="t">{st.name}</span>
                  <span className="d">{st.detail}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="ds-link" onClick={() => setEditing(true)}>Or add sources yourself</button>
          {error && <p className="ds-err" role="alert">{error}</p>}
        </section>
        <Section view="system" id="rules" title="House rules"><Rules /></Section>
        {editor}
      </div>
    );
  }

  const icons = groups.get('Icons') ?? [];
  const product = (ds.components ?? []).length - icons.length;
  const filledGroups = COMPONENT_GROUPS.filter((g) => g !== 'Icons' && g !== 'Deprecated' && groups.get(g)!.length).length;
  const fromFigma = (ds.sources ?? []).find((x) => x.kind === 'figma');
  const sub = fromFigma && fromFigma.kind === 'figma'
    ? `${fromFigma.name} · read from Figma ${new Date(fromFigma.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    : ds.name || `${(ds.sources ?? []).length} ${(ds.sources ?? []).length === 1 ? 'source' : 'sources'}`;
  const foundationCount: Record<FoundationId, number> = { colour: ds.colors.length, type: ds.text.length, spacing: ds.spacing.length, radius: ds.radius.length, icons: icons.length };
  const filledFoundations = Object.values(foundationCount).filter(Boolean).length;
  const principleCount = GOVUK_PRINCIPLES.length + OWN_PRINCIPLES.length + ds.rules.length;
  const openComp = (c: DS['components'][number]) => go({ at: 'component', key: compKey(c, ds.components.indexOf(c)) });
  const compRows = (list: DS['components']) => (
    <ul className="dsn-list">
      {[...list].sort((a, b) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' })).map((c) => <Row key={compKey(c, ds.components.indexOf(c))} label={c.name.trim()} meta={propsLine(c)} onClick={() => openComp(c)} />)}
    </ul>
  );

  let view: ReactNode;
  if (page.at === 'home') {
    const found = q.trim() ? {
      colors: ds.colors.filter((c) => match(c.name) || match(c.value)),
      text: ds.text.filter((t) => match(t.name)),
      comps: ds.components.filter((c) => match(c.name)),
      principles: [...GOVUK_PRINCIPLES, ...OWN_PRINCIPLES].filter((p) => match(p.title) || match(p.means)),
    } : null;
    view = (
      <>
        <section className="side-section">
          <div className="ds-head">
            <h2 className="ds-name">Design system</h2>
            <button className="ds-edit" onClick={() => setEditing(true)}>Edit</button>
          </div>
          <div className="ds-meta">
            <span>{[sub, ds.tokens === false ? 'Lo-fi: no token checks' : ''].filter(Boolean).join(' · ')}</span>
            {figma && (
              <IconButton className="icon-btn" label={reading ? 'Reading the Figma file' : fromFigma ? 'Read the Figma file again' : 'Read variables and components from Figma'} disabled={reading} onClick={() => void readFigma()}>
                <Icon name={reading ? 'loading' : 'sync'} small spin={reading} />
              </IconButton>
            )}
          </div>
          <p className="ds-read" role="status">{reading ? 'Reading through the Figma plugin…' : readSaid}</p>
          <input type="search" aria-label="Search the design system" placeholder="Search colours, components, principles" value={q} onChange={(e) => setQ(e.target.value)} />
        </section>
        {found ? (
          <section className="side-section">
            {!found.colors.length && !found.text.length && !found.comps.length && !found.principles.length && <p className="dsn-p">Nothing matches “{q.trim()}”.</p>}
            {found.colors.length > 0 && <><h3 className="dsn-h">Colour <span className="count">{found.colors.length}</span></h3><Swatches list={found.colors} /></>}
            {found.text.length > 0 && <><h3 className="dsn-h">Typography <span className="count">{found.text.length}</span></h3><TextStyles list={found.text} /></>}
            {found.comps.length > 0 && <><h3 className="dsn-h">Components <span className="count">{found.comps.length}</span></h3>{compRows(found.comps)}</>}
            {found.principles.length > 0 && <><h3 className="dsn-h">Principles <span className="count">{found.principles.length}</span></h3><Principles list={found.principles} /></>}
          </section>
        ) : (
          <section className="side-section">
            <ul className="dsn-list dsn-top">
              <Row label={SECTIONS.principles} tag="Shared" meta={String(principleCount)} onClick={() => go({ at: 'section', id: 'principles' })} />
              <Row label={SECTIONS.foundations} meta={`${filledFoundations} of ${Object.keys(FOUNDATIONS).length + FOUNDATION_SLOTS.length} filled`} onClick={() => go({ at: 'section', id: 'foundations' })} />
              <Row label={SECTIONS.components} meta={`${product} · ${filledGroups} groups`} onClick={() => go({ at: 'section', id: 'components' })} />
              <Row label={SECTIONS.patterns} meta="Nothing yet" onClick={() => go({ at: 'section', id: 'patterns' })} />
              <Row label={SECTIONS.content} meta="Nothing yet" onClick={() => go({ at: 'section', id: 'content' })} />
              <Row label={SECTIONS.dataviz} meta="Nothing yet" onClick={() => go({ at: 'section', id: 'dataviz' })} />
              <Row label={SECTIONS.guidelines} tag="Shared" meta={`${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`} onClick={() => go({ at: 'section', id: 'guidelines' })} />
            </ul>
            <ul className="dsn-list dsn-top dsn-after">
              <Row label={SECTIONS.export} meta="CSS, JSON" onClick={() => go({ at: 'section', id: 'export' })} />
            </ul>
          </section>
        )}
      </>
    );
  } else if (page.at === 'section') {
    const id = page.id;
    const home = <Back to={{ at: 'home' }} label="Design system" go={go} />;
    let content: ReactNode;
    if (id === 'principles') {
      content = (
        <>
          <p className="dsn-p">Shared by all projects. They explain the why behind every decision.</p>
          <h3 className="dsn-h">GOV.UK design principles <span className="count">{GOVUK_PRINCIPLES.length}</span></h3>
          <Principles list={GOVUK_PRINCIPLES} />
          <h3 className="dsn-h">Richa’s own <span className="count">{OWN_PRINCIPLES.length}</span></h3>
          <Principles list={OWN_PRINCIPLES} />
          {ds.rules.length > 0 && <><h3 className="dsn-h">This project <span className="count">{ds.rules.length}</span></h3><ul className="rules">{ds.rules.map((r) => <li key={r}>{r}</li>)}</ul></>}
        </>
      );
    } else if (id === 'foundations') {
      content = (
        <ul className="dsn-list">
          {(Object.keys(FOUNDATIONS) as FoundationId[]).map((f) => (
            <Row key={f} label={FOUNDATIONS[f]} meta={foundationCount[f] ? String(foundationCount[f]) : 'Nothing yet'} onClick={foundationCount[f] ? () => go({ at: 'foundation', id: f }) : undefined} />
          ))}
          {FOUNDATION_SLOTS.map((s) => <Row key={s} label={s} meta="Nothing yet" />)}
        </ul>
      );
    } else if (id === 'components') {
      content = (
        <>
          {COMPONENT_GROUPS.filter((g) => g !== 'Icons').map((g) => {
            const list = groups.get(g)!;
            return (
              <div key={g} className="dsn-group">
                <h3 className="dsn-h">{g} <span className="count">{list.length || 'Nothing yet'}</span></h3>
                {g === 'Deprecated' && list.length > 0 && <p className="dsn-p">Listed so nobody uses them.</p>}
                {list.length > 0 && compRows(list)}
              </div>
            );
          })}
          {icons.length > 0 && <button className="ds-link" onClick={() => go({ at: 'foundation', id: 'icons' })}>{icons.length} icons are in Foundations, Iconography</button>}
        </>
      );
    } else if (id === 'patterns') {
      content = <Slots list={PATTERN_SLOTS} />;
    } else if (id === 'content') {
      content = <Slots list={CONTENT_SLOTS} />;
    } else if (id === 'dataviz') {
      content = <Slots list={DATAVIZ_SLOTS} />;
    } else if (id === 'guidelines') {
      content = (
        <>
          <p className="dsn-p">Shared by all projects. The checks a design passes before it is done.</p>
          <ul className="dsn-list">{skills.map((s) => <Row key={s.folder} label={skillName(s.folder)} meta={`${s.lines} ${s.lines === 1 ? 'rule' : 'rules'}`} />)}</ul>
          {!skills.length && <p className="dsn-p">No skills found in ~/design-skills.</p>}
          <h3 className="dsn-h">House rules</h3>
          <Rules />
        </>
      );
    } else {
      return <div className="side-scroll ds" ref={scroller}><section className="side-section">{home}<h2 className="dsn-title">{SECTIONS.export}</h2></section><ExportTokens ds={ds} />{editor}</div>;
    }
    view = <section className="side-section">{home}<h2 className="dsn-title">{SECTIONS[id]}{(id === 'principles' || id === 'guidelines') && <span className="dsn-tag">Shared</span>}</h2>{content}</section>;
  } else if (page.at === 'foundation') {
    const f = page.id;
    const byRole = f === 'colour' ? [...groupColors(ds.colors)].filter(([, l]) => l.length) : [];
    view = (
      <section className="side-section">
        <Back to={{ at: 'section', id: 'foundations' }} label="Foundations" go={go} />
        <h2 className="dsn-title">{FOUNDATIONS[f]} <span className="count">{foundationCount[f]}</span></h2>
        {f === 'colour' && byRole.map(([role, list]) => <div key={role} className="dsn-group"><h3 className="dsn-h">{role} <span className="count">{list.length}</span></h3><Swatches list={list} /></div>)}
        {f === 'type' && <TextStyles list={ds.text} />}
        {f === 'spacing' && <div className="scale">{ds.spacing.map((n) => <span key={n} className="step" title={`${n}px`}><i style={{ width: Math.min(n, 96) }} />{n}</span>)}</div>}
        {f === 'radius' && <div className="chips">{ds.radius.map((n) => <span key={n} className="chip">{n}</span>)}</div>}
        {f === 'icons' && <ul className="dsn-icons">{icons.map((c, i) => <li key={compKey(c, i)}>{c.name.trim()}</li>)}</ul>}
      </section>
    );
  } else {
    const c = keyed.get(page.key);
    if (!c) {
      view = <section className="side-section"><Back to={{ at: 'section', id: 'components' }} label="Components" go={go} /><p className="dsn-p">This component is no longer in the design system.</p></section>;
    } else {
      const group = componentGroup(c);
      // Elastic's headings: State goes under States, Size under Style, every other property under Types.
      const all = props(c);
      const states = all.filter((p) => /^states?$/i.test(p.name));
      const style = all.filter((p) => /^size$/i.test(p.name));
      const types = all.filter((p) => !states.includes(p) && !style.includes(p));
      const filled: Partial<Record<(typeof COMPONENT_HEADINGS)[number], ReactNode>> = {
        Overview: c.description ? <p className="dsn-p">{c.description}</p> : undefined,
        Types: types.length ? <PropList list={types} /> : undefined,
        Style: style.length ? <PropList list={style} /> : undefined,
        States: states.length ? <PropList list={states} /> : undefined,
        'In Figma': <p className="dsn-p">{[fromFigma && fromFigma.kind === 'figma' ? `File: ${fromFigma.name}` : '', c.key ? `Key: ${c.key}` : ''].filter(Boolean).join(' · ') || 'Added by hand'}</p>,
      };
      view = (
        <section className="side-section">
          <Back to={group === 'Icons' ? { at: 'foundation', id: 'icons' } : { at: 'section', id: 'components' }} label={group === 'Icons' ? 'Iconography' : 'Components'} go={go} />
          <h2 className="dsn-title">{c.name.trim()}</h2>
          <p className="dsn-sub">{[group, all.map((p) => p.name).join(', ')].filter(Boolean).join(' · ')}</p>
          {COMPONENT_HEADINGS.filter((h) => filled[h]).map((h) => <div key={h} className="dsn-group"><h3 className="dsn-h">{h}</h3>{filled[h]}</div>)}
        </section>
      );
    }
  }

  return (
    <div className="side-scroll ds" ref={scroller}>
      {view}
      {editor}
    </div>
  );
}
