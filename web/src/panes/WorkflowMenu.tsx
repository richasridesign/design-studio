import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { focusChecked, menuKeys } from '../press';
import { Shell } from './ProjectDialogs';
import { STEP_NAME, WORKFLOW_IDS, WORKFLOW_INFO, WORKFLOW_STEPS, nothingDone, type WorkflowId, type WorkflowState } from '../../../shared/workflow';
import '../workflowScratch.css';

// The workflow switch at the left of the strip: a Ghost menu button with the workflow's name. The menu picks Review
// and update or From scratch (radio items with their one line), then Update portfolio, which opens the portfolio
// page. With nothing done yet the switch happens at once; otherwise a confirm says what stays.

type Post = (body: { action: 'switch'; workflow: WorkflowId }) => Promise<unknown>;

export const PORTFOLIO_COMMAND = 'page:portfolio';

export function switchCopy(flowName: string, iteration: string, to: WorkflowId) {
  return {
    title: `Switch ${flowName} to ${WORKFLOW_INFO[to].name}?`,
    body: `Your work in ${iteration} stays. Nothing in Figma changes. The steps start again at ${STEP_NAME[WORKFLOW_STEPS[to][0]]}.`,
  };
}

export function WorkflowMenu({ state, flowName, iteration, post, disabled }: { state: WorkflowState; flowName: string; iteration: string; post: Post; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<WorkflowId | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = WORKFLOW_INFO[state.workflow].name;

  useEffect(() => {
    if (!open) return;
    focusChecked(box.current?.querySelector('[role="menu"]') ?? null);
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const go = async (to: WorkflowId) => {
    setSwitching(true);
    setError('');
    try {
      await post({ action: 'switch', workflow: to });
      setAsk(null);
      trigger.current?.focus();
    } catch (e) {
      setError(`Could not switch: ${(e as Error).message}`);
    } finally {
      setSwitching(false);
    }
  };
  const choose = (to: WorkflowId) => {
    close();
    if (to === state.workflow) return;
    if (nothingDone(state)) void go(to);
    else { setError(''); setAsk(to); }
  };
  const portfolio = () => {
    close();
    window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: PORTFOLIO_COMMAND } }));
  };
  const copy = ask && switchCopy(flowName, iteration, ask);

  return (
    <div className="wf-menu" ref={box}>
      <button ref={trigger} type="button" className="wf-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Workflow: ${name}`} title="Change the workflow"
        disabled={disabled || switching} onClick={() => setOpen((o) => !o)}>
        <span>{switching && !ask ? 'Switching…' : name}</span><Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </button>
      {error && !ask && <span className="error-text small" role="alert">{error}</span>}
      {open && (
        <div className="wf-menu-pop" role="menu" aria-label="Workflow" onKeyDown={menuKeys}>
          {WORKFLOW_IDS.map((id) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={id === state.workflow} className={id === state.workflow ? 'active' : ''} onClick={() => choose(id)}>
              <Icon name={id === state.workflow ? 'check' : 'blank'} small />
              <span className="wf-menu-text"><b>{WORKFLOW_INFO[id].name}</b><span>{WORKFLOW_INFO[id].detail}</span></span>
            </button>
          ))}
          <div role="separator" className="wf-menu-sep" />
          <button type="button" role="menuitem" onClick={portfolio}>
            <Icon name="blank" small />
            <span className="wf-menu-text"><b>Update portfolio</b><span>Suggest portfolio updates from your finished work.</span></span>
          </button>
        </div>
      )}
      {copy && (
        <Shell title={copy.title} onClose={() => { setAsk(null); trigger.current?.focus(); }} busy={switching}>
          <div className="project-dialog-body">
            <p>{copy.body}</p>
            {error && <p className="project-dialog-note error-text" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" disabled={switching} onClick={() => { setAsk(null); trigger.current?.focus(); }}>Cancel</button>
              <button type="button" className="primary" autoFocus disabled={switching} onClick={() => void go(ask!)}>{switching ? 'Switching…' : 'Switch'}</button>
            </div>
          </div>
        </Shell>
      )}
    </div>
  );
}
