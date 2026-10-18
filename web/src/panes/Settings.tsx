import { useEffect, useId, useRef, useState } from 'react';
import { getJson, postJson } from '../store';
import { Icon } from '../Icon';
import { CHECKS, CHECK_IDS, CHECK_TITLES, addFigmaToClaude, chromeAsk, type CheckId, type CheckResult } from '../setupChecks';
import { AREAS, AREA_NAMES, FIX_ROUNDS, PRESET_INFO, SHOWN_PRESETS, type Settings as S } from '../../../shared/design';
import { shownPreset } from './reviewRuns';
import { costLine } from './ReviewSetup';
import { figmaState } from '../StatusBar';
import { Command, RECHECK, openFigmaLogin } from '../FigmaLogin';

type McpInfo = { configured: boolean; status: { status: string; error?: string } | null };

type Row = { busy: boolean; result?: CheckResult };

function CheckSetup() {
  const [rows, setRows] = useState<Partial<Record<CheckId, Row>>>({});
  const [fixErr, setFixErr] = useState('');
  const run = async (id: CheckId) => {
    setRows((r) => ({ ...r, [id]: { busy: true, result: r[id]?.result } }));
    const result = await CHECKS[id]();
    setRows((r) => ({ ...r, [id]: { busy: false, result } }));
  };
  const all = () => CHECK_IDS.forEach((id) => void run(id));
  const fix = async (id: CheckId, fixId: string) => {
    setFixErr('');
    // The Figma tab keeps asking Chrome while she ticks the box, so Settings closes and the steps show there.
    if (fixId === 'allow-chrome') {
      chromeAsk.at = Date.now();
      window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } }));
      return void postJson('/api/chrome/setup', {}).catch((e) => setFixErr((e as Error).message));
    }
    if (fixId === 'figma-login') return openFigmaLogin();
    try {
      await addFigmaToClaude();
    } catch (e) {
      setFixErr((e as Error).message);
    }
    void run(id);
  };
  const busy = CHECK_IDS.some((id) => rows[id]?.busy);
  return (
    <section className="set-card" id="set-checks" aria-labelledby="set-checks-h">
      <div className="inline check-head">
        <h2 id="set-checks-h" className="sr-only">Check setup</h2>
        <p className="muted">Tests each connection without using any model tokens.</p>
        <button className="primary" disabled={busy} onClick={all}>Run all checks</button>
      </div>
      {fixErr && <div className="error-text">{fixErr}</div>}
      <ul className="check-list">
        {CHECK_IDS.map((id) => {
          const row = rows[id];
          const r = row?.result;
          const tone = row?.busy ? 'checking' : r ? r.tone : 'idle';
          return (
            <li key={id} className={`check-row ${tone}`}>
              <span className={`check-dot ${tone}`} aria-hidden />
              <div className="check-body">
                <span className="check-title">{CHECK_TITLES[id]}</span>
                <span className="muted">{row?.busy ? 'Checking…' : r ? r.detail : 'Not checked'}</span>
                {r && r.tone !== 'ok' && !row?.busy && r.fix && <span className="check-fix">{r.optional ? 'To add it' : 'How to fix'}: {r.fix}</span>}
                {r && r.tone !== 'ok' && !row?.busy && r.steps && (
                  <ol className="fl-steps check-steps">
                    {r.steps.map((st, i) => <li key={i}>{st.text}{st.cmd && <> <Command id={`chk-${id}-${i}`} text={st.cmd} /></>}{st.after && ` ${st.after}`}</li>)}
                  </ol>
                )}
              </div>
              <div className="check-actions">
                {r && r.tone !== 'ok' && !row?.busy && r.fixId && <button onClick={() => void fix(id, r.fixId!)}>{r.fixLabel}</button>}
                <button className="ghost" disabled={row?.busy} aria-label={`Check ${CHECK_TITLES[id]}`} onClick={() => void run(id)}>Check</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState('');
  const [mcp, setMcp] = useState<McpInfo | null>(null);

  useEffect(() => {
    getJson<S>('/api/settings').then(setS).catch((e) => setMsg(e.message));
    getJson<McpInfo>('/api/figma/mcp').then(setMcp).catch(() => {});
  }, []);

  const save = async (patch: Partial<S>) => {
    try {
      const next = await postJson<S>('/api/settings', patch);
      setS(next);
      setMsg('Saved');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const addMcp = async () => {
    try {
      await postJson('/api/figma/mcp', {});
      setMcp(await getJson<McpInfo>('/api/figma/mcp'));
      setMsg('Figma added to Claude. Log in once to finish.');
      openFigmaLogin();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!s) return <div className="settings-page"><div className="hint">{msg || 'Loading…'}</div></div>;

  return (
    <div className="settings-page">
      <SectionNav />
      {msg && <div className="banner"><Icon name="info" small /> <span>{msg}</span></div>}
      <section className="set-card" id="set-figma" aria-labelledby="set-figma-h">
        <h2 id="set-figma-h" className="sr-only">Figma</h2>
        <p className="muted">Design Studio reads and edits your file through the Figma plugin in Claude. No token needed.</p>
        <div className="field">
          <span>Figma plugin in Claude</span>
          {mcp?.configured ? <McpState status={mcp.status?.status} /> : (
            <div className="inline"><span className="muted">Figma plugin: Not added yet</span><button onClick={addMcp}>Add Figma to Claude</button></div>
          )}
          <span className="muted small">Lets Claude read and edit your Figma file.</span>
        </div>
      </section>

      <CheckSetup />

      <section className="set-card" id="set-runs" aria-labelledby="set-runs-h">
        <h2 id="set-runs-h" className="sr-only">Design runs</h2>
        <p className="muted small">Defaults for new chats. Change them for one chat in the mode menu of the message box.</p>
        <Toggle label="Default: Stop after sketch" detail="Wait for you to pick a sketch direction before Claude designs in Figma" on={s.stopAfterSketch} set={(v) => save({ stopAfterSketch: v })} />
        <div className="field">
          <span>Default: Review depth</span>
          <div className="seg" role="radiogroup" aria-label="Default review depth">
            {SHOWN_PRESETS.map((p) => <button key={p} role="radio" aria-checked={shownPreset(s.preset) === p} className={shownPreset(s.preset) === p ? 'on' : ''} title={PRESET_INFO[p].detail} onClick={() => save({ preset: p })}>{PRESET_INFO[p].label}</button>)}
          </div>
          <span className="muted small">{PRESET_INFO[shownPreset(s.preset)].detail}.</span>
        </div>
        {shownPreset(s.preset) !== 'full' && (
          <fieldset className="field rs-areas">
            <legend>Default: Areas</legend>
            {AREAS.map((a) => (
              <label key={a} className="rs-area">
                <input type="checkbox" checked={s.areas.includes(a)} onChange={() => save({ areas: s.areas.includes(a) ? s.areas.filter((x) => x !== a) : AREAS.filter((x) => x === a || s.areas.includes(x)) })} />
                <span>{AREA_NAMES[a]}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="field">
          <span id="set-rounds-l">Fix rounds</span>
          <div className="seg" role="radiogroup" aria-labelledby="set-rounds-l">
            {FIX_ROUNDS.map((n) => <button key={n} role="radio" aria-checked={s.fixRounds === n} className={s.fixRounds === n ? 'on' : ''} onClick={() => save({ fixRounds: n })}>{n}</button>)}
          </div>
          <span className="muted small">After each review, Claude fixes blocking and major findings, then re-reviews what failed. Quick fixes once. Shared changes wait for you.</span>
          <span className="muted small">{costLine(shownPreset(s.preset), s.areas, s.fixRounds)}</span>
        </div>
        <Toggle label="Ask before changing the file" detail="Claude asks before each change to Figma. Off: Claude edits without asking, after saving a version" on={s.askBeforeEdit} set={(v) => save({ askBeforeEdit: v })} />
        <Toggle label="Follow Claude in Figma" detail="Move the Figma tab to the frame Claude is working on" on={s.followClaude} set={(v) => save({ followClaude: v })} />
        <Toggle label="Check frames after Claude edits Figma" detail="Runs the design system check on the frames Claude touched in a chat turn. Reading them from Figma costs under a cent" on={s.autoCheck} set={(v) => save({ autoCheck: v })} />
      </section>

      <section className="set-card" id="set-models" aria-labelledby="set-models-h">
        <h2 id="set-models-h" className="sr-only">Models</h2>
        <p className="muted">Design runs: Opus 5.5 writes the plan, Sonnet 5.5 sketches, designs, fixes and reviews. Chat: pick the model next to the mode in the message box.</p>
      </section>

      <section className="set-card" id="set-usage" aria-labelledby="set-usage-h">
        <h2 id="set-usage-h" className="sr-only">Usage</h2>
        <label className="field">
          <span>Daily budget: $ (leave empty for no limit)</span>
          <div className="inline">
            <input type="number" min={0} step={1} inputMode="decimal" placeholder="No limit" aria-describedby="set-budget-help" defaultValue={s.dailyBudgetUsd || ''} onBlur={(e) => Number(e.target.value) !== s.dailyBudgetUsd && save({ dailyBudgetUsd: Number(e.target.value) })} />
          </div>
          <span className="muted small" id="set-budget-help">The spend pill turns yellow at 80% and red above 100% of this.</span>
        </label>
      </section>

      <section className="set-card" id="set-advanced" aria-labelledby="set-advanced-h">
        <h2 id="set-advanced-h" className="sr-only">Advanced</h2>
        <Toggle label="Developer tools" detail="Show the chat folder's files and a terminal" on={s.devTools} set={(v) => save({ devTools: v }).then(() => window.dispatchEvent(new Event('designstudio:settings')))} />
      </section>
    </div>
  );
}

/** The plugin's state, from the open chat when Claude runs, else from a check run here: on Check now, and when the login dialog checks again. */
function McpState({ status }: { status?: string }) {
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const check = () => {
    setBusy(true);
    void CHECKS.mcp().then((r) => { setChecked(r); setBusy(false); });
  };
  useEffect(() => {
    // Not on open: from here the probe cannot see the login Claude keeps, so it could say Needs login to someone logged in.
    window.addEventListener(RECHECK, check);
    return () => window.removeEventListener(RECHECK, check);
  }, []);
  const PROBED: Record<CheckResult['tone'], [string, string]> = { ok: ['ok', 'Connected'], warn: ['warn', 'Needs login'], bad: ['bad', 'Not connected'] };
  const [tone, label] = busy ? ['wait', 'Checking'] : checked ? PROBED[checked.tone] : status ? figmaState([{ name: 'figma', status }]) : ['off', 'Not checked yet'];
  return (
    <span className="inline mcp-state">
      <span className={`mcp-dot ${tone}`} aria-hidden /><span role="status">Figma plugin: {label}</span>
      {tone === 'warn' && <button className="link" onClick={openFigmaLogin}>Log in to Figma</button>}
      {!busy && <button className="link" onClick={check}>Check now</button>}
    </span>
  );
}

const SECTIONS: [id: string, title: string][] = [['set-figma', 'Figma'], ['set-checks', 'Check setup'], ['set-runs', 'Design runs'], ['set-models', 'Models'], ['set-usage', 'Usage'], ['set-advanced', 'Advanced']];

const scroller = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return null;
};

function SectionNav() {
  const [at, setAt] = useState(SECTIONS[0][0]);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const box = scroller(nav.current);
    if (!box) return;
    const onScroll = () => {
      const line = (nav.current?.getBoundingClientRect().bottom ?? 0) + box.clientHeight * 0.3;
      // At the top the first card is the one in view, however short it is.
      if (box.scrollTop <= 0) return setAt(SECTIONS[0][0]);
      // The last card is short and never reaches the top, so the bottom of the scroll counts as it.
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) return setAt(SECTIONS[SECTIONS.length - 1][0]);
      let id = SECTIONS[0][0];
      for (const [sid] of SECTIONS) if ((document.getElementById(sid)?.getBoundingClientRect().top ?? Infinity) <= line) id = sid;
      setAt(id);
    };
    onScroll();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    // On narrow screens the nav scrolls sideways: keep the current section in view.
    const el = nav.current;
    const link = el?.querySelector<HTMLElement>('[aria-current]');
    if (el && link && (link.offsetLeft < el.scrollLeft || link.offsetLeft + link.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = link.offsetLeft - 24;
  }, [at]);
  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <nav ref={nav} className="set-nav" aria-label="Settings sections">
      {SECTIONS.map(([id, title]) => <a key={id} href={`#${id}`} aria-current={at === id ? 'true' : undefined} onClick={(e) => go(e, id)}>{title}</a>)}
    </nav>
  );
}

function Toggle({ label, detail, on, set }: { label: string; detail: string; on: boolean; set: (v: boolean) => void }) {
  const id = useId();
  // The whole row toggles on click; the switch itself handles Space and Enter.
  return (
    <div className="toggle-row" onClick={(e) => !(e.target as Element).closest('.switch') && set(!on)}>
      <span className="tl-text"><span className="t" id={`${id}-l`}>{label}</span><span className="muted small" id={`${id}-d`}>{detail}</span></span>
      <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} onClick={() => set(!on)}><span className="switch-thumb" /></button>
    </div>
  );
}
