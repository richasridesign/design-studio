import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { api, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { FileIcon } from './Explorer';
import '../code.css';

function lang(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') });
  if (ext === 'py') return python();
  if (ext === 'json') return json();
  if (ext === 'md') return markdown();
  if (ext === 'html') return html();
  if (ext === 'css') return css();
  return [];
}

let opened: string[] = [];
let openedChat = '';
const openedSubs = new Set<() => void>();
export function setOpened(files: string[]) {
  opened = files;
  openedSubs.forEach((l) => l());
}
export const useOpened = () => useSyncExternalStore((l) => (openedSubs.add(l), () => openedSubs.delete(l)), () => opened);

type FileData = { path: string; content: string; original: string };

function useFile(path: string | null, bump: unknown) {
  const [file, setFile] = useState<FileData | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetch(api(`/api/file?path=${encodeURIComponent(path)}`))
      .then((r) => r.json())
      .then((d: { content: string; original: string }) => {
        if (!cancelled) setFile({ path, content: d.content, original: d.original });
      });
    return () => {
      cancelled = true;
    };
  }, [path, bump]);
  return file?.path === path ? file : null;
}

function Breadcrumbs({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <div className="cd-crumbs" title={path}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="chevron-right" small />}
          <span className="cd-crumb">
            {i === parts.length - 1 && <FileIcon name={p} />}
            {p}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function Toggle({ on, icon, title, onClick }: { on?: boolean; icon: string; title: string; onClick: () => void }) {
  return (
    <button className={`cd-btn${on ? ' on' : ''}`} title={title} aria-pressed={on} onClick={onClick}>
      <Icon name={icon} small />
    </button>
  );
}

type EditorProps = { file: FileData; diff: boolean; wrap: boolean; changesOnly: boolean; viewRef: MutableRefObject<EditorView | null> };

function Editor({ file, diff, wrap, changesOnly, viewRef }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ path: string; top: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const extensions = [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.theme({}, { dark: true }),
      syntaxHighlighting(oneDarkHighlightStyle),
      lang(file.path),
      wrap ? EditorView.lineWrapping : [],
      diff ? unifiedMergeView({ original: file.original, mergeControls: false, collapseUnchanged: changesOnly ? { margin: 3, minSize: 4 } : undefined }) : [],
      EditorState.phrases.of({ '$ unchanged lines': '⋯ $ unchanged lines' }),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: file.content, extensions }), parent: host.current });
    if (scroll.current?.path === file.path) view.scrollDOM.scrollTop = scroll.current.top;
    viewRef.current = view;
    return () => {
      scroll.current = { path: file.path, top: view.scrollDOM.scrollTop };
      viewRef.current = null;
      view.destroy();
    };
  }, [file, diff, wrap, changesOnly]);

  return <div className="cd-editor" ref={host} />;
}

export function CodePane() {
  const openFile = useStore((s) => s.ui.openFile);
  const follow = useStore((s) => s.ui.follow);
  const recent = useStore((s) => s.recentFiles);
  const chat = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const [mode, setMode] = useState<'diff' | 'file'>('diff');
  const [wrap, setWrap] = useState(false);
  const [changesOnly, setChangesOnly] = useState(true);
  const viewRef = useRef<EditorView | null>(null);
  const file = useFile(openFile, recent[0] === openFile ? recent : null);

  useEffect(() => {
    const files = openedChat === chat ? opened : [...recent].reverse();
    openedChat = chat;
    setOpened(openFile && !files.includes(openFile) ? [...files, openFile] : files);
  }, [openFile, chat]);

  if (!openFile) {
    return (
      <div className="cd-pane">
        <div className="cd-empty">Open a file from the Explorer or ⌘P</div>
      </div>
    );
  }

  const canDiff = Boolean(file?.original) && file?.original !== file?.content;
  const diff = canDiff && mode === 'diff';

  const openInVsCode = () => {
    const view = viewRef.current;
    const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
    window.location.href = `vscode://file/${encodeURI(`${cwd}/${openFile}`)}:${line}`;
  };

  return (
    <div className="cd-pane">
      <div className="cd-bar">
        <Breadcrumbs path={openFile} />
        <div className="cd-actions">
          {canDiff && <Toggle on={diff} icon="diff" title="Show the change against the last commit" onClick={() => setMode(diff ? 'file' : 'diff')} />}
          {diff && <Toggle on={changesOnly} icon="fold" title="Changes only" onClick={() => setChangesOnly(!changesOnly)} />}
          <Toggle on={wrap} icon="word-wrap" title="Word wrap" onClick={() => setWrap(!wrap)} />
          <Toggle on={follow} icon="eye" title="Follow Claude's edits" onClick={() => setUi({ follow: !follow })} />
          <Toggle icon="vscode" title="Open in VS Code" onClick={openInVsCode} />
        </div>
      </div>
      {file && <Editor file={file} diff={diff} wrap={wrap} changesOnly={changesOnly} viewRef={viewRef} />}
    </div>
  );
}
