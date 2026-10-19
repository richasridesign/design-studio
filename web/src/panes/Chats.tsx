import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getJson, postJson, send, setUi, useStore, type Selection } from '../store';
import { Icon } from '../Icon';
import { ATTACH, openAttach } from '../AttachFile';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { type ChatEvent, type LiveChat, type SavedSession } from '../../../shared/protocol';
import { compareIds, iterationLabel, type Iteration, type ProjectSummary } from '../../../shared/project';
import { replyLine } from '../../../shared/edits';
import '../chats.css';
import { press } from '../press';
import { runningText } from '../StatusBar';
import { buildTree, chatCount, filterTree, type ChatSet, type TreeFlow, type TreeIteration, type TreeProject } from './projectTree';
import { AdoptDialog, NewIterationDialog, PROJECTS_CHANGED } from './ProjectDialogs';
import { RunAcrossFlowsDialog } from './RunAcrossFlows';
import { TaskCard, TaskRows } from './TaskCard';
import { useTasks } from './taskStore';
import { RemoveProjectDialog, RenameDialog } from './ProjectActions';
import { NewFlowDialog } from './NewFlow';
import { PortfolioGroup } from './PortfolioGroup';
import { NewChatPicker } from './NewChatPicker';
import { startFlowChat } from './chatPlaceState';
import { doublesText, renameLabel } from '../../../shared/projectNames';

export { buildTree, filterTree } from './projectTree';

const RECENT = 5;
const FOLDED_KEY = 'designstudio.foldedFolders';

// Opens the sample chat (Grocery app) on its Figma tab. Shared by the sidebar row and the first-run state.
export async function openSample() {
  const { id } = await postJson<{ id: string }>('/api/sample', {});
  send({ type: 'view', id });
  setTimeout(() => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } })), 400);
}

type Dialog = { kind: 'adopt'; p: TreeProject } | { kind: 'iteration'; p: TreeProject; project: NonNullable<ProjectSummary['project']> } | { kind: 'run'; p: TreeProject; project: NonNullable<ProjectSummary['project']> } | { kind: 'task'; id: string } | { kind: 'remove'; p: TreeProject; chats: number; tasks: number } | { kind: 'rename'; p: TreeProject; count: number } | { kind: 'flow'; p: TreeProject } | { kind: 'chat'; p: TreeProject };

