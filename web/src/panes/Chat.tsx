import { useMemo, type MouseEvent } from 'react';
import { Marked } from 'marked';
import { useStore } from '../store';
import { frameName, useOutline } from '../outline';
import { showNode } from './Files';

export { Composer } from './Composer';

let nameFor: (id: string) => string | null = () => null;

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, text, tokens }) {
      const m = /figma\.com\/(?:design|file|proto)\/\S*node-id=(\d+)[-:](\d+)/.exec(href);
      const id = m && `${m[1]}:${m[2]}`;
      const inner = id && text === href ? escapeHtml(nameFor(id) ?? id) : this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href)}"${id ? ` class="${text === href ? 'frame-chip' : ''}" data-node="${id}"` : ''} target="_blank" rel="noreferrer">${inner}</a>`;
    },
  },
});

export function renderMarkdown(text: string, names: (id: string) => string | null = () => null) {
  nameFor = names;
  return md.parse(text, { async: false }) as string;
}

function escapeHtml(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function Markdown({ text }: { text: string }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  const html = useMemo(() => renderMarkdown(text, (id) => frameName(outline, id)), [text, outline]);
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-node]');
    if (a) { e.preventDefault(); void showNode(a.getAttribute('data-node')!); }
  };
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
