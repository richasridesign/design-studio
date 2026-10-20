import { useEffect, useId, useMemo, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { IconButton, useTip } from '../Tip';
import { FoldButton, FoldLine, useFold } from '../Fold';
import { ago } from '../ago';
import { Markdown } from './Chat';
import { focusComposer, insertPrompt } from './composerEvents';
import { runningText } from '../StatusBar';
import { optionLetter, sketchText, type BrainstormOption, type BrainstormRound, type FlowStep, type Sketch } from '../../../shared/brainstorm';
import '../brainstorm.css';

// The Brainstorm view: Claude's rounds, newest first and open, earlier ones folded below. Each round has the problem
// and its assumptions, 2 or 3 options with a grey-box sketch, the flow, and questions with answers she can click.

/** An answer chip's message: the question with her answer, so Claude knows which question it answers. */
export const answerText = (question: string, answer: string) => (/[?:.]$/.test(question.trim()) ? `${question.trim()} ${answer}` : `${question.trim()}: ${answer}`);

const START = [
  { label: 'Describe the problem', text: 'The problem: ' },
  { label: 'Start from a frame: paste its link' },
  { label: 'Ask for 3 options', text: 'Give me 3 options for: ' },
];

export function Brainstorm({ onBuilt }: { onBuilt: () => void }) {
  const rounds = useStore((s) => s.brainstorm ?? []);
  const on = useStore((s) => Boolean(s.session.brainstorm));
  const running = useStore((s) => s.session.running);
  const status = useStore((s) => s.status);
  const events = useStore((s) => s.events);
  const sent = useMemo(() => new Set(events.flatMap((e) => (e.kind === 'user' ? [e.text.trim()] : []))), [events]);
  // Claude's reply to her last message, short in Brainstorm mode; the round itself is below it.
  const reply = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'user') return null;
      if (e.kind === 'assistant' && e.text.trim()) return e.text;
    }
    return null;
  }, [events]);
  const newestFirst = [...rounds].reverse();

  return (
    <div className="tr brainstorm">
      {running && (
        <div className="tr-working">
          <span className="tr-mark"><Icon name="loading" small spin /></span>
          <span className="tr-text">{runningText(status)}</span>
        </div>
      )}
      {!running && reply && rounds.length > 0 && <div className="bs-reply"><Markdown text={reply} /></div>}
      {rounds.length === 0 && <Empty on={on} />}
      {rounds.length > 0 && !on && (
        <p className="bs-note">
          Building now. The brainstorm rounds stay here.{' '}
          <button className="link" onClick={() => send({ type: 'set_brainstorm', on: true })}>Brainstorm again</button>
        </p>
      )}
      {newestFirst.map((r, i) => <Round key={r.n} r={r} newest={i === 0} sent={sent} running={running} onBuilt={onBuilt} />)}
    </div>
  );
}

