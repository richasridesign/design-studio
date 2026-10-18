import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export type ConfirmRequest = {
  title: string;
  detail: string;
  warning?: string;
  action: string;
  icon?: string;
  input?: { value: string; placeholder: string };
  run: (value: string) => Promise<unknown>;
};

export function Confirm({ title, detail, warning, action, icon, input, run, onClose }: ConfirmRequest & { onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(input?.value ?? '');
  useEffect(() => (input ? field.current?.focus() : ok.current?.focus()), []);
  const go = () => {
    if (input && !value.trim()) return;
    void run(value.trim());
    onClose();
  };

  return (
    <div className="overlay dialog-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className={`dialog-icon ${input ? 'neutral' : ''}`}><Icon name={icon ?? 'warning'} /></span>
        <div className="dialog-body">
          <div className="dialog-title">{title}</div>
          <div className="dialog-detail">{detail}</div>
          {input && (
            <input
              ref={field}
              className="dialog-input"
              value={value}
              placeholder={input.placeholder}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
          )}
          {warning && <div className="dialog-warning">{warning}</div>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button ref={ok} className={input ? 'primary' : 'destructive'} disabled={Boolean(input && !value.trim())} onClick={go}>{action}</button>
        </div>
      </div>
    </div>
  );
}
