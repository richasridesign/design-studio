import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getJson, postJson } from '../store';
import { insertPrompt } from './Files';
import '../rules.css';

type R = { global: string; file: string };

const SUGGEST = 'Read design-system.md and the frames on the Design Studio page, then propose 5 to 8 short house rules I could add. Do not edit anything.';
const EXAMPLES = 'One rule per line, for example:\nNo drop shadows on cards\nUse an 8px grid\nSentence case for all labels';

function Box({ title, value, onChange, onSave, saved }: { title: string; value: string; onChange: (v: string) => void; onSave: () => void; saved: boolean }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${Math.max(el.scrollHeight + 2, 96)}px`;
  }, [value]);
  return (
    <section>
      <h3>{title}{saved && <span className="saved">Saved</span>}</h3>
      <textarea
        ref={ta}
        value={value}
        placeholder={EXAMPLES}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave(); } }}
      />
    </section>
  );
}

export function Rules() {
  const [r, setR] = useState<R | null>(null);
  const [disk, setDisk] = useState<R>({ global: '', file: '' });
  const [saved, setSaved] = useState<keyof R | null>(null);

  useEffect(() => {
    getJson<R>('/api/rules').then((x) => { setR(x); setDisk(x); }).catch(() => {});
  }, []);

  if (!r) return <p className="hint">Loading…</p>;

  const save = (key: keyof R) => async () => {
    if (r[key] === disk[key]) return;
    const next = await postJson<R>('/api/rules', { [key]: r[key] });
    setDisk(next);
    setSaved(key);
    setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000);
  };

  return (
    <div className="rules-box">
      <Box title="This file" value={r.file} onChange={(v) => setR({ ...r, file: v })} onSave={save('file')} saved={saved === 'file'} />
      <Box title="All files" value={r.global} onChange={(v) => setR({ ...r, global: v })} onSave={save('global')} saved={saved === 'global'} />
      <p className="hint">Claude follows these in every chat, from your next message. Hover one of your messages and pick Make it a rule to add one from the chat.</p>
      <button className="suggest" onClick={() => insertPrompt(SUGGEST)}>Suggest rules from my design system</button>
    </div>
  );
}
