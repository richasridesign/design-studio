import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import '../terminal.css';
import { Icon } from '../Icon';
import { touch } from '../touch';

type Tab = { id: string; name: string };
type Props = { chat: string; project?: string; open: boolean; onToggle: () => void };

const theme = {
  background: '#181818',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#264f78',
  selectionInactiveBackground: '#3a3d41',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

const KEYS: [label: string, seq: string, icon?: string][] = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['^C', '\x03'],
  ['^D', '\x04'],
  ['Up', '\x1b[A', 'arrow-up'],
  ['Down', '\x1b[B', 'arrow-down'],
  ['Left', '\x1b[D', 'arrow-left'],
  ['Right', '\x1b[C', 'arrow-right'],
];

export function Terminal({ chat, project, open, onToggle }: Props) {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [active, setActive] = useState('');
  const [max, setMax] = useState(false);
  const [focus, setFocus] = useState(0);
  const [gens, setGens] = useState<Record<string, number>>({});
  const clears = useRef(new Map<string, () => void>());
  const inputs = useRef(new Map<string, (d: string) => void>());
  const wasOpen = useRef(open);
  const url = (q = '') => `/api/terms?chat=${encodeURIComponent(chat)}${q}`;

  const load = async () => {
    const list: Tab[] = await fetch(url()).then((r) => r.json());
    setTabs(list);
    setActive((a) => (list.some((t) => t.id === a) ? a : (list[list.length - 1]?.id ?? '')));
    return list;
  };

  const add = async () => {
    const t: Tab = await fetch(url(), { method: 'POST' }).then((r) => r.json());
    setTabs((l) => [...(l ?? []), t]);
    setActive(t.id);
    setFocus((f) => f + 1);
  };

  const close = async (id: string) => {
    await fetch(url(`&id=${id}`), { method: 'DELETE' });
    if ((await load()).length === 0) onToggle();
  };

  const gone = async (id: string) => {
    const list = await load().catch(() => null);
    if (list?.some((t) => t.id === id)) setGens((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 }));
    else if (list?.length === 0) onToggle();
  };

  useEffect(() => {
    if (!open || !chat) return;
    if (!tabs) load().then((l) => { if (!l.length) void add(); }).catch(() => {});
    else if (!tabs.length) void add();
  }, [open, chat]);

  useEffect(() => {
    if (open && !wasOpen.current) setFocus((f) => f + 1);
    wasOpen.current = open;
  }, [open]);

  const pick = (id: string) => {
    setActive(id);
    setFocus((f) => f + 1);
  };

  return (
    <>
      <div className={`panel-head${open && max ? ' term-max' : ''}`} onClick={onToggle} title="Toggle the terminal (⌘J)">
        <Icon name="terminal" small />
        <span className="panel-title">Terminal</span>
        <span className="muted">{project}</span>
        <span className="spacer" />
        {open && tabs && (
          <span className="term-bar" onClick={(e) => e.stopPropagation()}>
            {tabs.map((t) => (
              <span key={t.id} className={`term-tab${t.id === active ? ' on' : ''}`} onClick={() => pick(t.id)} title={t.name}>
                <Icon name="terminal" small />
                <span>{t.name}</span>
                <button className="icon-btn" title="Kill terminal" onClick={(e) => { e.stopPropagation(); void close(t.id); }}><Icon name="close" small /></button>
              </span>
            ))}
            <button className="icon-btn" title="New terminal" onClick={() => void add()}><Icon name="add" small /></button>
            <button className="icon-btn" title="Clear (⌘K)" onClick={() => clears.current.get(active)?.()}><Icon name="clear-all" small /></button>
            <button className="icon-btn" title={max ? 'Restore panel size' : 'Maximize panel size'} onClick={() => setMax((m) => !m)}><Icon name={max ? 'screen-normal' : 'screen-full'} small /></button>
          </span>
        )}
        <Icon name={open ? 'chevron-down' : 'chevron-up'} small />
      </div>
      {chat && tabs && (
        <div className="panel-body" hidden={!open}>
          <div className="term-stack">
            {tabs.map((t) => (
              <Pane key={`${t.id}:${gens[t.id] ?? 0}`} id={t.id} on={t.id === active} focus={t.id === active ? focus : 0} clears={clears.current} inputs={inputs.current} onGone={() => void gone(t.id)} />
            ))}
          </div>
          <div className="term-keys mobile-only">
            {KEYS.map(([label, seq, icon]) => (
              <button key={label} title={label} onPointerDown={(e) => e.preventDefault()} onClick={() => inputs.current.get(active)?.(seq)}>
                {icon ? <Icon name={icon} small /> : label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Pane({ id, on, focus, clears, inputs, onGone }: { id: string; on: boolean; focus: number; clears: Map<string, () => void>; inputs: Map<string, (d: string) => void>; onGone: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const want = useRef(false);
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    const el = host.current!;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
    const xt = new XTerm({ fontFamily: mono || "'SF Mono', Menlo, Monaco, monospace", fontSize: 13, scrollback: 5000, cursorBlink: true, theme });
    const fit = new FitAddon();
    xt.loadAddon(fit);
    term.current = xt;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?term=${encodeURIComponent(id)}`);
    const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    const clear = () => {
      xt.clear();
      send({ t: 'c' });
    };
    clears.set(id, clear);
    inputs.set(id, (d) => send({ t: 'i', d }));
    const resize = () => {
      if (!el.offsetHeight || !el.offsetWidth) return;
      if (!xt.element) xt.open(el);
      fit.fit();
      send({ t: 'r', c: xt.cols, r: xt.rows });
      if (want.current) {
        want.current = false;
        xt.focus();
      }
    };
    xt.attachCustomKeyEventHandler((e) => {
      if (!e.metaKey || e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        clear();
      }
      return k !== 'k' && k !== 'j';
    });
    ws.onopen = resize;
    ws.onmessage = (e) => xt.write(e.data);
    ws.onclose = () => gone.current();
    xt.onData((d) => send({ t: 'i', d }));
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      ws.onclose = null;
      ws.close();
      clears.delete(id);
      inputs.delete(id);
      xt.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (!focus || touch()) return;
    const xt = term.current;
    if (xt?.element && host.current?.offsetHeight) xt.focus();
    else want.current = true;
  }, [focus]);

  return <div className={`term-host term-pane${on ? ' on' : ''}`} ref={host} />;
}
