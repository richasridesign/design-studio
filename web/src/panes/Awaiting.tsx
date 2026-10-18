import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, useRev, useStore } from '../store';
import { AREA_NAMES, figmaNodeUrl } from '../../../shared/design';
import { AWAIT_LABEL, answerPrompt, approvePrompt, sentKey, startsWithPrompt, type AwaitItem, type AwaitState } from '../../../shared/awaiting';
import { insertPrompt, showNode } from './composerEvents';
import { useNodeLabel } from './Triage';
import { useTip } from '../Tip';
import { AWAITING_SENT, forgetInserted, noteInserted, useDraft, type SentDetail } from './awaitingSent';

const SEV: Record<AwaitItem['severity'], string> = { blocking: 'Blocking', major: 'Major', minor: 'Minor' };
const DONE_MARK: Record<Exclude<AwaitState, 'open'>, string> = { approved: 'pass', rejected: 'wontfix', parked: 'parked' };

/** The list for the Review tab: the Awaiting section and the line under each finding read the same copy. */
export function useAwaitingList() {
  const reviewRev = useRev('review.json');
  // A long run report adds its questions to the list when the run ends.
  const fromRun = useStore((s) => s.session.longRun?.awaiting ?? 0);
  const [items, setItems] = useState<AwaitItem[] | null>(null);
  useEffect(() => { getJson<AwaitItem[]>('/api/awaiting').then(setItems).catch(() => {}); }, [reviewRev, fromRun]);
  // A sent Approve or Answer prompt is marked in the message box (awaitingSent.ts), so the list takes the saved one.
  useEffect(() => {
    const onSent = (e: Event) => { const list = (e as CustomEvent<SentDetail>).detail.list; if (list) setItems(list); };
    window.addEventListener(AWAITING_SENT, onSent);
    return () => window.removeEventListener(AWAITING_SENT, onSent);
  }, []);
  return [items, setItems] as const;
}

function ApproveButton({ question, blocked, onClick }: { question: boolean; blocked: boolean; onClick: () => void }) {
  // While Claude waits on a plan or question card, a sent message would answer that card instead, so it waits.
  // aria-disabled, not disabled: a disabled button gets no hover or focus, and the tip says why it waits.
  const t = useTip(blocked ? "Answer Claude's card first"
    : question ? 'Puts the question in the message box. It counts as answered when you send your answer.' : 'Puts the fix in the message box. It counts as approved when you send it.');
  return (
    <>
      <button {...t.props} className="aw-approve" aria-disabled={blocked || undefined} aria-describedby={t.open ? t.id : undefined} onClick={() => { if (!blocked) onClick(); }}>{question ? 'Answer' : 'Approve'}</button>
      {t.tip}
    </>
  );
}

/**
 * "Awaiting your decision": findings whose fix changes something shared (a token, a main component, a feature).
 * Fix rounds leave them alone. The list lives outside the chat, so it survives across chats and files.
 * Approve only puts a prompt in the message box; the item is approved when she sends it.
 */
export function Awaiting({ items, onItems }: { items: AwaitItem[]; onItems: (list: AwaitItem[]) => void }) {
  const fileKey = useStore((s) => s.session.figma?.key);
  const [all, setAll] = useState(false);
  const [decided, setDecided] = useState(false);
  const [said, setSaid] = useState('');
  // The prompt the "is in the message box" line is about. The line goes once that prompt leaves the box.
  const [inBox, setInBox] = useState<string | null>(null);
  const draft = useDraft();
  const held = inBox !== null && startsWithPrompt(inBox, draft);
  const wasHeld = useRef(false);
  useEffect(() => {
    if (inBox !== null && wasHeld.current && !held) { setSaid(''); setInBox(null); }
    wasHeld.current = held;
  }, [held, inBox]);
  const blocked = useStore((s) => s.pending.length > 0);
  const label = useNodeLabel();
  useEffect(() => {
    const onSent = (e: Event) => {
      const { items: sent, failed } = (e as CustomEvent<SentDetail>).detail;
      setInBox(null);
      setSaid(failed ? 'Sent, but could not mark it approved. Try again.' : sent.map((x) => `${x.question ? 'Answered' : 'Approved'}: ${x.rule}`).join(' '));
    };
    window.addEventListener(AWAITING_SENT, onSent);
    return () => window.removeEventListener(AWAITING_SENT, onSent);
  }, []);

  const save = async (item: AwaitItem, state: AwaitState) => {
    const next = await postJson<AwaitItem[]>('/api/awaiting', { id: item.id, state }).catch(() => null);
    if (next) onItems(next);
    return !!next;
  };
  const set = async (item: AwaitItem, state: AwaitState) => {
    forgetInserted([item.id]);
    setInBox(null);
    if (!(await save(item, state))) return setSaid('Could not save. Try again.');
    setSaid(state === 'open' ? `Reopened: ${item.rule}` : `${AWAIT_LABEL[state]}: ${item.rule}`);
  };
  const approve = (item: AwaitItem) => {
    noteInserted(item);
    wasHeld.current = false;
    setInBox(sentKey(item));
    if (item.area === 'long_run') {
      insertPrompt(answerPrompt(item.rule));
      setSaid('The question is in the message box. Write your answer and send it: then it counts as answered.');
    } else {
      insertPrompt(approvePrompt(item, figmaNodeUrl(item.fileKey, item.node)));
      setSaid('The fix is in the message box. Read it and send it: then it counts as approved.');
    }
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
                      ? <ApproveButton question={question} blocked={blocked} onClick={() => approve(item)} />
                      : <span className="aw-hint">{question ? 'Answer' : 'Approve'} from a chat on {item.fileName || 'that file'}.</span>}
                    <button className="triage-link" onClick={() => set(item, 'parked')}>Park</button>
                    <button className="triage-link" onClick={() => set(item, 'rejected')}>Reject</button>
                    <span className="aw-where">
                      {question ? 'Long run' : AREA_NAMES[item.area as keyof typeof AREA_NAMES] ?? 'Code scan'}
                      {item.node ? ' · ' : !local && item.fileName ? ` · ${item.fileName}` : null}
                      {!item.node ? null : local
                        ? <button className="node-chip" title="Show in Figma" onClick={() => showNode(item.node)}>{label(item.node, item.nodeName)}</button>
                        : <a className="node-chip" href={figmaNodeUrl(item.fileKey, item.node)} target="_blank" rel="noreferrer">{item.fileName || 'Other file'}</a>}
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
