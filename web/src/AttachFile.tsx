import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, send, useStore } from './store';
import { Icon } from './Icon';
import { IconButton } from './Tip';
import { useDialogFocus } from './useDialog';
import { parseFigmaUrl, type FigmaFile } from '../../shared/design';
import { figmaProjectId, projectNameProblem, projectSlug, type FigmaTeam } from '../../shared/newProject';
import type { LiveChat } from '../../shared/protocol';
import './attach.css';

export function recentFiles(live: LiveChat[], currentUrl?: string, max = 5) {
  const seen = new Set<string>(currentUrl ? [currentUrl] : []);
  const out: Array<{ url: string; name: string }> = [];
  for (const c of [...live].sort((a, b) => b.lastActive - a.lastActive)) {
    if (!c.fileUrl || seen.has(c.fileUrl)) continue;
    seen.add(c.fileUrl);
    out.push({ url: c.fileUrl, name: c.file ?? c.fileUrl });
  }
  return out.slice(0, max);
}

/** One name for the action everywhere: the sidebar, the Stages gate, empty states and the welcome. */
export const ATTACH = 'Add project';

/** Same as PROJECTS_CHANGED in panes/ProjectDialogs: the sidebar reloads its projects. */
const PROJECTS_CHANGED = 'designstudio:projects';
const changed = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));

const EVENT = 'designstudio:attach';
type Anchor = { top: number; left: number };
type Proj = { cwd: string; name: string };
type Detail = { anchor?: Anchor; project?: Proj; returnTo?: HTMLElement | null };

/**
 * Opens the popover under `from` when given (the sidebar button), else under the top bar. With a project it opens at
 * "Add a Figma file to <name>?" (the project row's Add Figma file); focus then goes back to `returnTo` on close.
 */
export function openAttach(from?: Element | null, project?: Proj, returnTo?: HTMLElement | null) {
  const r = from?.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { anchor: r ? { top: r.bottom + 4, left: r.left } : undefined, project, returnTo } }));
}

const WIDTH = 360;
const GUTTER = 8;
/** Keeps the popover on screen: a phone is narrower than 360 plus the gutters. */
const place = (a: Anchor | undefined): React.CSSProperties => {
  const top = a?.top ?? (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 44) + 4;
  const left = Math.max(GUTTER, Math.min(a?.left ?? 16, window.innerWidth - Math.min(WIDTH, window.innerWidth - 2 * GUTTER) - GUTTER));
  return { top, left };
};

type Step =
  | { kind: 'name' }
  | { kind: 'choose'; p: Proj }
  | { kind: 'have'; p: Proj | null }
  | { kind: 'location'; p: Proj }
  | { kind: 'creating'; p: Proj }
  | { kind: 'error'; p: Proj; reason: string };

type Teams = { kind: 'loading' } | { kind: 'ready'; teams: FigmaTeam[] };

/** About 10 seconds: one short Claude run that calls create_new_file. An estimate to confirm with real runs. */
const WAIT = 'about 10 seconds';

const withCwd = (path: string, cwd: string) => `${path}?cwd=${encodeURIComponent(cwd)}`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Opens the file's project chat on the Figma tab, the way the sample tour does. */
function openFile(f: FigmaFile) {
  send({ type: 'new_chat', url: f.url });
  setTimeout(() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } })), 400);
}

/**
 * Add project: step 1 names a new project (a folder, no Figma file yet), step 2 adds a file to it: a new one made in
 * Figma, one she has, or not now. Mounted once in App with no button of its own: ⌘O, the sidebar, the project row
 * menu and the empty states open it. A file being made in Figma keeps going when it closes, and a toast reports.
 */