export function Chats() {
  const viewing = useStore((s) => s.session.id);
  const current = useStore((s) => s.session.sessionId);
  const live = useStore((s) => s.live);
  const sel = useStore((s) => s.ui.selection);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saved, setSaved] = useState<SavedSession[]>([]);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const taskList = useTasks();
  const [opening, setOpening] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const fold = (key: string) => setFolded((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...next])); } catch {}
    return next;
  });
  const isOpen = (key: string) => Boolean(query) || !folded.has(key);

  const loadProjects = () => void getJson<{ projects: ProjectSummary[] }>('/api/projects').then((r) => setProjects(r.projects)).catch(() => {});
  useEffect(() => {
    loadProjects();
    getJson<SavedSession[]>('/api/sessions').then(setSaved).catch(() => {});
    setOpening(null);
  }, [current, live.length]);

  useEffect(() => {
    // The project rows show each folder's stage and its iterations: reload them when one changes.
    window.addEventListener('designstudio:stages', loadProjects);
    window.addEventListener(PROJECTS_CHANGED, loadProjects);
    return () => {
      window.removeEventListener('designstudio:stages', loadProjects);
      window.removeEventListener(PROJECTS_CHANGED, loadProjects);
    };
  }, []);

  const all = useMemo(() => buildTree(live, saved, projects), [live, saved, projects]);
  const tree = useMemo(() => filterTree(all, query), [all, query]);
  const close = (c: LiveChat) =>
    c.running || c.pending
      ? setAsk({ title: 'Close this chat?', detail: c.title, warning: 'Claude is still working on it and will stop. The transcript is kept.', action: 'Close', run: async () => send({ type: 'close', id: c.id }) })
      : send({ type: 'close', id: c.id });
  const open = (s: SavedSession) => { setUi({ selection: null }); setOpening(s.sessionId); send({ type: 'open_session', sessionId: s.sessionId }); };

  // A project, flow or iteration row selects it: the Figma and Review tabs show it, and the Figma tab in Chrome moves
  // to its section when the file is open there. The chevron alone folds the row.
  const select = (next: Selection) => {
    setUi({ selection: next });
    send({ type: 'selection', cwd: next.cwd, flow: next.flow?.slug, iteration: next.kind === 'project' ? undefined : next.iteration?.id });
  };
  const same = (a: Selection | null, b: Selection) => !!a && a.kind === b.kind && a.cwd === b.cwd && a.flow?.slug === b.flow?.slug && a.iteration?.id === b.iteration?.id;
  const base = (p: TreeProject) => ({ cwd: p.cwd, name: p.name, key: p.key, url: p.url });
  const itSel = (it: Iteration, label: string, slug?: string) => {
    const own = slug ? it.flows?.[slug] : undefined;
    const flowNodes = own ? [own.node, own.states].filter((x): x is string => !!x) : [];
    return { id: it.id, label, state: it.state, ...(it.node ? { node: it.node } : {}), ...(flowNodes.length ? { flowNodes } : {}) };
  };

  // A flow that is not in the working iteration yet gets its subsection (entry screens copied) before the chat starts.
  const chatIn = (p: TreeProject, f: TreeFlow, it: Iteration) => {
    if (it.flows?.[f.flow.slug]) return send({ type: 'new_session', cwd: p.cwd, flow: f.flow.slug, iteration: it.id });
    setAsk({
      title: `Add ${f.flow.name} to ${it.id}?`, detail: `This copies its entry screens into a new ${f.flow.name} subsection of ${it.id}, then starts the chat there.`, action: 'Add and start chat', icon: 'add', safe: true,
      run: async () => {
        setNote({ text: `Adding ${f.flow.name} to ${it.id} in Figma, about 20 seconds.` });
        try {
          const warn = await startFlowChat(p.cwd, f.flow, it);
          setNote(warn ? { text: warn, error: true } : null);
        } catch (e) {
          setNote({ text: `${f.flow.name} was not added to ${it.id}: ${(e as Error).message}`, error: true });
        }
      },
    });
  };

  // Freeze and Reopen act on the whole iteration, every flow in it.
  const setState = (p: TreeProject, it: Iteration, state: 'working' | 'frozen') => async () => {
    try {
      await postJson(`/api/projects/iteration?cwd=${encodeURIComponent(p.cwd)}`, { id: it.id, state });
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
      setNote(null);
    } catch (e) {
      setNote({ text: `${it.id} was not ${state === 'frozen' ? 'frozen' : 'reopened'}: ${(e as Error).message}`, error: true });
    }
  };
  const freeze = (p: TreeProject, it: Iteration) => setAsk({ title: `Freeze ${it.id}?`, detail: `Every flow in ${it.id} becomes read only: chats can copy from it but not edit it. You can reopen it here.`, action: 'Freeze', icon: 'lock', safe: true, run: setState(p, it, 'frozen') });
  const reopen = (p: TreeProject, it: Iteration, all: Iteration[]) => {
    const newer = all.filter((x) => x.state === 'working' && compareIds(x.id, it.id) > 0).map((x) => x.id);
    setAsk({
      title: `Reopen ${it.id}?`, detail: `Chats can edit every flow in ${it.id} again.`, action: 'Reopen', icon: 'unlock', safe: true,
      warning: newer.length ? `${newer.join(' and ')} ${newer.length > 1 ? 'are' : 'is'} also working. New chats on a flow still go to ${newer.at(-1)}.` : undefined,
      run: setState(p, it, 'working'),
    });
  };

  const runSample = async () => {
    setSampleBusy(true);
    setSampleError('');
    try {
      await openSample();
    } catch (err) {
      setSampleError((err as Error).message);
    }
    setSampleBusy(false);
  };

  const chats = (s: ChatSet, depth: number) => (
    <>
      {s.open.map((c) => <LiveRow key={c.id} c={c} depth={depth} selected={c.id === viewing && !sel} onClose={() => close(c)} />)}
      {(query ? s.recent : s.recent.slice(0, RECENT)).map((r) => (
        <div key={r.sessionId} className={`row session recent d${depth}`} title={r.title} onClick={() => open(r)} {...press(() => open(r))}>
          <span className="name">{opening === r.sessionId ? 'Opening… ' : ''}{r.title}</span>
          <span className="when">{ago(r.lastModified)}</span>
        </div>
      ))}
    </>
  );

  const group = (key: string, depth: number, icon: ReactNode, name: ReactNode, count: number, tag: ReactNode, acts: ReactNode, body: ReactNode, title?: string, pick?: { label: string; selected: boolean; run: () => void }) => {
    const shown = isOpen(key);
    const toggle = () => query || fold(key);
    const chevron = <span className="twistie chevron"><Icon name={shown ? 'chevron-down' : 'chevron-right'} small /></span>;
    const face = (
      <>
        <span className="twistie">{typeof icon === 'string' ? <Icon name={icon} small /> : icon}</span>
        <span className="name">{name}</span>
      </>
    );
    return (
      <div key={key} className={`branch d${depth}`}>
        <div className={`row project d${depth} ${pick ? 'picks' : ''} ${pick?.selected ? 'selected' : ''}`} title={title} onClick={pick ? pick.run : toggle}>
          {pick ? (
            <>
              {/* Selectable rows fold on the chevron only; the rest of the row selects. */}
              <span className="fold-btn" aria-expanded={shown} aria-label={`${shown ? 'Collapse' : 'Expand'} ${pick.label}`} title={shown ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(); }} {...press(toggle)}>{chevron}</span>
              <span className="fold" aria-current={pick.selected || undefined} {...press(pick.run)}>{face}</span>
            </>
          ) : (
            <span className="fold" aria-expanded={shown} title={shown ? 'Collapse' : 'Expand'} {...press(toggle)}>{chevron}{face}</span>
          )}
          {!shown && <span className="count" title={`${count} chats`}>{count}</span>}
          {tag}
          <span className="acts">{acts}</span>
        </div>
        {shown && body}
      </div>
    );
  };

  const newChat = (label: string, msg: Parameters<typeof send>[0] | (() => void)) => (
    <button className="icon-btn" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); if (typeof msg === 'function') msg(); else send(msg); }}><Icon name="add" small /></button>
  );

  const iterationRow = (p: TreeProject, f: TreeFlow, i: TreeIteration) => {
    const working = i.iteration.state === 'working';
    // The state is the row's icon (filled dot for Working, ring for Frozen). The 160px sidebar has room for one word, so
    // only the working iteration, where new chats go, carries its label; Frozen is read by screen readers and the tooltip.
    const icon = <span className={`state-dot ${working ? 'working' : 'frozen'}`} aria-hidden />;
    const tag = working ? <span className="state-tag working">Working</span> : <span className="sr-only">Frozen</span>;
    const all = f.iterations.map((x) => x.iteration);
    const menu = <RowMenu label={`More for ${i.iteration.id}`} items={[working
      ? { label: `Freeze ${i.iteration.id}`, hint: 'Every flow becomes read only', run: () => freeze(p, i.iteration) }
      : { label: `Reopen ${i.iteration.id}`, hint: 'Chats can edit it again', run: () => reopen(p, i.iteration, all) }]} />;
    const acts = <>{working && newChat(`New chat on ${f.flow.name} in ${i.iteration.id}`, () => chatIn(p, f, i.iteration))}{menu}</>;
    const title = `${i.label}: ${working ? 'working, chats can edit it' : 'frozen, chats only read it'}${i.iteration.node ? `. Figma section ${i.iteration.node}` : '. No Figma section yet'}`;
    const name = <><span className="it-id">{i.iteration.id} · </span><span className="it-topic">{i.label.slice(i.iteration.id.length + 3)}</span></>;
    const me: Selection = { kind: 'iteration', ...base(p), flow: { slug: f.flow.slug, n: f.flow.n, name: f.flow.name }, iteration: itSel(i.iteration, i.label, f.flow.slug) };
    return group(`${p.cwd}#${f.flow.slug}#${i.iteration.id}`, 2, icon, name, chatCount(i), tag, acts, chats(i, 3), title, { label: `${f.flow.name} in ${i.label}`, selected: same(sel, me), run: () => select(me) });
  };

  const flowRow = (p: TreeProject, f: TreeFlow) => {
    const w = p.working;
    const acts = w ? newChat(`New chat on ${f.flow.name} in ${w.id}`, () => chatIn(p, f, w)) : null;
    const me: Selection = { kind: 'flow', ...base(p), flow: { slug: f.flow.slug, n: f.flow.n, name: f.flow.name }, ...(w ? { iteration: itSel(w, f.iterations.find((x) => x.iteration.id === w.id)?.label ?? w.id, f.flow.slug) } : {}) };
    // A flow adoption found before but not the last time stays, with its folders and chats, and says so.
    // At the 160px default the name needs the room, so the icon and grey name carry it; the tag shows when wider.
    const tag = f.flow.missing ? <span className="state-tag missing"><span className="missing-text">Not in Figma</span></span> : null;
    const title = f.flow.missing ? `${f.flow.name}: the last adoption did not find this flow in Figma. Its folders and chats are kept.` : undefined;
    return group(`${p.cwd}#${f.flow.slug}`, 1, f.flow.missing ? 'circle-slash' : 'git-branch', f.flow.missing ? <span className="flow-missing">{`${f.flow.n} · ${f.flow.name}`}</span> : `${f.flow.n} · ${f.flow.name}`, f.count, tag, acts, f.iterations.map((i) => iterationRow(p, f, i)), title, { label: f.flow.name, selected: same(sel, me), run: () => select(me) });
  };

  const plain = (p: TreeProject, key: string, name: string, s: ChatSet, extra?: ReactNode) =>
    chatCount(s) || extra ? group(`${p.cwd}#${key}`, 1, 'folder', name, chatCount(s), null, extra, chats(s, 2)) : null;

  const projectRow = (p: TreeProject) => {
    const sum = projects.find((x) => x.cwd === p.cwd);
    const inside = (cwd: string) => cwd === p.cwd || cwd.startsWith(`${p.cwd}/`);
    const remove = () => setDialog({ kind: 'remove', p, chats: live.filter((c) => inside(c.cwd)).length, tasks: taskList.tasks.filter((t) => t.root === p.cwd && (t.state === 'running' || t.state === 'paused')).length });
    // New project with no Figma file yet: Add Figma file reopens "Add a Figma file to <name>?", and the file-only
    // items wait for the file. Focus goes back to this row's More button when the popover closes.
    const addFile = () => {
      const more = document.querySelector<HTMLElement>(`.row.project button.icon-btn[aria-label="${CSS.escape(`More for ${p.name}`)}"]`);
      openAttach(more, { cwd: p.cwd, name: p.name }, more);
    };
    const menu = p.noFile ? (
      <RowMenu label={`More for ${p.name}`} items={[
        { label: 'Add Figma file', hint: 'A new file, or one you have', run: addFile },
        { label: 'Remove project', hint: 'Moves the folder to .trash', run: remove },
      ]} />
    ) : (
      <RowMenu label={`More for ${p.name}`} items={[
        { label: p.adopted ? 'Adopt this file again' : 'Adopt this file', hint: 'Sections become flows and iterations', run: () => setDialog({ kind: 'adopt', p }) },
        ...(p.adopted ? [{ label: 'New iteration', hint: p.working ? `${p.working.id} is still working` : `After ${p.flows.length} flows`, run: () => { const project = projects.find((x) => x.cwd === p.cwd)?.project; if (project) setDialog({ kind: 'iteration', p, project }); } }] : []),
        { label: 'New flow', hint: 'Starts From scratch', run: () => setDialog({ kind: 'flow', p }) },
        ...(p.adopted ? [{ label: 'Run across flows', hint: 'One prompt, one chat per flow', run: () => { const project = projects.find((x) => x.cwd === p.cwd)?.project; if (project) setDialog({ kind: 'run', p, project }); } }] : []),
        ...(sum?.renames ? [{ label: renameLabel(sum.renames), hint: 'Working iteration only', run: () => setDialog({ kind: 'rename', p, count: sum.renames! }) }] : []),
        { label: 'Open in Figma', hint: 'In a new tab', run: () => window.open(p.url, '_blank', 'noopener') },
        { label: 'Remove project', hint: 'Moves the folder to .trash', run: remove },
      ]} />
    );
    const acts = (
      <>
        {/* Opens the picker: no flow (a project chat, as before), or a flow and its iteration. */}
        <button className="icon-btn" title={`New chat in ${p.name}`} aria-label={`New chat in ${p.name}`} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'chat', p }); }}><Icon name="add" small /></button>
        {menu}
      </>
    );
    const dup = sum?.doubles?.length ? doublesText(sum.doubles) : null;
    const tag = (
      <>
        {dup && <span className="dup-tag" title={dup.detail}><Icon name="warning" small /><span className="sr-only">{dup.short}</span></span>}
        {p.stage ? <span className="stage-tag" title={`Next step: ${p.stage}`}>{p.stage}</span> : null}
      </>
    );
    const body = p.noFile
      ? (
        <>
          <div className="hint adopt-hint">No Figma file yet. <button className="link" onClick={addFile}>Add Figma file</button></div>
          {/* New flow works before the file, so its flows and their chats show here too. */}
          {p.flows.map((f) => flowRow(p, f))}
          {plain(p, 'tasks', 'Project tasks', p.tasks)}
          {plain(p, 'before', 'Before flows', p.before)}
        </>
      )
      : p.adopted
      ? (
        <>
          <TaskRows tasks={taskList.tasks.filter((t) => t.root === p.cwd)} onOpen={(id) => setDialog({ kind: 'task', id })} />
          {p.flows.map((f) => flowRow(p, f))}
          {plain(p, 'tasks', 'Project tasks', p.tasks)}
          {plain(p, 'before', 'Before flows', p.before)}
        </>
      )
      : (
        <>
          <div className="hint adopt-hint">Not adopted yet. <button className="link" onClick={() => setDialog({ kind: 'adopt', p })}>Adopt this file</button></div>
          {plain(p, 'before', 'Before flows', p.before)}
        </>
      );
    const me: Selection = { kind: 'project', ...base(p), ...(p.working ? { iteration: itSel(p.working, p.flows[0]?.iterations.find((x) => x.iteration.id === p.working!.id)?.label ?? p.working.id) } : {}) };
    return group(p.cwd, 0, 'file-media', p.name, p.count, tag, acts, body, p.cwd, { label: p.name, selected: same(sel, me), run: () => select(me) });
  };

  const noFile = chatCount(tree.noFile)
    ? group('no-file', 0, 'file-media', 'No file yet', chatCount(tree.noFile), null, newChat('New chat with no file', { type: 'new_chat' }), chats(tree.noFile, 1))
    : null;

  return (
    <div className="sessions chats">
      <div className="sessions-bar">
        <button className="new-chat" onClick={() => send({ type: 'new_chat' })}><Icon name="add" small /> New chat</button>
        {/* Rarer than a new chat, so it is the quieter of the two. It opens the same popover as ⌘O, under itself. */}
        <button className="ghost add-project" aria-haspopup="dialog" aria-keyshortcuts="Meta+O" onClick={(e) => openAttach(e.currentTarget)}><Icon name="file-media" small /> {ATTACH}</button>
      </div>
      <div className="sessions-bar">
        <input type="search" placeholder="Search chats" aria-label="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); } }} />
      </div>
      <div className="tree">
        <div className={`row session sample ${sampleBusy ? 'busy' : ''}`} title="Open the sample chat" onClick={() => sampleBusy || void runSample()} {...press(() => sampleBusy || void runSample())}>
          <span className="twistie"><Icon name="compass" small /></span>
          <span className="name">Sample tour</span>
        </div>
        {sampleError && <div className="hint error-text">{sampleError}</div>}
        {note && <div className={`hint ${note.error ? 'error-text' : ''}`} role={note.error ? 'alert' : 'status'}>{note.text}</div>}
        <PortfolioGroup />
        {tree.projects.map(projectRow)}
        {noFile}
        {!tree.projects.length && !noFile && <div className="hint">{query ? 'No chats match.' : 'No chats yet.'}</div>}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
      {dialog?.kind === 'adopt' && <AdoptDialog cwd={dialog.p.cwd} name={dialog.p.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'iteration' && (() => {
        const p = dialog.p;
        return <NewIterationDialog cwd={p.cwd} name={p.name} project={dialog.project} onClose={() => setDialog(null)} onCreated={(it) => select({ kind: 'iteration', ...base(p), iteration: itSel(it, iterationLabel(it)) })} />;
      })()}
      {dialog?.kind === 'flow' && (() => {
        const p = dialog.p;
        return <NewFlowDialog cwd={p.cwd} name={p.name} project={projects.find((x) => x.cwd === p.cwd)?.project ?? null} onClose={() => setDialog(null)} onCreated={(made) => send({ type: 'new_session', cwd: p.cwd, flow: made.flow.slug, iteration: made.iteration.id })} />;
      })()}
      {dialog?.kind === 'chat' && (() => {
        const p = dialog.p;
        // The picker hands over to New flow after its own focus return to the "+", so New flow gives focus back there too.
        const newFlow = () => { setDialog(null); requestAnimationFrame(() => requestAnimationFrame(() => setDialog({ kind: 'flow', p }))); };
        return <NewChatPicker cwd={p.cwd} name={p.name} project={projects.find((x) => x.cwd === p.cwd)?.project ?? null} onClose={() => setDialog(null)} onNewFlow={newFlow} onNote={(text) => setNote({ text, error: true })} />;
      })()}
      {dialog?.kind === 'run' && <RunAcrossFlowsDialog cwd={dialog.p.cwd} name={dialog.p.name} project={dialog.project} weeklyPct={taskList.weeklyPct} cap={taskList.cap} parallel={taskList.parallel} onClose={() => setDialog(null)} onOpenTask={(id) => setDialog({ kind: 'task', id })} />}
      {dialog?.kind === 'remove' && <RemoveProjectDialog cwd={dialog.p.cwd} name={dialog.p.name} chats={dialog.chats} tasks={dialog.tasks} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <RenameDialog cwd={dialog.p.cwd} name={dialog.p.name} count={dialog.count} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'task' && (() => { const t = taskList.tasks.find((x) => x.id === dialog.id); return t ? <TaskCard task={t} onClose={() => setDialog(null)} /> : null; })()}
    </div>
  );
}

