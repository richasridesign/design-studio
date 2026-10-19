import { useEffect, useMemo, useRef, useState } from 'react';
import { notice, send, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { useTip } from '../Tip';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { QuickPick, type PickItem } from '../QuickPick';
import { ago } from '../ago';
import type { LiveChat, SavedSession } from '../../../shared/protocol';
import type { Project } from '../../../shared/project';
import { buildTree, type ChatSet, type TreeProject } from './projectTree';
import { defaultIteration, iterationsFor, needsCopy, placeLabel, placeOf, startFlowChat, useProjects, vId, type Place } from './chatPlaceState';
import '../chatPlace.css';

// The chip above the chat: where this chat works (a flow in an iteration, or the whole project), with a Frozen marker
// when it only reads Figma. It opens "Switch flow or chat" (also ⌘K): picking a chat views it, picking a flow's
// iteration or the project starts a new chat there, the same path as the sidebar "+". A chat never moves: its Claude
// session belongs to its folder.

const RECENT = 5;
export const SWITCH_COMMAND = 'switch-chat';

/** Where the open chat sits, from its folder and the project list. */
export function useChatPlace() {
  const cwd = useStore((s) => s.session.cwd);
  const { projects, saved } = useProjects();
  const place = useMemo(() => placeOf(cwd, projects), [cwd, projects]);
  return { place, projects, saved };
}

const chatDetail = (c: LiveChat) => (c.pending ? 'Needs you' : c.running ? 'Working' : `Open · ${ago(c.lastActive)}`);

function chatItems(s: ChatSet, keywords: string, indent: number): PickItem[] {
  return [
    ...s.open.map((c): PickItem => ({ value: `live|${c.id}`, label: c.title, detail: chatDetail(c), icon: 'comment', indent, keywords })),
    ...s.recent.slice(0, RECENT).map((r: SavedSession): PickItem => ({ value: `saved|${r.sessionId}`, label: r.title, detail: `Recent · ${ago(r.lastModified)}`, icon: 'history', indent, keywords })),
  ];
}

/**
 * One project: itself (a project-wide chat) and its chats, then each flow's iterations, each with its chats. The
 * iterations are the new chat picker's (every working one, frozen ones that hold the flow), plus any with chats.
 */
function projectItems(p: TreeProject, project: Project | null, projectFlows: Map<string, TreeProject['flows'][number]['flow']>): PickItem[] {
  const out: PickItem[] = [
    { value: `new|${p.cwd}`, label: p.name, detail: 'Whole project · New chat', icon: 'file-media', keywords: 'project' },
    ...chatItems({ open: [...p.tasks.open, ...p.before.open], recent: [...p.tasks.recent, ...p.before.recent].sort((a, b) => b.lastModified - a.lastModified) }, p.name, 1),
  ];
  for (const f of p.flows) {
    projectFlows.set(`${p.cwd}|${f.flow.slug}`, f.flow);
    const its = project ? iterationsFor(project, f.flow.slug) : [];
    const extra = f.iterations.map((i) => i.iteration).filter((x) => !its.some((y) => y.id === x.id));
    for (const it of [...its, ...extra]) {
      const i = f.iterations.find((x) => x.iteration.id === it.id);
      const frozen = it.state === 'frozen';
      out.push({ value: `new|${p.cwd}|${f.flow.slug}|${it.id}`, label: placeLabel(f.flow, it), detail: `${frozen ? 'Frozen, read only' : 'Working'} · New chat`, mark: frozen ? 'frozen' : 'working', keywords: it.topic ?? '' });
      if (i) out.push(...chatItems(i, `${f.flow.name} ${vId(it.id)}`, 1));
    }
  }
  return out;
}

export function ChatPlace({ place, projects, saved }: ReturnType<typeof useChatPlace>) {
  const live = useStore((s) => s.live);
  const viewing = useStore((s) => s.session.id);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const chip = useRef<HTMLButtonElement | null>(null);
  const frozen = place?.iteration?.state === 'frozen';
  const text = place ? (place.flow && place.iteration ? placeLabel(place.flow, place.iteration) : place.summary.name) : '';
  const tip = useTip(place?.flow ? `Switch flow or chat (⌘K). This chat stays on ${place.flow.name} in ${vId(place.iteration!.id)}${frozen ? ', read only' : ''}: a chat cannot move to another flow.` : 'Switch flow or chat (⌘K). This chat works on the whole project: a chat cannot move to a flow.');

  const show = () => setOpen(chip.current?.getBoundingClientRect() ?? new DOMRect(16, 48, 0, 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd only: Ctrl+K deletes to the end of the line in a macOS text field.
      if (!e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return;
      // The dev terminal clears on ⌘K, and the Figma tab passes keys to Figma.
      const at = document.activeElement;
      if (at?.closest('.xterm, .browser-pane')) return;
      e.preventDefault();
      if (open) setOpen(null);
      else if (!document.querySelector('.overlay')) show();
    };
    const onCommand = (e: Event) => { if ((e as CustomEvent<{ id: string }>).detail.id === SWITCH_COMMAND) show(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('designstudio:command', onCommand);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('designstudio:command', onCommand);
    };
  }, [open]);

  const tree = useMemo(() => buildTree(live, saved, projects), [live, saved, projects]);
  const flows = new Map<string, TreeProject['flows'][number]['flow']>();
  // The open chat's project; a chat with no project lists every project.
  const shown = place ? tree.projects.filter((p) => p.cwd === place.summary.cwd) : tree.projects;
  const items = shown.flatMap((p) => projectItems(p, projects.find((x) => x.cwd === p.cwd)?.project ?? null, flows));

  const pick = (v: string) => {
    setOpen(null);
    const [kind, a, slug, id] = v.split('|');
    if (kind === 'live') { setUi({ selection: null }); if (a !== viewing) send({ type: 'view', id: a }); return; }
    if (kind === 'saved') { setUi({ selection: null }); send({ type: 'open_session', sessionId: a }); return; }
    if (!slug) { send({ type: 'new_session', cwd: a }); return; }
    const project = projects.find((p) => p.cwd === a)?.project;
    const flow = flows.get(`${a}|${slug}`);
    const it = project && (project.iterations.find((x) => x.id === id) ?? defaultIteration(iterationsFor(project, slug)));
    if (!flow || !it) return;
    const go = async () => {
      try {
        const warn = await startFlowChat(a, flow, it);
        if (warn) notice(warn);
      } catch (e) {
        notice(`${flow.name} was not added to ${vId(it.id)}: ${(e as Error).message}`);
      }
    };
    if (!needsCopy(it, slug)) return void go();
    // After the switcher has given focus back to the chip, so the confirm keeps it.
    requestAnimationFrame(() => requestAnimationFrame(() => setAsk({
      title: `Add ${flow.name} to ${vId(it.id)}?`, detail: `This copies its entry screens into a new ${flow.name} subsection of ${vId(it.id)}, about 20 seconds, then starts the chat there.`, action: 'Add and start chat', icon: 'add', safe: true,
      run: go,
    })));
  };

  return (
    <>
      {place && (
        <button ref={(el) => { chip.current = el; tip.props.ref(el); }} type="button" className={`place-chip${frozen ? ' frozen' : ''}`} aria-haspopup="dialog" aria-expanded={Boolean(open)} aria-keyshortcuts="Meta+K"
          aria-describedby={tip.open ? tip.id : undefined} onClick={show}
          onMouseEnter={tip.props.onMouseEnter} onMouseLeave={tip.props.onMouseLeave} onFocus={tip.props.onFocus} onBlur={tip.props.onBlur} onPointerDown={tip.props.onPointerDown}>
          <Icon name={place.flow ? 'git-branch' : 'file-media'} small />
          <span className="place-text">{text}</span>
          {frozen && <span className="place-frozen"><span className="state-dot frozen" aria-hidden /> Frozen</span>}
          <Icon name="chevron-down" small />
        </button>
      )}
      {tip.tip}
      {open && <QuickPick title="Switch flow or chat" className="place-pick" width={400} anchor={open} items={items} current={`live|${viewing}`} onPick={pick} onClose={() => setOpen(null)} />}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </>
  );
}

export type { Place };
