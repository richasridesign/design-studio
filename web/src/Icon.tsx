import '@vscode/codicons/dist/codicon.css';

// Codicons have no paperclip or two-way arrows, so attach and Expand chat use Lucide's, drawn in the text colour at the
// codicon sizes (18px, 16px small).
const SVG: Record<string, string> = {
  paperclip: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  'maximize-2': 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  'minimize-2': 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
};

export function Icon({ name, small, spin, color }: { name: string; small?: boolean; spin?: boolean; color?: string }) {
  if (SVG[name]) {
    return (
      <svg aria-hidden className={`svg-icon icon${small ? ' small' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={color ? { color } : undefined}>
        <path d={SVG[name]} />
      </svg>
    );
  }
  return (
    <i
      aria-hidden
      className={`codicon codicon-${name} icon${small ? ' small' : ''}${spin ? ' codicon-modifier-spin' : ''}`}
      style={color ? { color } : undefined}
    />
  );
}
