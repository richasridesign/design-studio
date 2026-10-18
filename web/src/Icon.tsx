import '@vscode/codicons/dist/codicon.css';

export function Icon({ name, small, spin, color }: { name: string; small?: boolean; spin?: boolean; color?: string }) {
  return (
    <i
      aria-hidden
      className={`codicon codicon-${name} icon${small ? ' small' : ''}${spin ? ' codicon-modifier-spin' : ''}`}
      style={color ? { color } : undefined}
    />
  );
}