export function AttachHost() {
  const figma = useStore((s) => s.session.figma);
  const live = useStore((s) => s.live);
  const [anchor, setAnchor] = useState<Anchor | undefined | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [busy, setBusy] = useState(false);
  const [root, setRoot] = useState('~/workspace/design-projects');
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [loc, setLoc] = useState<'drafts' | 'project'>('drafts');
  const [projectLink, setProjectLink] = useState('');
  const [projectLinkError, setProjectLinkError] = useState('');
  const [teams, setTeams] = useState<Teams>({ kind: 'loading' });
  const [team, setTeam] = useState('');
  const [tabs, setTabs] = useState<Array<{ title: string; url: string }>>([]);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const making = useRef<string | null>(null);
  const openRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  const open = anchor !== null;
  openRef.current = open;
  const close = () => setAnchor(null);
  useDialogFocus(open, box, close);

  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent<Detail | undefined>).detail;
      // The row menu's item is gone by now: focus its More button first, so closing gives focus back to it.
      d?.returnTo?.focus();
      const p = d?.project;
      setStep(p ? (making.current === p.cwd ? { kind: 'creating', p } : { kind: 'choose', p }) : { kind: 'name' });
      setAnchor(d?.anchor);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    setName(''); setNameError(''); setUrl(''); setPaste(false); setLinkError('');
    getJson<{ root: string }>('/api/projects/root').then((r) => setRoot(r.root)).catch(() => {});
    // A click outside closes it, like the menus. Focus goes back to whatever opened it.
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setAnchor(null);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  // Each step's first field or button takes focus, since the button that moved here is gone.
  useEffect(() => {
    if (!open) return;
    // A step with nothing to fill (Creating) puts focus on its close button, never on the page behind.
    requestAnimationFrame(() => (box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('button'))?.focus());
    if (step.kind === 'have') getJson<Array<{ title: string; url: string }>>('/api/chrome/figma-tabs').then(setTabs).catch(() => setTabs([]));
  }, [open, step.kind, paste]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const finished = (p: Proj, f: FigmaFile, text: string) => {
    changed();
    if (openRef.current && 'p' in stepRef.current && stepRef.current.p?.cwd === p.cwd) {
      close();
      openFile(f);
    }
    setToast({ text });
  };

  const createProject = async () => {
    const problem = projectNameProblem(name);
    if (problem) return setNameError(problem);
    setBusy(true);
    try {
      const r = await postJson<{ cwd: string; name: string }>('/api/projects/new', { name });
      changed();
      setStep({ kind: 'choose', p: { cwd: r.cwd, name: r.name } });
    } catch (e) {
      setNameError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadTeams = (p: Proj) => {
    setTeams({ kind: 'loading' });
    getJson<{ teams: FigmaTeam[] }>(withCwd('/api/projects/figma-teams', p.cwd))
      .then((r) => { setTeams({ kind: 'ready', teams: r.teams }); setTeam(r.teams[0]?.key ?? ''); })
      .catch((e: Error) => setStep({ kind: 'error', p, reason: oneLine(e.message) }));
  };
  /** Try again keeps her location choice; coming from step 2 starts at Drafts. */
  const toLocation = (p: Proj, keep = false) => {
    if (!keep) { setLoc('drafts'); setProjectLink(''); }
    setProjectLinkError('');
    setStep({ kind: 'location', p });
    loadTeams(p);
  };

  const createFile = (p: Proj) => {
    if (loc === 'project' && !figmaProjectId(projectLink)) return setProjectLinkError('That is not a Figma project link. It looks like figma.com/files/…/project/123.');
    making.current = p.cwd;
    setStep({ kind: 'creating', p });
    postJson<{ figma: FigmaFile }>(withCwd('/api/projects/figma-file', p.cwd), { planKey: team, ...(loc === 'project' ? { projectLink: projectLink.trim() } : {}) })
      .then((r) => finished(p, r.figma, `${p.name} is in Figma.`))
      .catch((e: Error) => {
        const reason = oneLine(e.message);
        const here = openRef.current && stepRef.current.kind === 'creating' && stepRef.current.p.cwd === p.cwd;
        if (here) setStep({ kind: 'error', p, reason });
        else setToast({ text: `Figma did not create the file, so ${p.name} has no file yet. ${reason}`, error: true });
      })
      .finally(() => { if (making.current === p.cwd) making.current = null; });
  };

  const pick = async (link: string, p: Proj | null) => {
    // With no project (step 1's link), the old path: the file gets its own project folder, or this chat keeps it.
    if (!p) { send({ type: 'set_figma', url: link }); close(); return; }
    setBusy(true);
    setLinkError('');
    try {
      const r = await postJson<{ figma: FigmaFile }>(withCwd('/api/projects/link', p.cwd), { url: link });
      finished(p, r.figma, `${r.figma.name} is linked to ${p.name}.`);
    } catch (e) {
      setLinkError(oneLine((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const toastEl = toast && (
    <div className={`ds-toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      <Icon name={toast.error ? 'error' : 'pass'} small />
      <span>{toast.text}</span>
      <IconButton label="Close" className="icon-btn" onClick={() => setToast(null)}><Icon name="close" small /></IconButton>
    </div>
  );
  if (!open) return toastEl || null;

  const head = (title: string) => (
    <div className="attach-head">
      <h2 id="attach-title">{title}</h2>
      <IconButton label="Close" tip="Close (Esc)" className="icon-btn" onClick={close}><Icon name="close" small /></IconButton>
    </div>
  );

  let body: React.ReactNode;
  let title: string;
  if (step.kind === 'name') {
    title = 'New project';
    const slug = projectSlug(name);
    const live = name.trim() ? projectNameProblem(name) : '';
    const shown = nameError || (live && live !== 'Give the project a name.' ? live : '');
    const why = !name.trim() ? 'Type a project name first' : live || undefined;
    body = (
      <>
        <form className="attach-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!why && !busy) void createProject(); }}>
          <label htmlFor="np-name">Project name <span aria-hidden="true">*</span></label>
          <input id="np-name" data-autofocus required autoComplete="off" spellCheck={false} maxLength={80} value={name} readOnly={busy}
            aria-invalid={shown ? true : undefined} aria-describedby={shown ? 'np-error np-folder' : 'np-folder'}
            onChange={(e) => { setName(e.target.value); setNameError(''); }} />
          {shown && <div className="attach-note error-text" id="np-error"><Icon name="error" small /> {shown}</div>}
          <div className="attach-note attach-folder" id="np-folder">Folder: {root}/{slug || '…'}</div>
          <div className="attach-foot">
            <span className="attach-note">* Required</span>
            <button type="submit" className="primary" disabled={Boolean(why) || busy} title={why}>{busy ? 'Creating…' : 'Create project'}</button>
          </div>
        </form>
        <div className="attach-alt">
          <span className="attach-note">Have a Figma file already?</span>
          <button type="button" className="link" onClick={() => setStep({ kind: 'have', p: null })}>Use a file I have</button>
        </div>
      </>
    );
  } else if (step.kind === 'choose') {
    const p = step.p;
    title = `Add a Figma file to ${p.name}?`;
    body = (
      <div className="attach-body">
        <p className="attach-note attach-lead">The project folder is ready. Its Figma file is where Claude designs.</p>
        <div className="attach-actions">
          <button type="button" className="primary" data-autofocus onClick={() => toLocation(p)}>Create a new Figma file</button>
          <button type="button" onClick={() => { setPaste(false); setUrl(''); setLinkError(''); setStep({ kind: 'have', p }); }}>Use a file I have</button>
          <button type="button" className="link attach-later" onClick={close}>Not now</button>
        </div>
      </div>
    );
  } else if (step.kind === 'have') {
    const p = step.p;
    title = 'Use a file I have';
    const trimmed = url.trim();
    const valid = Boolean(parseFigmaUrl(trimmed));
    const invalid = trimmed !== '' && !valid;
    const recent = recentFiles(live, figma?.url);
    const chromeTabs = tabs.filter((t) => parseFigmaUrl(t.url)?.key !== figma?.key);
    const none = !chromeTabs.length && !recent.length;
    body = (
      <>
        {p && <p className="attach-note attach-lead attach-pad">Pick the file for {p.name}.</p>}
        {linkError && <p className="attach-note error-text attach-pad" role="alert"><Icon name="error" small /> {linkError}</p>}
        {chromeTabs.length > 0 && (
          <>
            <div className="attach-label">Open in Chrome</div>
            <ul>
              {chromeTabs.map((t, i) => (
                <li key={t.url}><button type="button" title={t.url} disabled={busy} data-autofocus={i === 0 && !paste ? true : undefined} onClick={() => void pick(t.url, p)}><Icon name="browser" small /><span className="attach-name">{t.title}</span></button></li>
              ))}
            </ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            <div className="attach-label">Recent files</div>
            <ul>
              {recent.map((f, i) => (
                <li key={f.url}><button type="button" title={f.url} disabled={busy} data-autofocus={i === 0 && !chromeTabs.length && !paste ? true : undefined} onClick={() => void pick(f.url, p)}><Icon name="file-media" small /><span className="attach-name">{f.name}</span></button></li>
              ))}
            </ul>
          </>
        )}
        {paste ? (
          <form className="attach-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void pick(trimmed, p); }}>
            <label htmlFor="attach-url">Figma file link</label>
            <div className="attach-row">
              <input id="attach-url" data-autofocus placeholder="https://www.figma.com/design/…" aria-invalid={invalid || undefined} aria-describedby={invalid ? 'attach-error' : undefined}
                value={url} onChange={(e) => { setUrl(e.target.value); setLinkError(''); }} />
              <button type="submit" className="primary" disabled={!valid || busy} title={valid ? undefined : 'Paste a Figma file link first'}>{busy ? 'Adding…' : 'Add'}</button>
            </div>
            {invalid && <div className="attach-note error-text" id="attach-error"><Icon name="error" small /> That is not a Figma file link. It starts with figma.com/design/.</div>}
          </form>
        ) : (
          <div className="attach-alt">
            {none && <span className="attach-note">No Figma files open in Chrome.</span>}
            <button type="button" className="link" data-autofocus={none ? true : undefined} onClick={() => setPaste(true)}>Paste a link</button>
          </div>
        )}
        <div className="attach-foot attach-pad">
          <button type="button" className="ghost" onClick={() => setStep(p ? { kind: 'choose', p } : { kind: 'name' })}><Icon name="arrow-left" small /> Back</button>
        </div>
      </>
    );
  } else if (step.kind === 'location') {
    const p = step.p;
    title = `New Figma file for ${p.name}`;
    const list = teams.kind === 'ready' ? teams.teams : [];
    const linkBad = projectLinkError && loc === 'project';
    body = (
      <form className="attach-form" noValidate onSubmit={(e) => { e.preventDefault(); if (teams.kind === 'ready') createFile(p); }}>
        <fieldset className="attach-radios">
          <legend>Location</legend>
          <label><input type="radio" name="np-loc" data-autofocus checked={loc === 'drafts'} onChange={() => setLoc('drafts')} /> Drafts</label>
          <label><input type="radio" name="np-loc" checked={loc === 'project'} onChange={() => setLoc('project')} /> In a Figma project</label>
        </fieldset>
        {loc === 'project' && (
          <div className="attach-field">
            <label htmlFor="np-link">Figma project link <span aria-hidden="true">*</span></label>
            <input id="np-link" required autoComplete="off" spellCheck={false} placeholder="https://www.figma.com/files/…/project/…" value={projectLink}
              aria-invalid={linkBad ? true : undefined} aria-describedby={linkBad ? 'np-link-error' : 'np-link-help'}
              onChange={(e) => { setProjectLink(e.target.value); setProjectLinkError(''); }}
              onBlur={() => projectLink.trim() && !figmaProjectId(projectLink) && setProjectLinkError('That is not a Figma project link. It looks like figma.com/files/…/project/123.')} />
            {linkBad
              ? <div className="attach-note error-text" id="np-link-error"><Icon name="error" small /> {projectLinkError}</div>
              : <div className="attach-note" id="np-link-help">Copy it from the project's page in Figma.</div>}
          </div>
        )}
        {list.length > 1 && (
          <div className="attach-field">
            <label htmlFor="np-team">Team</label>
            <select id="np-team" className="attach-select" value={team} onChange={(e) => setTeam(e.target.value)}>
              {list.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </div>
        )}
        {list.length === 1 && <div className="attach-note">Team: {list[0].name}</div>}
        {teams.kind === 'loading' && <div className="attach-note attach-wait" role="status"><span className="attach-spin" aria-hidden="true" /> Checking your Figma teams…</div>}
        <div className="attach-note">{loc === 'project' ? '* Required' : `File name: ${p.name}`}</div>
        <div className="attach-foot">
          <button type="button" className="ghost" onClick={() => setStep({ kind: 'choose', p })}><Icon name="arrow-left" small /> Back</button>
          {(() => {
            const why = teams.kind === 'loading' ? 'Checking your Figma teams first' : loc === 'project' && !projectLink.trim() ? 'Paste the Figma project link first' : undefined;
            return <button type="submit" className="primary" disabled={Boolean(why)} title={why}>Create file</button>;
          })()}
        </div>
      </form>
    );
  } else if (step.kind === 'creating') {
    title = `Creating ${step.p.name}`;
    body = (
      <div className="attach-body">
        <p className="attach-note attach-wait attach-lead" role="status"><span className="attach-spin" aria-hidden="true" /> Creating {step.p.name} in Figma, {WAIT}.</p>
        <p className="attach-note">You can close this. A message shows at the top when it is done.</p>
      </div>
    );
  } else {
    const p = step.p;
    title = `New Figma file for ${p.name}`;
    body = (
      <div className="attach-body">
        <div className="attach-error-box" role="alert">
          <p className="attach-error-title">Figma did not create the file, so {p.name} has no file yet.</p>
          <p className="attach-note attach-reason">{step.reason}</p>
        </div>
        <div className="attach-actions attach-actions-row">
          <button type="button" data-autofocus onClick={() => toLocation(p, true)}>Try again</button>
          <button type="button" className="link" onClick={() => { setPaste(false); setUrl(''); setLinkError(''); setStep({ kind: 'have', p }); }}>Use a file I have</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {toastEl}
      <div ref={box} className="switcher attach-pop" role="dialog" aria-modal="false" aria-labelledby="attach-title" aria-busy={step.kind === 'creating' || busy || undefined} style={place(anchor)}>
        {head(title)}
        {body}
      </div>
    </>
  );
}
