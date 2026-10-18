import { useEffect, useState } from 'react';
import { getJson, postJson, useRev, useStore } from '../store';
import { AREA_NAMES } from '../../../shared/design';
import { AWAIT_LABEL, answerPrompt, approvePrompt, nodeUrl, type AwaitItem, type AwaitState } from '../../../shared/awaiting';
import { insertPrompt, showNode } from './Files';
import { useNodeLabel } from './Triage';

const SEV: Record<AwaitItem['severity'], string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };
const DONE_MARK: Record<Exclude<AwaitState, 'open'>, string> = { approved: 'pass', rejected: 'wontfix', parked: 'parked' };

/**
 * "Awaiting your decision": findings whose fix changes something shared (a token, a main component, a feature).
 * Fix rounds leave them alone. The list lives outside the chat, so it survives across chats and files.
 * Approve only puts a prompt in the message box; nothing is sent or changed until she sends it.
 */
export function Awaiting() {
  const fileKey = useStore((s) => s.session.figma?.key);
  const reviewRev = useRev('review.json');
  // A long run report adds its questions to the list when the run ends.
  const fromRun = useStore((s) => s.session.longRun?.awaiting ?? 0);
  const [items, setItems] = useState<AwaitItem[]>([]);
  const [all, setAll] = useState(false);
  const [decided, setDecided] = useState(false);
  const [said, setSaid] = useState('');
  const label = useNodeLabel();

  useEffect(() => { getJson<AwaitItem[]>('/api/awaiting').then(setItems).catch(() => {}); }, [reviewRev, fromRun]);

  const set = async (item: AwaitItem, state: AwaitState) => {
    const next = await postJson<AwaitItem[]>('/api/awaiting', { id: item.id, state }).catch(() => null);
    if (!next) { setSaid('Could not save. Try again.'); return; }
    setItems(next);
    if (state === 'approved' && item.area === 'long_run') {
      insertPrompt(answerPrompt(item.rule));
      setSaid('The question is in the message box: write your answer, then send it.');
    } else if (state === 'approved') {
      insertPrompt(approvePrompt(item, nodeUrl(item.fileKey, item.node)));
      setSaid('Approved. The fix is in the message box: read it, then send it to start.');
    } else setSaid(state === 'open' ? `Reopened: ${item.rule}` : `${AWAIT_LABEL[state]}: ${item.rule}`);
  };

  const open = items.filter((i) => i.state === 'open').reverse();
  const here = open.filter((i) => i.fileKey === fileKey);
  const elsewhere = open.length - here.length;
  const shown = all || !fileKey ? open : here;
  const done = items.filter((i) => i.state !== 'open').reverse().slice(0, 20);
  if (!open.length && !done.length) return null;
  const asked = shown.filter((i) => i.area === 'long_run').length;

  return (
    <section className="awaiting" aria-labelledby="awaiting-h">
      <header className="aw-head">
        <h2 id="awaiting-h">Awaiting your decision <span className="aw-count">{shown.length}</span></h2>
        <p>{asked === 0 ? 'Fixing these changes something shared, so fix rounds leave them for you.'
          : asked === shown.length ? 'Questions a long run left for you while you were away.'
          : 'Fixes that change something shared, and questions a long run left for you.'}</p>
      </header>
      {shown.length > 0 && (
        <ul className="aw-list">
          {shown.map((item) => {
            const local = item.fileKey === fileKey;
            const question = item.area === 'long_run';
            return (
              <li key={item.id}>
                {question ? <span className="tri mk question">Question</span> : <span className={`sev mk ${item.severity}`}>{SEV[item.severity]}</span>}
                <div className="aw-body">
                  <div className="f-rule">{item.rule}</div>
                  {(item.fix || item.impact) && (
                    <dl>
                      {item.fix && <div><dt>Recommended:</dt> <dd>{item.fix}</dd></div>}
                      {item.impact && <div><dt>Touches:</dt> <dd>{item.impact}</dd></div>}
                    </dl>
                  )}
                  <div className="aw-foot">
                    {local
                      ? <button className="aw-approve" title={question ? 'Put this question in the message box with your answer' : undefined} onClick={() => set(item, 'approved')}>{question ? 'Answer' : 'Approve'}</button>
                      : <span className="aw-hint">{question ? 'Answer' : 'Approve'} from a chat on {item.fileName || 'that file'}.</span>}
                    <button className="triage-link" onClick={() => set(item, 'parked')}>Park</button>
                    <button className="triage-link" onClick={() => set(item, 'rejected')}>Reject</button>
                    <span className="aw-where">
                      {question ? 'Long run' : AREA_NAMES[item.area as keyof typeof AREA_NAMES] ?? 'Code scan'}
                      {item.node ? ' · ' : !local && item.fileName ? ` · ${item.fileName}` : null}
                      {!item.node ? null : local
                        ? <button className="node-chip" title="Show in Figma" onClick={() => showNode(item.node)}>{label(item.node, item.nodeName)}</button>
                        : <a className="node-chip" href={nodeUrl(item.fileKey, item.node)} target="_blank" rel="noreferrer">{item.fileName || 'Other file'}</a>}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!shown.length && open.length === 0 && <p className="aw-empty">Nothing waiting.</p>}
      {(elsewhere > 0 && fileKey) || done.length > 0 ? (
        <div className="aw-more">
          {elsewhere > 0 && fileKey && (
            <button className="triage-link" onClick={() => setAll((v) => !v)}>{all ? 'Show this file only' : `Show ${elsewhere} from other files`}</button>
          )}
          {done.length > 0 && (
            <button className="triage-link" aria-expanded={decided} onClick={() => setDecided((v) => !v)}>{decided ? 'Hide decided' : `Show decided (${done.length})`}</button>
          )}
        </div>
      ) : null}
      {decided && done.length > 0 && (
        <ul className="aw-list aw-done">
          {done.map((item) => (
            <li key={item.id}>
              <span className={`tri mk ${DONE_MARK[item.state as Exclude<AwaitState, 'open'>]}`}>{item.area === 'long_run' && item.state === 'approved' ? 'Answered' : AWAIT_LABEL[item.state]}</span>
              <div className="aw-body">
                <div className="f-rule">{item.rule}</div>
                <div className="aw-foot"><button className="triage-link" onClick={() => set(item, 'open')}>Reopen</button></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" role="status">{said}</p>
      {said && <p className="aw-said" aria-hidden="true">{said}</p>}
    </section>
  );
}
