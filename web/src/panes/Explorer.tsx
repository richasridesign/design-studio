import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, setUi, useStore } from '../store';
import { setOpened, useOpened } from './CodePane';
import { Icon } from '../Icon';
import '../explorer.css';

type Entry = { name: string; dir: boolean; hidden: boolean };
type Row = Entry & { path: string; depth: number };

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
};
const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));
const ancestors = (p: string) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));

const BLUE = '#519aba';
const YELLOW = '#cbcb41';
const PURPLE = '#a074c4';
const ORANGE = '#e37933';
const GREEN = '#8dc149';
const RED = '#cc3e44';
const PINK = '#f55385';
const CYAN = '#4fc1cf';
const GRAY = '#6d8086';
const FOLDER = '#dcb67a';

type Kind = [icon: string, color: string];

const BY_NAME: Record<string, Kind> = {
  'package.json': ['json', GREEN],
  'package-lock.json': ['json', GRAY],
  'yarn.lock': ['lock', GRAY],
  'pnpm-lock.yaml': ['lock', GRAY],
  'cargo.lock': ['lock', GRAY],
  'poetry.lock': ['lock', GRAY],
  'uv.lock': ['lock', GRAY],
  'go.sum': ['lock', GRAY],
  dockerfile: ['package', BLUE],
  makefile: ['tools', GRAY],
  license: ['law', YELLOW],
  '.gitignore': ['git-commit', GRAY],
  '.gitattributes': ['git-commit', GRAY],
  '.npmrc': ['settings-gear', GRAY],
  '.nvmrc': ['settings-gear', GRAY],
  '.editorconfig': ['settings-gear', GRAY],
  '.prettierrc': ['settings-gear', GRAY],
  '.eslintrc': ['settings-gear', GRAY],
};

const BY_EXT: [RegExp, Kind][] = [
  [/^readme\.mdx?$/i, ['book', BLUE]],
  [/\.mdx?$/i, ['markdown', BLUE]],
  [/\.tsx?$/i, ['file-code', BLUE]],
  [/\.(jsx?|mjs|cjs)$/i, ['file-code', YELLOW]],
  [/\.json[c5]?$/i, ['json', YELLOW]],
  [/\.(css|scss|sass|less)$/i, ['symbol-color', PURPLE]],
  [/\.(html?|vue|svelte|astro)$/i, ['code', ORANGE]],
  [/\.py$/i, ['file-code', BLUE]],
  [/\.go$/i, ['file-code', CYAN]],
  [/\.rs$/i, ['file-code', ORANGE]],
  [/\.swift$/i, ['file-code', ORANGE]],
  [/\.kts?$/i, ['file-code', PURPLE]],
  [/\.(java|rb|c|cc|cpp|h|hpp|cs)$/i, ['file-code', RED]],
  [/\.(sh|bash|zsh|fish|bat|ps1)$/i, ['terminal', GREEN]],
  [/\.ya?ml$/i, ['settings', PURPLE]],
  [/\.(toml|ini|cfg|conf|properties)$/i, ['settings-gear', GRAY]],
  [/\.sql$/i, ['database', PINK]],
  [/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i, ['file-media', PURPLE]],
  [/\.pdf$/i, ['file-pdf', RED]],
  [/\.(zip|tar|gz|tgz|bz2|7z|rar)$/i, ['file-zip', GRAY]],
  [/\.(lock|lockb)$/i, ['lock', GRAY]],
  [/\.env(\..*)?$/i, ['settings-gear', GRAY]],
  [/\.(txt|log|csv)$/i, ['file-text', GRAY]],
  [/\.(xml|plist|graphql|gql|prisma|proto)$/i, ['code', ORANGE]],
];

function kindOf(name: string): Kind {
  const base = name.split('/').pop() ?? name;
  const named = BY_NAME[base.toLowerCase()] ?? BY_NAME[base.toLowerCase().replace(/\..*$/, '')];
  if (named) return named;
  for (const [re, kind] of BY_EXT) if (re.test(base)) return kind;
  return ['file', GRAY];
}

export function fileIcon(name: string) {
  return kindOf(name)[0];
}

export function fileColor(name: string) {
  return kindOf(name)[1];
}

export function FileIcon({ name, dir, open }: { name: string; dir?: boolean; open?: boolean }) {
  if (dir) return <Icon name={open ? 'folder-opened' : 'folder'} small color={FOLDER} />;
  return <Icon name={fileIcon(name)} small color={fileColor(name)} />;
}

export function Explorer() {
  const cwd = useStore((s) => s.session.cwd);
  return <ExplorerView key={cwd} cwd={cwd} />;
}

