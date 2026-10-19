import { useState } from 'react';
import { send } from '../store';
import { showNode } from './composerEvents';
import { buildBlocked, buildLabel, buildMessage, initialPick, pickBody, whyCount, whyError, type PickFields } from './pickState';
import type { OptionId, StepId, WorkflowState } from '../../../shared/workflow';
import '../workflowScratch.css';

// From scratch, Pick: the options Explore made as radios, each with a View link to it in Figma, an optional one line
// Why, and Build, which saves the pick and asks Claude for High fidelity. The pick and its reason are quoted in the
// High fidelity prompt.

type Post = (body: { action: 'pick'; id: OptionId; why?: string } | { action: 'ask'; step: StepId }) => Promise<unknown>;

export function PickCard({ state, flow, post, busy, running }: {
  state: WorkflowState;
  flow: { n: number; name: string };
  post: Post;
  /** A plan or permission card is up: Build steps back to Secondary. */
  busy?: boolean;
  /** Claude is in a turn: Build waits. */
  running?: boolean;
}) {
  const [f, setF] = useState<PickFields>(() => initialPick(state));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const options = state.options ?? [];
  const err = whyError(f.why);
  const count = whyCount(f.why);
  const blocked = buildBlocked(f, !!running);

  const build = async () => {
    if (blocked || starting) return;
    setStarting(true);
    setError('');
    try {
      await post(pickBody(f));
      await post({ action: 'ask', step: 'hifi' });
      send({ type: 'prompt', text: buildMessage(state, f.id!, flow) });
    } catch (e) {
      setError(`Could not start: ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <form className="wf-card wf-pick" aria-live="polite" onSubmit={(e) => { e.preventDefault(); void build(); }}>
      <fieldset className="wf-pick-set" disabled={starting}>
        <legend className="wf-line">Pick the option to take to high fidelity.</legend>
        <ul className="wf-opts">
          {options.map((o) => (
            <li key={o.id} className={`wf-opt ${f.id === o.id ? 'on' : ''}`}>
              <input type="radio" id={`wf-opt-${o.id}`} name="wf-pick" value={o.id} checked={f.id === o.id} onChange={() => setF({ ...f, id: o.id })} />
              <label htmlFor={`wf-opt-${o.id}`}>{o.id} · {o.name}</label>
              {o.node && <button type="button" className="link" aria-label={`View option ${o.id} in Figma`} title={`Show Option ${o.id}: ${o.name} in Figma`} onClick={() => void showNode(o.node)}>View</button>}
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="wf-why">
        <label htmlFor="wf-why">Why</label>
        <input id="wf-why" value={f.why} placeholder="Optional, one line" autoComplete="off" readOnly={starting} aria-invalid={err ? true : undefined}
          aria-describedby={err || count ? 'wf-why-help' : undefined} onChange={(e) => setF({ ...f, why: e.target.value })} />
        {(err || count) && <span id="wf-why-help" className={err ? 'error-text small' : 'muted small'}>{err || count}</span>}
      </div>
      <div className="wf-acts">
        <button type="submit" className={busy ? undefined : 'primary'} aria-disabled={!!blocked || starting || undefined} title={blocked || undefined}>{buildLabel(f, starting)}</button>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
    </form>
  );
}
