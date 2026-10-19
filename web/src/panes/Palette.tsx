import { useEffect, useMemo, useRef, useState } from 'react';
import { api, send, setUi, useStore } from '../store';
import { toggleNotify } from '../notify';
import { getCustomRecipes, runRecipeById, useCustomRecipes } from '../recipes';
import { RECIPES } from '../../../shared/recipes';
import '../palette.css';

export type Command = { id: string; label: string; key?: string };
export type Match = { score: number; hits: number[] };
export type Row = { cmd: Command; hits: number[]; recent: boolean };

const KEY = 'designstudio.palette';
const MAX_ROWS = 12;

const VIEWS = [
  ['chats', 'Chats'],
  ['system', 'Design System'],
  ['rules', 'House rules'],
];
const CENTER = [['figma', 'Figma'], ['sketch', 'Sketch'], ['review', 'Review'], ['history', 'History'], ['preview', 'Preview'], ['settings', 'Settings']];

export function buildCommands(_models: { value: string; displayName: string }[] = [], custom: { id: string; title: string }[] = []): Command[] {
  return [
    ...VIEWS.map(([id, title]) => ({ id: `view:${id}`, label: `View: Show ${title}` })),
    ...CENTER.map(([id, title]) => ({ id: `page:${id}`, label: `Open: ${title}` })),
    { id: 'repo', label: 'Add project', key: '⌘O' },
    { id: 'review', label: 'Design: Review the Design' },
    { id: 'audit', label: 'Design: Audit the File' },
    { id: 'report', label: 'Export: Handoff report' },
    { id: 'system', label: 'Design: Rebuild the Design System Profile' },
    ...[...RECIPES, ...custom].map((r) => ({ id: `recipe:${r.id}`, label: `Recipe: ${r.title}` })),
    ...custom.map((r) => ({ id: `recipe-edit:${r.id}`, label: `Recipe: Edit ${r.title}` })),
    { id: 'recipe-save', label: 'Recipe: Save composer text as recipe' },
    { id: 'compact', label: 'Chat: Compact Context' },
    { id: 'stop', label: 'Chat: Stop Claude' },
    { id: 'focus', label: 'View: Toggle focus mode', key: '⌘.' },
    { id: 'notify', label: 'Preferences: Toggle Notifications' },
    { id: 'phone', label: 'Open on Phone' },
    { id: 'shortcuts', label: 'Help: Keyboard shortcuts', key: '?' },
  ];
}

const boundary = (lower: string, i: number) => i === 0 || !/[a-z0-9]/.test(lower[i - 1]);

function matchWord(lower: string, w: string): Match | null {
  let best: Match | null = null;
  for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
    const score = 100 + (boundary(lower, at) ? 50 : 0) + (at === 0 ? 20 : 0);
    if (!best || score > best.score) best = { score, hits: Array.from(w, (_, i) => at + i) };
  }
  if (best) return best;
  const hits: number[] = [];
  let score = 0;
  let at = -1;
  for (const ch of w) {
    at = lower.indexOf(ch, at + 1);
    if (at < 0) return null;
    score += 1 + (boundary(lower, at) ? 3 : 0) + (hits[hits.length - 1] === at - 1 ? 2 : 0);
    hits.push(at);
  }
  return { score, hits };
}

export function matchCommand(label: string, query: string): Match | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: [] };
  const lower = label.toLowerCase();
  const hits = new Set<number>();
  let score = 0;
  for (const w of words) {
    const m = matchWord(lower, w);
    if (!m) return null;
    score += m.score;
    m.hits.forEach((h) => hits.add(h));
  }
  return { score: score - label.length / 100, hits: [...hits].sort((a, b) => a - b) };
}

