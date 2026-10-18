import { useEffect, useMemo, useRef, useState } from 'react';
import { api, setUi, useStore } from '../store';
import { useOpened } from './CodePane';
import { FileIcon } from './Explorer';
import { Icon } from '../Icon';
import { touch } from '../touch';

const cache = new Map<string, string[]>();

export function FileSwitcher() {
  const open = useStore((s) => s.ui.switcherOpen);
  const changed = useStore((s) => s.recentFiles);
  const openFile = useStore((s) => s.ui.openFile);
  const cwd = useStore((s) => s.session.cwd);
  const opened = useOpened();
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setIdx(0);
    setFiles(cache.get(cwd) ?? []);
    fetch(api('/api/files'))
      .then((r) => r.json())
      .then((f: string[]) => {
        cache.set(cwd, f);
        setFiles(f);
      })
      .catch(() => {});
    if (!touch()) setTimeout(() => input.current?.focus(), 0);
  }, [open, cwd]);

  const results = useMemo(() => {
    const recent = [...new Set([...(openFile ? [openFile] : []), ...[...opened].reverse(), ...changed])];
    const isRecent = new Set(recent);
    const rank = (list: string[], sort: boolean) => {
      const m = list.map((f) => ({ f, m: match(f, q) })).filter((x) => x.m) as { f: string; m: Match }[];
      return sort ? m.sort((a, b) => b.m.score - a.m.score) : m;
    };
    return [
      ...rank(recent, !!q).map((x) => ({ ...x, recent: true })),
      ...rank(files.filter((f) => !isRecent.has(f)), !!q).map((x) => ({ ...x, recent: false })),
    ].slice(0, 50);
  }, [q, files, opened, changed, openFile]);

  useEffect(() => {
    list.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const pick = (f: string) => setUi({ openFile: f, switcherOpen: false, follow: false });

  return (
    <div className="overlay" onClick={() => setUi({ switcherOpen: false })}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Search files by name"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setUi({ switcherOpen: false });
            else if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
            else if (e.key === 'Enter' && results[idx]) pick(results[idx].f);
            else return;
            e.preventDefault();
          }}
        />
        <ul ref={list}>
          {results.map(({ f, m, recent }, i) => {
            const base = f.lastIndexOf('/') + 1;
            const label = i === 0 && recent ? 'recently opened' : !recent && results[i - 1]?.recent ? 'file results' : '';
            return (
              <li key={f} className={i === idx ? 'active' : ''} onClick={() => pick(f)} title={f}>
                <FileIcon name={f} />
                <span className="fs-name"><Hl text={f.slice(base)} from={base} hits={m.hits} /></span>
                <span className="fs-dir"><Hl text={f.slice(0, Math.max(base - 1, 0))} from={0} hits={m.hits} /></span>
                {label && <span className="fs-group">{label}</span>}
              </li>
            );
          })}
        </ul>
        {!results.length && <div className="fs-empty">No matching results</div>}
      </div>
    </div>
  );
}

function Hl({ text, from, hits }: { text: string; from: number; hits: number[] }) {
  return <>{[...text].map((c, i) => (hits.includes(from + i) ? <b key={i}>{c}</b> : c))}</>;
}

type Match = { score: number; hits: number[] };

function seq(path: string, lower: string, needle: string, from: number, back: boolean): Match | null {
  const hits: number[] = [];
  let at = back ? lower.length : from - 1;
  for (let k = 0; k < needle.length; k++) {
    const ch = back ? needle[needle.length - 1 - k] : needle[k];
    at = back ? (at > from ? lower.lastIndexOf(ch, at - 1) : -1) : lower.indexOf(ch, at + 1);
    if (at < from) return null;
    hits.push(at);
  }
  if (back) hits.reverse();
  let score = 0;
  hits.forEach((h, i) => {
    const boundary = h === 0 || '/._- '.includes(path[h - 1]) || (path[h] !== lower[h] && path[h - 1] === lower[h - 1]);
    score += 1 + (hits[i - 1] === h - 1 ? 2 : 0) + (boundary ? 3 : 0);
  });
  return { score, hits };
}

export function match(path: string, q: string): Match | null {
  const needle = q.toLowerCase().replace(/\s+/g, '');
  if (!needle) return { score: 0, hits: [] };
  const lower = path.toLowerCase();
  const base = lower.lastIndexOf('/') + 1;
  const len = path.length / 100;
  const range = (s: number) => Array.from(needle, (_, i) => s + i);
  let at = lower.indexOf(needle, base);
  if (at >= 0) return { score: (at === base ? 1100 : 1000) - len, hits: range(at) };
  let m = seq(path, lower, needle, base, false);
  if (m) return { score: 600 + m.score - len, hits: m.hits };
  at = lower.lastIndexOf(needle);
  if (at >= 0) return { score: 400 - len, hits: range(at) };
  m = seq(path, lower, needle, 0, true);
  return m && { score: m.score - len, hits: m.hits };
}
