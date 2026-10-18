import { useEffect, useState } from 'react';
import { getJson, postJson } from '../store';
import { Icon } from '../Icon';
import { CHECKS, CHECK_IDS, CHECK_TITLES, addFigmaToClaude, type CheckId, type CheckResult } from '../setupChecks';
import { PRESET_INFO, type Settings as S } from '../../../shared/design';
import { shownPreset } from './reviewRuns';
import { ThemeSegment } from '../ThemeToggle';

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
    if (fixId === 'open-figma') return window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } }));
    try {
      await addFigmaToClaude();
    } catch (e) {
      setFixErr((e as Error).message);
    }
    void run(id);
  };
  const busy = CHECK_IDS.some((id) => rows[id]?.busy);
  return (
    <section className="set-card">
      <div className="inline check-head">
        <h2>Check setup</h2>
        <button className="primary" disabled={busy} onClick={all}>Run all checks</button>
      </div>
      <p className="muted">Tests each connection without using any model tokens.</p>
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
                {r?.tone === 'bad' && !row?.busy && r.fix && <span className="check-fix">How to fix: {r.fix}</span>}
              </div>
              <div className="check-actions">
                {r?.tone === 'bad' && !row?.busy && r.fixId && <button className="primary" onClick={() => void fix(id, r.fixId!)}>{r.fixLabel}</button>}
                <button disabled={row?.busy} onClick={() => void run(id)}>Check</button>
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
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [mcp, setMcp] = useState<McpInfo | null>(null);
  const [who, setWho] = useState('');

  useEffect(() => {
    getJson<S>('/api/settings').then((x) => { setS(x); setToken(x.figmaToken); }).catch((e) => setMsg(e.message));
    getJson<McpInfo>('/api/figma/mcp').then(setMcp).catch(() => {});
    getJson<{ handle: string; email: string }>('/api/figma/me').then((m) => setWho(`${m.handle} (${m.email})`)).catch(() => {});
  }, []);

  const save = async (patch: Partial<S>) => {
    try {
      const next = await postJson<S>('/api/settings', patch);
      setS(next);
      setToken(next.figmaToken);
      setMsg('Saved');
      if ('figmaToken' in patch) getJson<{ handle: string; email: string }>('/api/figma/me').then((m) => setWho(`${m.handle} (${m.email})`)).catch((e) => setWho(`Token not accepted: ${e.message}`));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const addMcp = async () => {
    try {
      await postJson('/api/figma/mcp', {});
      setMcp(await getJson<McpInfo>('/api/figma/mcp'));
      setMsg('Figma added to Claude. Sign in once: run claude in a terminal, type /mcp, pick figma and authenticate.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!s) return <div className="settings-page"><div className="hint">{msg || 'Loading…'}</div></div>;

  return (
    <div className="settings-page">
      {msg && <div className="banner"><Icon name="info" small /> <span>{msg}</span></div>}
      <section className="set-card">
        <h2>Figma access</h2>
        <p className="muted">Design Studio reads files, frames, thumbnails and comments with a Figma personal access token (Figma, Settings, Security, Personal access tokens). Give it read access to files and write access to comments.</p>
        <label className="field">
          <span>Personal access token</span>
          <div className="inline">
            <input type="password" value={token} placeholder="figd_…" onChange={(e) => setToken(e.target.value)} />
            <button className="primary" onClick={() => save({ figmaToken: token })}>Save</button>
          </div>
          {who && <span className="muted small">{who}</span>}
        </label>
        <label className="field">
          <span>Team ID, for the team files list (optional)</span>
          <div className="inline">
            <input defaultValue={s.teamId} placeholder="From figma.com/files/team/<id>" onBlur={(e) => e.target.value !== s.teamId && save({ teamId: e.target.value })} />
          </div>
        </label>
        <div className="field">
          <span>Claude's Figma tools</span>
          {mcp?.configured ? (
            <span className="muted">Figma MCP is in your Claude config{mcp.status ? `, status: ${mcp.status.status}` : ''}. {mcp.status?.status === 'needs-auth' ? 'Run claude in a terminal, type /mcp, pick figma and authenticate.' : ''}</span>
          ) : (
            <div className="inline"><span className="muted">Not set up yet.</span><button onClick={addMcp}>Add Figma to Claude</button></div>
          )}
        </div>
      </section>

      <section className="set-card">
        <h2>Appearance</h2>
        <div className="field">
          <span>Theme</span>
          <ThemeSegment />
          <span className="muted small">System follows your computer's light or dark setting.</span>
        </div>
      </section>

      <CheckSetup />

      <section className="set-card">
        <h2>Design runs</h2>
        <Toggle label="Stop after sketch" detail="Wait for you to pick a sketch direction before Claude designs in Figma" on={s.stopAfterSketch} set={(v) => save({ stopAfterSketch: v })} />
        <Toggle label="Ask before changing the file" detail="Claude asks before each change to Figma. Off: Claude edits without asking, after saving a version" on={s.askBeforeEdit} set={(v) => save({ askBeforeEdit: v })} />
        <Toggle label="Follow Claude in Figma" detail="Move the Figma tab to the frame Claude is working on" on={s.followClaude} set={(v) => save({ followClaude: v })} />
        <Toggle label="Check frames against the design system after Claude edits Figma (free)" detail="Runs the free design system check on the frames Claude touched in a chat turn" on={s.autoCheck} set={(v) => save({ autoCheck: v })} />
        <div className="field">
          <span>Default review</span>
          <div className="seg">
            {(['quick', 'full'] as const).map((p) => <button key={p} className={shownPreset(s.preset) === p ? 'on' : ''} title={PRESET_INFO[p].detail} onClick={() => save({ preset: p })}>{PRESET_INFO[p].label}</button>)}
          </div>
          <span className="muted small">{PRESET_INFO[shownPreset(s.preset)].detail}. New chats start with this.</span>
        </div>
      </section>

      <section className="set-card">
        <h2>Models</h2>
        <p className="muted">Opus 5.5 writes the plan. Sonnet 5.5 sketches, designs, fixes and reviews.</p>
        <label className="field">
          <span>Daily budget (USD), 0 = off</span>
          <div className="inline">
            <input type="number" min={0} step={1} defaultValue={s.dailyBudgetUsd} onBlur={(e) => Number(e.target.value) !== s.dailyBudgetUsd && save({ dailyBudgetUsd: Number(e.target.value) })} />
          </div>
          <span className="muted small">The spend pill turns yellow at 80% and red above 100% of this.</span>
        </label>
        <Toggle label="Developer tools" detail="Show the chat folder's files and a terminal" on={s.devTools} set={(v) => save({ devTools: v }).then(() => window.dispatchEvent(new Event('designstudio:settings')))} />
      </section>
    </div>
  );
}

function Toggle({ label, detail, on, set }: { label: string; detail: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="tl-text"><span className="t">{label}</span><span className="muted small">{detail}</span></span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}