export function rankCommands(commands: Command[], query: string, recent: string[], max = MAX_ROWS): Row[] {
  const pos = new Map(recent.map((id, i) => [id, i]));
  const at = (cmd: Command) => pos.get(cmd.id) ?? Infinity;
  const rows = commands.map((cmd) => ({ cmd, m: matchCommand(cmd.label, query) })).filter((r) => r.m) as { cmd: Command; m: Match }[];
  rows.sort((a, b) => {
    const ra = at(a.cmd), rb = at(b.cmd);
    if (isFinite(ra) !== isFinite(rb)) return ra - rb;
    return b.m.score - a.m.score || (ra === rb ? 0 : ra - rb);
  });
  return rows.slice(0, max).map((r) => ({ cmd: r.cmd, hits: r.m.hits, recent: isFinite(at(r.cmd)) }));
}

export function remember(recent: string[], id: string, max = MAX_ROWS): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function perform(id: string) {
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'recipe') runRecipeById(arg);
  if (kind === 'recipe-edit') {
    const r = getCustomRecipes().find((x) => x.id === arg);
    if (r) window.dispatchEvent(new CustomEvent('designstudio:recipe-edit', { detail: r }));
  }
  if (id === 'recipe-save') {
    const text = document.querySelector<HTMLTextAreaElement>('.cp-text textarea')?.value ?? '';
    window.dispatchEvent(new CustomEvent('designstudio:recipe-new', { detail: text }));
  }
  if (id === 'compact') send({ type: 'prompt', text: '/compact' });
  else if (id === 'review') send({ type: 'prompt', text: '/review' });
  else if (id === 'audit') send({ type: 'prompt', text: '/audit' });
  else if (id === 'system') send({ type: 'prompt', text: '/system' });
  else if (id === 'report') window.open(api('/api/report'), '_blank');
  else if (id === 'stop') send({ type: 'interrupt' });
  else if (id === 'file') setUi({ switcherOpen: true });
  else if (id === 'repo') window.dispatchEvent(new Event('designstudio:attach'));
  else if (id === 'notify') toggleNotify();
  window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id } }));
}

export function Palette() {
  const models = useStore((s) => s.session.models);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recent, setRecent] = useState(loadRecent);
  const list = useRef<HTMLUListElement>(null);
  const custom = useCustomRecipes();
  const commands = useMemo(() => buildCommands(models, custom), [models, custom]);
  const rows = useMemo(() => rankCommands(commands, q, recent), [commands, q, recent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p';
      if (!combo && e.key !== 'F1') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
      setQ('');
      setIdx(0);
      setUi({ switcherOpen: false });
    };
    const onOpen = () => { setOpen(true); setQ(''); setIdx(0); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('designstudio:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('designstudio:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    list.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const close = () => setOpen(false);
  const run = (cmd: Command) => {
    const next = remember(recent, cmd.id);
    setRecent(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    close();
    perform(cmd.id);
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prefix">&gt;</span>
          <input
            autoFocus
            value={q}
            placeholder="Type a command"
            spellCheck={false}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
              else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter' && rows[idx]) run(rows[idx].cmd);
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <ul ref={list} role="listbox" aria-label="Commands">
          {rows.map((r, i) => {
            const group = i === 0 && r.recent ? 'recently used' : !r.recent && rows[i - 1]?.recent ? 'other commands' : '';
            return (
              <li key={r.cmd.id} role="option" aria-selected={i === idx} className={i === idx ? 'active' : ''} onClick={() => run(r.cmd)}>
                <span className="palette-label"><Hl text={r.cmd.label} hits={r.hits} /></span>
                {r.cmd.key && <span className="palette-key">{r.cmd.key}</span>}
                {group && <span className="palette-group">{group}</span>}
              </li>
            );
          })}
        </ul>
        {!rows.length && <div className="palette-empty">No matching commands</div>}
      </div>
    </div>
  );
}

function Hl({ text, hits }: { text: string; hits: number[] }) {
  return <>{[...text].map((c, i) => (hits.includes(i) ? <b key={i}>{c}</b> : c))}</>;
}