function Empty({ on }: { on: boolean }) {
  return (
    <div className="tl-welcome bs-empty">
      <h2>Brainstorm first</h2>
      <p>
        {on
          ? 'Talk the idea through: Claude answers with options, rough sketches, the flow and questions. Claude reads Figma here but does not change it.'
          : 'Talk an idea through before building: options, rough sketches, the flow and questions. While brainstorming, Claude reads Figma but does not change it.'}
      </p>
      {on ? (
        <>
          <div className="tl-suggest-label" id="bs-start-label">Start with</div>
          <ul className="tl-suggest" aria-labelledby="bs-start-label">
            {START.map((c) => (
              <li key={c.label}>
                <button title={c.text ? 'Put the start of this prompt in the message box' : 'Go to the message box to paste a frame link'} onClick={() => (c.text ? insertPrompt(c.text) : focusComposer())}>
                  <span>{c.label}</span>
                  <Icon name="arrow-right" small />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="bs-empty-acts"><button className="bs-secondary" onClick={() => send({ type: 'set_brainstorm', on: true })}>Start brainstorming</button></div>
      )}
    </div>
  );
}

function Round({ r, newest, sent, running, onBuilt }: { r: BrainstormRound; newest: boolean; sent: Set<string>; running: boolean; onBuilt: () => void }) {
  const [open, setOpen] = useState(newest);
  // A newer round folds this one; she can open it again.
  useEffect(() => { if (!newest) setOpen(false); }, [newest]);
  const fold = useFold(open, setOpen);
  const head = useId();
  if (!open) {
    return <FoldLine ref={fold.control} controls={fold.bodyId} onClick={fold.toggle} className="bs-fold">Round {r.n} · {r.problem}</FoldLine>;
  }
  return (
    <section className="bs-round" aria-labelledby={head}>
      <header className="bs-round-head">
        <h3 id={head}>Round {r.n}</h3>
        <span className="bs-when" title={new Date(r.at).toLocaleString()}>{ago(r.at)}</span>
        <FoldButton ref={fold.control} controls={fold.bodyId} describedBy={head} onClick={fold.toggle} />
      </header>
      <div className="bs-body" id={fold.bodyId}>
        <p className="bs-problem"><span className="bs-k">Problem:</span> {r.problem}</p>
        {r.assumptions.length > 0 && (
          <div className="bs-part">
            <h4>Assumptions</h4>
            <ul className="bs-assume">
              {r.assumptions.map((a) => (
                <li key={a}>
                  <span className="bs-assume-text">{a}</span>
                  <IconButton label={`Correct: ${a}`} tip="Correct this" place="top" className="icon-btn bs-correct" onClick={() => insertPrompt(`Correction to "${a}": `)}>
                    <Icon name="edit" small />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="bs-part">
          <h4>Options</h4>
          <ul className="bs-options">
            {r.options.map((o, i) => <OptionCard key={i} o={o} i={i} r={r} running={running} onBuilt={onBuilt} />)}
          </ul>
        </div>
        {r.flow.length > 0 && (
          <div className="bs-part">
            <h4>Flow</h4>
            <FlowMap steps={r.flow} />
          </div>
        )}
        {r.questions.length > 0 && (
          <div className="bs-part">
            <h4>Questions</h4>
            <ol className="bs-questions">
              {r.questions.map((q) => (
                <li key={q.text}>
                  <p className="bs-q">{q.text}</p>
                  <div className="bs-answers" role="group" aria-label={q.text}>
                    {q.answers.map((a) => {
                      const text = answerText(q.text, a);
                      const done = sent.has(text);
                      return (
                        <button key={a} className={`bs-answer${done ? ' sent' : ''}`} aria-pressed={done} title={done ? 'Sent' : 'Send this answer'} onClick={() => send({ type: 'prompt', text })}>
                          {done && <Icon name="check" small />}{a}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function OptionCard({ o, i, r, running, onBuilt }: { o: BrainstormOption; i: number; r: BrainstormRound; running: boolean; onBuilt: () => void }) {
  const letter = optionLetter(i);
  const chosen = r.chosen?.option === i;
  const wait = useTip('Wait for Claude to finish this turn', 'top');
  const build = () => {
    if (running) return;
    send({ type: 'brainstorm_build', round: r.n, option: i });
    onBuilt();
  };
  return (
    <li className={`bs-option${chosen ? ' chosen' : ''}`}>
      <div className="bs-option-head">
        <h5><span className="bs-letter">{letter}</span> {o.title}</h5>
        {chosen && <span className="bs-chosen"><Icon name="check" small />Built</span>}
      </div>
      <SketchView s={o.sketch} />
      <p><span className="bs-k">Good for:</span> {o.goodFor}</p>
      <p><span className="bs-k">Watch out:</span> {o.watchOut}</p>
      <button
        {...(running ? wait.props : {})}
        className="bs-secondary bs-build"
        aria-label={`Build this: option ${letter}, ${o.title}`}
        aria-disabled={running || undefined}
        aria-describedby={running && wait.open ? wait.id : undefined}
        onClick={build}
      >
        Build this
      </button>
      {running && wait.tip}
    </li>
  );
}

/** A grey-box wireframe: rows top to bottom, 1 to 3 boxes side by side, each a plain box with its label. */
function SketchView({ s }: { s: Sketch }) {
  return (
    <div className={`bs-sketch ${s.frame ?? 'desktop'}`} role="img" aria-label={`Sketch: ${sketchText(s)}`}>
      {s.rows.map((row, i) => (
        <div className="bs-row" key={i}>
          {row.map((b, j) => <div key={j} className={`bs-box ${b.kind}`}><span>{b.label || b.kind}</span></div>)}
        </div>
      ))}
    </div>
  );
}

/** The flow as boxes with arrows between them, wrapping. Branches are listed under it: "Step · If <when>: <to>". */
function FlowMap({ steps }: { steps: FlowStep[] }) {
  const branches = steps.flatMap((st) => (st.branches ?? []).map((b) => ({ from: st.label, ...b })));
  return (
    <>
      <ol className="bs-flow">
        {steps.map((st, i) => (
          <li key={i}>
            <span className="bs-step">{st.label}</span>
            {i < steps.length - 1 && <span className="bs-arrow" aria-hidden="true"><Icon name="arrow-right" small /></span>}
          </li>
        ))}
      </ol>
      {branches.length > 0 && (
        <ul className="bs-branches" aria-label="Branches">
          {branches.map((b, j) => <li key={j}>{b.from} · <span className="bs-k">If {b.when}:</span> {b.to}</li>)}
        </ul>
      )}
    </>
  );
}

/** The line above the composer while the chat brainstorms. */
export function BrainstormLine() {
  const on = useStore((s) => Boolean(s.session.brainstorm));
  if (!on) return null;
  return (
    <div className="bs-mode" role="status">
      <Icon name="lightbulb" small />
      <span>Brainstorming: Figma is read only</span>
      <button className="link" onClick={() => send({ type: 'set_brainstorm', on: false })}>Start building</button>
    </div>
  );
}