function ExplorerView({ cwd }: { cwd: string }) {
  const openFile = useStore((s) => s.ui.openFile);
  const recent = useStore((s) => s.recentFiles);
  const opened = useOpened();
  const [dirs, setDirs] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(load(`explorer.expanded:${cwd}`, [])));
  const [showHidden, setShowHidden] = useState<boolean>(() => load('explorer.hidden', false));
  const [editorsOpen, setEditorsOpen] = useState<boolean>(() => load('explorer.editors', true));
  const [sel, setSel] = useState<string | null>(openFile);
  const loading = useRef(new Set<string>());
  const reveal = useRef<string | null>(openFile);
  const tree = useRef<HTMLDivElement>(null);
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  useEffect(() => save(`explorer.expanded:${cwd}`, [...expanded]), [expanded]);
  useEffect(() => save('explorer.hidden', showHidden), [showHidden]);
  useEffect(() => save('explorer.editors', editorsOpen), [editorsOpen]);

  const fetchDir = (p: string) => {
    loading.current.add(p);
    fetch(api(`/api/dir?path=${encodeURIComponent(p)}`))
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list: Entry[]) => {
        loading.current.delete(p);
        setDirs((d) => ({ ...d, [p]: list }));
      });
  };
  const refresh = (paths = Object.keys(dirsRef.current)) => paths.forEach(fetchDir);

  const rows: Row[] = [];
  const missing: string[] = [];
  const walk = (p: string, depth: number) => {
    const list = dirs[p];
    if (!list) return void missing.push(p);
    for (const e of list) {
      if (e.hidden && !showHidden) continue;
      const path = p ? `${p}/${e.name}` : e.name;
      rows.push({ ...e, path, depth });
      if (e.dir && expanded.has(path)) walk(path, depth + 1);
    }
  };
  walk('', 0);

  useEffect(() => {
    if (cwd) missing.filter((p) => !loading.current.has(p)).forEach(fetchDir);
  }, [cwd, missing.join('\n')]);

  useEffect(() => {
    if (recent[0]) refresh(['', ...ancestors(recent[0])].filter((p) => dirsRef.current[p]));
  }, [recent[0]]);

  useEffect(() => {
    if (!openFile) return;
    setSel(openFile);
    reveal.current = openFile;
    setExpanded((prev) => (ancestors(openFile).every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors(openFile)])));
  }, [openFile]);

  useEffect(() => {
    if (!reveal.current) return;
    const el = tree.current?.querySelector(`[data-path="${CSS.escape(reveal.current)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      reveal.current = null;
    }
  });

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  const activate = (r: Row) => (r.dir ? toggle(r.path) : setUi({ openFile: r.path, follow: false }));
  const go = (r?: Row) => {
    if (!r) return;
    setSel(r.path);
    reveal.current = r.path;
  };

  const onKey = (e: KeyboardEvent) => {
    const i = rows.findIndex((r) => r.path === sel);
    const r = rows[i];
    const open = r?.dir && expanded.has(r.path);
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[Math.max(i - 1, 0)]);
    else if (e.key === 'ArrowRight' && r?.dir) open ? (rows[i + 1]?.depth ?? 0) > r.depth && go(rows[i + 1]) : toggle(r.path);
    else if (e.key === 'ArrowLeft' && r) open ? toggle(r.path) : go(rows.find((x) => x.path === parentOf(r.path)));
    else if (e.key === 'Enter' && r) activate(r);
    else return;
    e.preventDefault();
  };

  const close = (f: string) => {
    const i = opened.indexOf(f);
    const rest = opened.filter((x) => x !== f);
    setOpened(rest);
    if (f === openFile) setUi({ openFile: rest[Math.min(i, rest.length - 1)] ?? null, follow: false });
  };

  return (
    <div className="explorer ex">
      <button className="ex-section" onClick={() => setEditorsOpen(!editorsOpen)}>
        <Icon name={editorsOpen ? 'chevron-down' : 'chevron-right'} small />
        <span>Open Editors</span>
      </button>
      {editorsOpen && (
        <div className="ex-editors">
          {opened.map((f) => (
            <div key={f} className={`ex-row${f === openFile ? ' selected' : ''}`} title={f} onClick={() => setUi({ openFile: f, follow: false })}>
              <span className="ex-close" title="Close" onClick={(e) => { e.stopPropagation(); close(f); }}>
                <Icon name="close" small />
              </span>
              <FileIcon name={f} />
              <span className={`ex-name${recent.includes(f) ? ' changed' : ''}`}>{f.split('/').pop()}</span>
              <span className="ex-dir">{parentOf(f)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ex-head">
<span className="folder-switch"><Icon name="folder" small /><span className="folder-name">Chat files</span></span>
        <span className="ex-actions">
          <button className="icon-btn" title="Go to File (⌘P)" onClick={() => setUi({ switcherOpen: true })}>
            <Icon name="search" small />
          </button>
          <button className={`icon-btn${showHidden ? ' on' : ''}`} title={showHidden ? 'Hide ignored files' : 'Show ignored files'} onClick={() => setShowHidden(!showHidden)}>
            <Icon name={showHidden ? 'eye' : 'eye-closed'} small />
          </button>
          <button className="icon-btn" title="Refresh Explorer" onClick={() => refresh()}>
            <Icon name="refresh" small />
          </button>
          <button className="icon-btn" title="Collapse Folders in Explorer" onClick={() => setExpanded(new Set())}>
            <Icon name="collapse-all" small />
          </button>
        </span>
      </div>
      <div className="ex-tree" ref={tree} tabIndex={0} onKeyDown={onKey}>
        {rows.map((r) => {
          const open = r.dir && expanded.has(r.path);
          const changed = !r.dir && recent.includes(r.path);
          return (
            <div
              key={r.path}
              data-path={r.path}
              className={`ex-row${r.path === sel ? ' selected' : ''}${r.hidden ? ' ignored' : ''}`}
              style={{ paddingLeft: 8 + r.depth * 8 }}
              title={r.path}
              onClick={() => { setSel(r.path); activate(r); }}
            >
              <span className="ex-guides">{Array.from({ length: r.depth }, (_, k) => <span key={k} />)}</span>
              <span className="ex-twistie">
                {r.dir && <Icon name={open && !dirs[r.path] ? 'loading' : open ? 'chevron-down' : 'chevron-right'} spin={open && !dirs[r.path]} small />}
              </span>
              <FileIcon name={r.name} dir={r.dir} open={open} />
              <span className={`ex-name${changed ? ' changed' : ''}`}>{r.name}</span>
              {changed && <span className="ex-m">M</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
