import { useEffect, useRef, useState } from 'react';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { focusChecked, menuKeys } from '../press';
import { usePopAbove } from './abovePop';
import { currentOption, modelLabel, pickerOptions } from '../../../shared/models';

/** Composer pill that switches the model for the next chat turn. */
export function ModelPicker() {
  const model = useStore((s) => s.session.model);
  const models = useStore((s) => s.session.models);
  const running = useStore((s) => s.session.running);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const popStyle = usePopAbove(open, box);

  useEffect(() => {
    if (!open) return;
    focusChecked(box.current?.querySelector('[role="menu"]') ?? null);
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLButtonElement>('.cp-pill')?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  if (!models.length) return null;
  const current = currentOption(model, models);
  const label = modelLabel(model, models);
  const pick = (value: string) => {
    if (value !== current?.value) send({ type: 'set_model', model: value });
    setOpen(false);
  };

  return (
    <div className="cp-mode cp-model" ref={box}>
      <button
        className="cp-pill"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Model: ${label}`}
        title={running ? 'Model: switches after this turn' : 'Model for the next message'}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span><Icon name="chevron-down" small />
      </button>
      {open && (
        <div className="cp-modepop" style={popStyle} role="menu" aria-label="Model" onKeyDown={menuKeys}>
          {pickerOptions(model, models).map((m) => (
            <button key={m.value} role="menuitemradio" aria-checked={m.value === current?.value} className={m.value === current?.value ? 'active' : ''} onClick={() => pick(m.value)}>
              <Icon name={m.value === current?.value ? 'check' : 'blank'} small />
              <span className="cp-modetext"><b>{m.displayName}</b>{m.description && <span>{m.description}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
