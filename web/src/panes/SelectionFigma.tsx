import { useEffect, useState, type ReactNode } from 'react';
import { figmaNodeUrl } from '../../../shared/design';
import { getJson, setUi, useStore, type Selection } from '../store';
import { Icon } from '../Icon';
import { ago } from '../ago';
import '../figmafile.css';
import '../selection.css';

// The Figma tab for a project, flow or iteration picked in the sidebar: its screens from the file map, grouped, with
// frozen groups greyed and labelled. Thumbnails are left out: each one is a plugin read, and a click here should be free.

type Group = { key: string; title: string; state: 'working' | 'frozen'; node: string | null; items: Array<{ id: string; name: string }> };

export const selectionQuery = (s: Selection, withIteration = s.kind === 'iteration') => {
  const q = new URLSearchParams({ cwd: s.cwd });
  if (s.flow) q.set('flow', s.flow.slug);
  if (withIteration && s.iteration) q.set('iteration', s.iteration.id);
  return q.toString();
};

/** "Iteration: 1.19 · Readiness", "State: Working" and the flow, under the file name. Shared by the Figma and Review tabs. */
export function SelectionHead({ sel, link }: { sel: Selection; link?: string | null }) {
  const viewing = useStore((s) => !!s.session.id);
  const it = sel.iteration;
  const lines: ReactNode[] = [];
  if (sel.flow) lines.push(`Flow: ${sel.flow.n} · ${sel.flow.name}`);
  if (it && sel.kind === 'iteration') lines.push(`Iteration: ${it.label}`, <><span className={it.state === 'working' ? 'sel-dot' : 'sel-ring'} aria-hidden />State: {it.state === 'working' ? 'Working' : 'Frozen'}</>);
  if (it && sel.kind !== 'iteration') lines.push(`Working iteration: ${it.label}`);
  return (
    <header className="sel-head">
      <div className="ff-head">
        <h2 className="ff-name">{sel.name}</h2>
        {link !== null && <a className="link ff-open" href={link ?? sel.url} target="_blank" rel="noopener noreferrer">Open in Figma<span className="sr-only"> (opens in a new tab)</span></a>}
        {viewing && <button type="button" className="link sel-back" onClick={() => setUi({ selection: null })}>Back to the chat</button>}
      </div>
      {lines.length > 0 && (
        <p className="sel-lines">
          {lines.map((l, i) => <span key={i}>{l}</span>)}
        </p>
      )}
    </header>
  );
}

export function SelectionFigma({ sel, chrome }: { sel: Selection; chrome: ReactNode }) {
  const [data, setData] = useState<{ groups: Group[]; readAt: number | null } | null | 'error'>(null);
  const q = selectionQuery(sel);
  useEffect(() => {
    let live = true;
    setData(null);
    getJson<{ groups: Group[]; readAt: number | null }>(`/api/projects/view?${q}`).then((d) => live && setData(d), () => live && setData('error'));
    return () => { live = false; };
  }, [q]);

  // The link opens the flow subsection, or the iteration section, of what is selected.
  const node = data && data !== 'error' && sel.kind !== 'project' ? (sel.kind === 'iteration' && !sel.flow ? sel.iteration?.node : data.groups[0]?.node) : null;
  const link = node ? figmaNodeUrl(sel.key, node) : undefined;

  return (
    <div className="browser-pane ff-pane">
      <div className="ff-body">
        <SelectionHead sel={sel} link={link} />
        {data === null && <p className="ff-line" role="status">Loading screens…</p>}
        {data === 'error' && <p className="ff-line error-text" role="alert">The screens could not be read. Select the row again to retry.</p>}
        {data && data !== 'error' && (
          data.groups.length ? (
            <>
              <p className="ff-line">{data.readAt ? `Screens from the file map, read ${ago(data.readAt)}.` : 'No file map yet: screens show once Design Studio reads the file.'}</p>
              {data.groups.map((g) => <GroupList key={g.key} fileKey={sel.key} group={g} />)}
            </>
          ) : (
            <p className="ff-line">{sel.kind === 'flow' ? `${sel.flow?.name ?? 'This flow'} is in no iteration yet.` : 'No sections here yet. Start a chat to make them.'}</p>
          )
        )}
      </div>
      {chrome}
    </div>
  );
}

function GroupList({ fileKey, group }: { fileKey: string; group: Group }) {
  const frozen = group.state === 'frozen';
  return (
    <section className={`sel-group ${frozen ? 'frozen' : ''}`} aria-label={`${group.title}${frozen ? ', frozen' : ''}`}>
      <h3 className="sel-group-title">
        <span>{group.title}</span>
        <span className="sel-state">{frozen ? <><span className="sel-ring" aria-hidden />Frozen</> : <><span className="sel-dot" aria-hidden />Working</>}</span>
        <span className="sel-count">Screens: {group.items.length}</span>
      </h3>
      {group.items.length ? (
        <ul className="sel-items">
          {group.items.map((i) => (
            <li key={i.id}>
              <a className="sel-item" href={figmaNodeUrl(fileKey, i.id)} target="_blank" rel="noopener noreferrer">
                <span className="sel-item-name">{i.name}</span>
                <Icon name="link-external" small />
                <span className="sr-only"> (opens in Figma)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ff-line">No screens yet.</p>
      )}
    </section>
  );
}
