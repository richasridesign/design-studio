import { useEffect, useId, useRef, useState } from 'react';
import { getJson, postJson, send, useStore } from '../store';
import { Icon } from '../Icon';
import { IconButton } from '../Tip';
import { useDialogFocus } from '../useDialog';
import { AREA_NAMES, type DesignSystem as DS, type DsFrom, type DsSource } from '../../../shared/design';
import { STARTERS, type DsKind, type StarterId } from '../../../shared/dsProfiles';
import { ago } from './reviewRuns';
import '../dsEditor.css';

type SkillFile = { folder: string; area: keyof typeof AREA_NAMES | null; path: string; lines: number };
type View = { ds: DS | null; skills: SkillFile[] };

const FROM: Record<DsFrom, string> = { starter: 'Starter', figma: 'Figma', code: 'Code', hand: 'Added' };

/** One change to the profile. The server reads the source when the change needs it. */
export const changeDs = (body: Record<string, unknown>) => postJson<{ ds: DS | null; costUsd: number }>('/api/design-system', body);

/**
 * The design system editor: where the profile comes from (a starter, the Figma file, a tokens file, her rule files),
 * what was found, and the principles. Every part is optional and every item can be dropped.
 */
export function DsEditor({ onClose, focus }: { onClose: () => void; focus?: 'code' }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, box, onClose);
  const figma = useStore((s) => s.session.figma);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const [codePath, setCodePath] = useState('');
  const [rules, setRules] = useState<string | null>(null);
  const [tab, setTab] = useState<DsKind>('color');

  const load = () => getJson<View>('/api/design-system/view').then(setView).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);

  const run = async (label: string, body: Record<string, unknown>, done: string) => {
    setBusy(label);
    setError('');
    try {
      const r = await changeDs(body);
      setView((v) => ({ ds: r.ds, skills: v?.skills ?? [] }));
      if (body.action === 'skills' || body.action === 'starter') void load();
      // A starter sets this chat's review areas (Lo-fi reviews flow and copy only). She can tick others on the Review tab.
      if (body.action === 'starter' && r.ds?.areas) send({ type: 'set_flow', patch: { areas: r.ds.areas } });
      setSaid(r.costUsd ? `${done} Cost: $${r.costUsd.toFixed(3)}.` : done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const ds = view?.ds ?? null;
  const sources = ds?.sources ?? [];
  const skillsSrc = sources.find((s): s is Extract<DsSource, { kind: 'skills' }> => s.kind === 'skills');
  const hasFigma = sources.some((s) => s.kind === 'figma');
  const ruleText = rules ?? (ds?.rules ?? []).join('\n');
  const items = !ds ? [] : tab === 'color' ? ds.colors : tab === 'text' ? ds.text : ds.components;

  return (
    <div className="overlay settings-overlay" onClick={onClose}>
      <div ref={box} className="settings-dialog wide dse" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-head">
          <h2 id={titleId}>Design system</h2>
          <IconButton label="Close" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="settings-dialog-body dse-body">
          <p className="dse-lede">Optional. Designs and reviews use what is here, and work without it. Use one source or several.</p>

          <section className="dse-sec" aria-labelledby="dse-start">
            <h3 id="dse-start">Start from</h3>
            <div className="dse-starters" role="radiogroup" aria-labelledby="dse-start">
              {STARTERS.map((s) => (
                <button key={s.id} role="radio" aria-checked={ds?.starter === s.id} className={`dse-starter${ds?.starter === s.id ? ' on' : ''}`} disabled={!!busy} onClick={() => run('starter', { action: 'starter', id: s.id as StarterId }, `Started from ${s.name}.`)}>
                  <span className="t">{ds?.starter === s.id && <span className="mk pass" aria-hidden="true" />}{s.name}</span>
                  <span className="d">{s.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="dse-sec" aria-labelledby="dse-src">
            <h3 id="dse-src">Sources</h3>
            {sources.length > 0 && (
              <ul className="dse-sources">
                {sources.map((s, i) => (
                  <li key={`${s.kind}-${i}`}>
                    <div className="dse-src-main">
                      <span className="t">{s.kind === 'figma' ? `Figma: ${s.name}` : s.kind === 'code' ? `Code: ${s.path.split('/').pop()}` : `Rule files: ${s.dir}`}</span>
                      {'error' in s && s.error
                        ? <span className="dse-src-state err"><span className="mk blocking" aria-hidden="true" />Could not read: {s.error}</span>
                        : <span className="dse-src-state">{s.kind === 'skills' ? 'Read live at each review, never copied' : `Read ${ago(s.at)}`}{s.kind === 'code' ? ` · ${s.path}` : ''}</span>}
                    </div>
                    <div className="dse-src-acts">
                      {s.kind === 'figma' && figma && <button className="dse-link" disabled={!!busy} onClick={() => run('figma', { action: 'figma' }, 'Read the Figma file again.')}>Read again</button>}
                      {s.kind === 'code' && <button className="dse-link" disabled={!!busy} onClick={() => run('code', { action: 'code', path: s.path }, 'Read the tokens file again.')}>Read again</button>}
                      <button className="dse-link" disabled={!!busy} onClick={() => run('remove', { action: 'remove-source', index: i }, 'Source removed.')}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="dse-add">
              {!hasFigma && (figma
                ? <button disabled={!!busy} onClick={() => run('figma', { action: 'figma' }, `Read ${figma.name}.`)}>{busy === 'figma' ? 'Reading Figma…' : 'Read variables and components from Figma'}</button>
                : <span className="dse-hint">Attach a Figma file to read its variables, styles and components.</span>)}
              {!skillsSrc && <button disabled={!!busy} onClick={() => run('skills', { action: 'skills' }, 'Your rule files are on.')}>Use my rule files</button>}
              <form className="dse-code" onSubmit={(e) => { e.preventDefault(); if (codePath.trim()) void run('code', { action: 'code', path: codePath }, 'Read the tokens file.').then(() => setCodePath('')); }}>
                <label className="field">
                  <span>Tokens file from code (.css or .json)</span>
                  <input data-autofocus={focus === 'code' ? true : undefined} value={codePath} onChange={(e) => setCodePath(e.target.value)} placeholder="~/workspace/app/src/tokens.css" spellCheck={false} />
                </label>
                <button type="submit" disabled={!!busy || !codePath.trim()}>{busy === 'code' ? 'Reading…' : 'Add file'}</button>
              </form>
            </div>
            {busy === 'figma' && <p className="dse-hint">Reading through the Figma plugin. About half a cent.</p>}
          </section>

          {skillsSrc && (
            <section className="dse-sec" aria-labelledby="dse-skills">
              <h3 id="dse-skills">Rule files</h3>
              <p className="dse-hint">Each reviewer reads the file for its area at review time, so your edits apply to the next review.</p>
              <ul className="dse-skills">
                {(view?.skills ?? []).map((f) => (
                  <li key={f.folder}>
                    {f.area ? (
                      <label className="dse-check">
                        <input type="checkbox" checked={!skillsSrc.off.includes(f.folder)} disabled={!!busy} onChange={(e) => run('skill', { action: 'skill-off', folder: f.folder, off: !e.target.checked }, e.target.checked ? `${f.folder} is on.` : `${f.folder} is off.`)} />
                        <span className="t">{f.folder}</span>
                      </label>
                    ) : <span className="dse-check dse-noarea">{f.folder}</span>}
                    <span className="dse-meta">{f.area ? `${AREA_NAMES[f.area]} · ${f.lines} rules` : 'Not used in reviews'}</span>
                  </li>
                ))}
                {!view?.skills.length && <li className="dse-hint">No rule files found in {skillsSrc.dir}.</li>}
              </ul>
            </section>
          )}

          {ds && (
            <section className="dse-sec" aria-labelledby="dse-found">
              <h3 id="dse-found">What it uses</h3>
              <div className="seg" role="tablist" aria-labelledby="dse-found">
                {([['color', 'Colors', ds.colors.length], ['text', 'Text', ds.text.length], ['component', 'Components', ds.components.length]] as const).map(([k, label, n]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label} <span className="dse-count">{n}</span></button>
                ))}
              </div>
              {items.length ? (
                <div role="tabpanel" aria-label={tab === 'color' ? 'Colors' : tab === 'text' ? 'Text' : 'Components'}><ul className="dse-items">
                  {items.map((it) => (
                    <li key={it.name}>
                      {tab === 'color' && <span className="swatch" style={{ background: (it as DS['colors'][number]).value }} aria-hidden="true" />}
                      <span className="t">{it.name}</span>
                      <span className="dse-meta">{tab === 'color' ? (it as DS['colors'][number]).value : tab === 'text' ? [(it as DS['text'][number]).size && `${(it as DS['text'][number]).size}px`, (it as DS['text'][number]).weight, (it as DS['text'][number]).lineHeight && `/ ${(it as DS['text'][number]).lineHeight}`].filter(Boolean).join(' ') : (it as DS['components'][number]).variants?.slice(0, 2).join(', ')}</span>
                      {it.from && <span className="dse-from">{FROM[it.from]}</span>}
                      <button className="dse-link" disabled={!!busy} aria-label={`Drop ${it.name}`} onClick={() => run('drop', { action: 'drop', kind: tab, name: it.name }, `Dropped ${it.name}.`)}>Drop</button>
                    </li>
                  ))}
                </ul></div>
              ) : <p className="dse-hint" role="tabpanel">{tab === 'component' ? 'No components yet. Read them from Figma.' : 'Nothing yet. Add a source above.'}</p>}
              {(ds.dropped?.length ?? 0) > 0 && (
                <details className="dse-dropped">
                  <summary>Dropped ({ds.dropped!.length})</summary>
                  <ul>
                    {ds.dropped!.map((k) => (
                      <li key={k}><span>{k.replace(/^(color|text|component):/, '')}</span><button className="dse-link" disabled={!!busy} onClick={() => run('restore', { action: 'restore', key: k }, 'It comes back on the next read of its source.')}>Restore</button></li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="dse-check dse-tokens">
                <input type="checkbox" checked={ds.tokens !== false} disabled={!!busy} onChange={(e) => run('tokens', { action: 'edit', tokens: e.target.checked }, e.target.checked ? 'Token checks are on.' : 'Token checks are off.')} />
                <span>Check that designs use these tokens and components</span>
              </label>
            </section>
          )}

          {ds && (
            <section className="dse-sec" aria-labelledby="dse-rules">
              <h3 id="dse-rules">Principles</h3>
              <label className="field">
                <span className="dse-hint">One per line. Designs and reviews follow them.</span>
                <textarea rows={Math.min(10, Math.max(4, ruleText.split('\n').length + 1))} value={ruleText} onChange={(e) => setRules(e.target.value)} aria-labelledby="dse-rules" />
              </label>
              {rules !== null && (
                <div className="dse-row">
                  <button disabled={!!busy} onClick={() => run('rules', { action: 'edit', rules: rules.split('\n') }, 'Principles saved.').then(() => setRules(null))}>Save principles</button>
                  <button className="dse-link" onClick={() => setRules(null)}>Cancel</button>
                </div>
              )}
            </section>
          )}

          {error && <p className="dse-error" role="alert"><span className="mk blocking" aria-hidden="true" />{error}</p>}
          <p className="sr-only" role="status">{said}</p>
        </div>
        <div className="dse-foot">
          {ds ? <button className="dse-link danger" disabled={!!busy} onClick={() => run('clear', { action: 'clear' }, 'Profile removed. Designs and reviews carry on without one.')}>Remove profile</button> : <span />}
          <span className="dse-said" aria-hidden="true">{said}</span>
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