/** The row's "more" menu: opens under its button, closes on Esc, outside click or a pick, and gives focus back. */
function RowMenu({ label, items }: { label: string; items: Array<{ label: string; hint?: string; run: () => void }> }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const box = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    // The sidebar is narrower than the menu and clips it, so the menu is fixed to the viewport, 4px under its button,
    // its right edge on the button's right edge, and pulled in when that would leave the window.
    const r = box.current?.querySelector('.icon-btn')?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)) });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector<HTMLButtonElement>('.icon-btn')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <span className="row-menu" ref={box} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Icon name="kebab-vertical" small /></button>
      {open && (
        <div className="row-menu-pop" role="menu" aria-label={label} style={at}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.run(); }}>
              <span className="t">{it.label}</span>
              {it.hint && <span className="h">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function line(c: LiveChat, events: ChatEvent[] | null) {
  return c.pending ? 'Needs you' : c.running ? runningText(c.status) : c.last ?? (events ? replyLine(events) : '') ?? '';
}

// Viewing a chat drops a project, flow or iteration selection, so the tabs follow the chat again.
const pick = (c: LiveChat, selected: boolean) => {
  setUi({ selection: null });
  if (!selected) send({ type: 'view', id: c.id });
};

function LiveRow({ c, depth, selected, onClose }: { c: LiveChat; depth: number; selected: boolean; onClose: () => void }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const text = line(c, events);
  return (
    <div className={`row session live d${depth} ${text ? 'two' : ''} ${selected ? 'selected' : ''}`} title={c.title} onClick={() => pick(c, selected)}>
      <span className={`dot ${c.pending ? 'waiting' : c.running ? 'running' : 'idle'}`} />
      <span className="lines" aria-current={selected || undefined} {...press(() => pick(c, selected))}>
        <span className="l1">
          <span className="name">{c.title}</span>
          <span className="when">{c.pending || c.running ? '' : ago(c.lastActive)}</span>
        </span>
        {text && <span className="l2"><span className="sub">{text}</span></span>}
      </span>
      <span className="acts">
        <button className="icon-btn" title="Close chat, keep the transcript" aria-label="Close chat" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="close" small /></button>
      </span>
    </div>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
