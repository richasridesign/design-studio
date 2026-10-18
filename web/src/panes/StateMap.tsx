import { useEffect, useMemo, useRef, useState } from 'react';
import { getJson, useStore } from '../store';
import { Icon } from '../Icon';
import { insertPrompt } from './Files';
import type { DesignDoc, ReviewDoc } from '../../../shared/design';
import { stageFrames } from '../../../shared/stages';
import { missingPrompt, stateMap, type MappedScreen } from '../../../shared/stateMap';
import '../statemap.css';

const missingIn = (s: MappedScreen) => s.states.filter((x) => !x.frame).length;

/** The states the brief lists per screen, marked Designed or Missing. The Build gate's "Show states" link opens it. */
export function StateBox() {
  const chat = useStore((s) => s.session.id);
  const count = useStore((s) => s.events.length);
  const first = useStore((s) => s.events.find((e) => e.kind === 'user'));
  const [plan, setPlan] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [review, setReview] = useState<ReviewDoc | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      getJson<{ content: string }>('/api/file?path=plan.md').then((f) => alive && setPlan(f.content ?? '')).catch(() => alive && setPlan(''));
      getJson<DesignDoc | null>('/api/design').then((d) => alive && setDesign(d)).catch(() => alive && setDesign(null));
      getJson<ReviewDoc | null>('/api/review').then((r) => alive && setReview(r)).catch(() => alive && setReview(null));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [chat, count, tick]);
  useEffect(() => {
    const show = () => { setOpen(true); requestAnimationFrame(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('designstudio:states', show);
    window.addEventListener('designstudio:evidence', bump);
    return () => { window.removeEventListener('designstudio:states', show); window.removeEventListener('designstudio:evidence', bump); };
  }, []);
  // Same source as the Build gate: plan.md, or the first message when there is no plan yet.
  const brief = plan?.trim() ? plan : first?.kind === 'user' ? first.text : '';
  // Same frames as the Build gate, so the box and the gate agree.
  const frames = useMemo(() => stageFrames(design, review), [design, review]);
  const map = useMemo(() => stateMap(brief, frames), [brief, frames]);
  if (plan === null || !map.total) return null;
  const unnamed = frames.length > 0 && !map.named;
  const summary = unnamed ? `${map.total} listed, not checked` : map.missing ? `${map.missing} of ${map.total} missing` : `All ${map.total} designed`;
  return (
    <div className="smap" ref={box}>
      <div className="smap-head">
        <span>States: <b>{summary}</b></span>
        <button className="link" aria-expanded={open} aria-controls="smap-list" onClick={() => setOpen(!open)}>{open ? 'Hide states' : 'Show states'}</button>
      </div>
      {open && (
        <div id="smap-list" className="smap-body">
          {unnamed && <p className="muted">The frames have no names yet, so the states cannot be matched. Claude names them in design.json.</p>}
          <ul className="smap-screens">
            {map.screens.map((s) => <Row key={s.screen} s={s} checked={!unnamed} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ s, checked }: { s: MappedScreen; checked: boolean }) {
  const gaps = missingIn(s);
  return (
    <li className="smap-screen">
      <div className="smap-name">
        <b>{s.screen}</b>
        {checked && <span className="muted">{gaps ? `${gaps} of ${s.states.length} missing` : 'All designed'}</span>}
      </div>
      <ul className="smap-states" aria-label={`${s.screen} states`}>
        {s.states.map((x) => (
          <li key={x.state} className={!checked ? 'unchecked' : x.frame ? 'designed' : 'missing'}>
            <span className="smap-state">{x.state}</span>
            {checked && (
              <span className="smap-status" title={x.frame ? `Frame: ${x.frame.name}` : undefined}>
                <Icon name={x.frame ? 'check' : 'warning'} small />
                {x.frame ? 'Designed' : 'Missing'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {checked && gaps > 0 && (
        <button className="link smap-ask" onClick={() => insertPrompt(missingPrompt(s))}>
          Ask Claude to design {gaps === 1 ? 'it' : 'them'}<span className="sr-only">: {s.screen}, {s.states.filter((x) => !x.frame).map((x) => x.state).join(', ')}</span>
        </button>
      )}
    </li>
  );
}
