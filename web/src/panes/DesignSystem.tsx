import { useEffect, useMemo, useState } from 'react';
import { getJson, send, useRev, useStore } from '../store';
import { Icon } from '../Icon';
import { Empty, SystemArt } from './Empty';
import { insertPrompt } from './Files';
import { Rules } from './Rules';
import { Section } from '../Section';
import { FORMATS, type TokenFormat } from '../tokens';
import type { DesignSystem as DS } from '../../../shared/design';

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
      <div className="seg">
        {(Object.keys(FORMATS) as TokenFormat[]).map((k) => (
          <button key={k} className={k === format ? 'on' : ''} onClick={() => setFormat(k)}>{FORMATS[k].label}</button>
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
  const running = useStore((s) => s.session.running);
  const figma = useStore((s) => s.session.figma);
  const rev = useRev('design-system.json');
  const [ds, setDs] = useState<DS | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    getJson<DS | null>('/api/design-system').then(setDs).catch(() => setDs(null));
  }, [chat, rev]);

  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const rebuild = () => send({ type: 'prompt', text: '/system' });

  const rules = <Section view="system" id="rules" title="Rules"><Rules /></Section>;

  if (!ds) {
    return (
      <div className="side-scroll">
        <Empty art={<SystemArt />} title="No design system profile" text="Claude reads your library once and remembers its components, variables and text styles, so designs and reviews use them." action={figma ? { label: 'Build profile', onClick: () => insertPrompt('/system') } : undefined} />
        {rules}
      </div>
    );
  }
  return (
    <div className="side-scroll ds">
      <section className="side-section">
        <div className="ds-meta">
          <span>{ds.libraries.join(', ') || 'Libraries unknown'}</span>
          <button className="icon-btn" title="Rebuild the profile" disabled={running} onClick={rebuild}><Icon name="sync" small /></button>
        </div>
        <input placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </section>
      <section className="side-section">
        <div className="side-label">Colors <span className="count">{ds.colors.length}</span></div>
        <ul className="swatches">
          {ds.colors.filter((c) => match(c.name)).map((c) => (
            <li key={c.name} title={`${c.name}\n${c.value}${c.variable ? `\n${c.variable}` : ''}`}>
              <span className="swatch" style={{ background: c.value }} />
              <span className="sw-name">{c.name}</span>
              <span className="sw-value">{c.value}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="side-section">
        <div className="side-label">Text styles <span className="count">{ds.text.length}</span></div>
        <ul className="type-list">
          {ds.text.filter((t) => match(t.name)).map((t) => (
            <li key={t.name}>
              <span className="type-sample" style={{ fontSize: Math.min(28, Math.max(12, t.size ?? 16)), fontWeight: Number(t.weight) || 400 }}>{t.name}</span>
              <span className="sw-value">{[t.size && `${t.size}px`, t.weight, t.lineHeight && `/ ${t.lineHeight}`].filter(Boolean).join(' ')}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="side-section">
        <div className="side-label">Spacing</div>
        <div className="scale">{ds.spacing.map((n) => <span key={n} className="step" title={`${n}px`}><i style={{ width: Math.min(n, 96) }} />{n}</span>)}</div>
        {ds.radius.length > 0 && <><div className="side-label">Radius</div><div className="chips">{ds.radius.map((n) => <span key={n} className="chip">{n}</span>)}</div></>}
      </section>
      <section className="side-section">
        <div className="side-label">Components <span className="count">{ds.components.length}</span></div>
        <ul className="comp-list">
          {ds.components.filter((c) => match(c.name)).map((c) => (
            <li key={c.key ?? c.name} title={c.description}>
              <span className="name">{c.name}</span>
              {c.variants?.length ? <span className="sw-value">{c.variants.slice(0, 4).join(', ')}{c.variants.length > 4 ? '…' : ''}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <ExportTokens ds={ds} />
      {ds.rules.length > 0 && (
        <section className="side-section">
          <div className="side-label">Detected rules</div>
          <ul className="rules">{ds.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}
      {rules}
    </div>
  );
}
