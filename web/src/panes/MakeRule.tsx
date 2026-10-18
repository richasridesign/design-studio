import { useEffect, useRef, useState } from 'react';
import { getJson, notice, postJson } from '../store';
import { addRule, ruleDraft } from './ruleDraft';
import '../makeRule.css';

type Scope = 'file' | 'global';

/** "Make it a rule" under one of the designer's messages: edit the line, then save it for this file or all files. */
export function MakeRule({ text, hasFile }: { text: string; hasFile: boolean }) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const save = async (scope: Scope) => {
    setBusy(true);
    try {
      const now = await getJson<Record<Scope, string>>('/api/rules');
      await postJson('/api/rules', { [scope]: addRule(now[scope], rule) });
      notice(`Rule added for ${scope === 'file' ? 'this file' : 'all files'}. Claude follows it from your next message.`);
      setOpen(false);
    } catch (err) {
      notice(`Could not save the rule: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="mr-open" onClick={() => { setRule(ruleDraft(text)); setOpen(true); }}>
        Make it a rule
      </button>
    );
  }
  const first: Scope = hasFile ? 'file' : 'global';
  return (
    <div className="mr" role="group" aria-label="Make it a rule">
      <label className="mr-label" htmlFor="mr-text">Rule</label>
      <textarea
        id="mr-text"
        ref={input}
        rows={2}
        value={rule}
        onChange={(e) => setRule(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && rule.trim()) void save(first);
        }}
      />
      <div className="mr-actions">
        <button className="primary" disabled={busy || !rule.trim()} onClick={() => save(first)}>
          {hasFile ? 'Add for this file' : 'Add for all files'}
        </button>
        {hasFile && <button disabled={busy || !rule.trim()} onClick={() => save('global')}>Add for all files</button>}
        <button className="mr-cancel" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
