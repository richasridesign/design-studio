import type { ReactNode } from 'react';

type Act = { label: string; onClick: () => void };

export function Empty({ art, title, text, action, secondary }: { art: ReactNode; title: string; text: string; action?: Act; secondary?: Act }) {
  return (
    <div className="empty">
      <div className="empty-art">{art}</div>
      <h2 className="empty-heading">{title}</h2>
      <p className="empty-text">{text}</p>
      {(action || secondary) && (
        <div className="empty-actions">
          {action && <button className="primary" onClick={action.onClick}>{action.label}</button>}
          {secondary && <button className="ghost" onClick={secondary.onClick}>{secondary.label}</button>}
        </div>
      )}
    </div>
  );
}

const line = { fill: 'none', stroke: 'var(--fg-faint)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const accent = { fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const blue = { ...accent, stroke: 'var(--figma)' } as const;

export function SketchArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <path {...line} d="M14 28 L56 26 L58 62 L16 64 Z" />
      <path {...line} d="M64 40 L104 42 L102 76 L66 74 Z" />
      <path {...line} d="M16 90 q8 -12 16 0 t16 0 t16 0" />
      <path {...accent} d="M84 108 L106 62 L114 66 L92 112 L82 114 Z" />
    </svg>
  );
}

export function ReviewArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <rect {...line} x="18" y="18" width="84" height="84" rx="8" />
      <path {...line} d="M30 40 H62 M30 54 H50" />
      <circle {...line} cx="82" cy="72" r="3" />
      <circle {...line} cx="40" cy="82" r="3" />
      <circle {...accent} cx="92" cy="30" r="16" fill="var(--bg)" />
      <path {...accent} d="M84 30 L90 36 L100 24" />
    </svg>
  );
}

export function SystemArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <rect {...line} x="14" y="76" width="64" height="20" rx="5" />
      <rect {...line} x="14" y="50" width="64" height="20" rx="5" />
      <rect {...accent} x="14" y="24" width="64" height="20" rx="5" />
      <text x="84" y="84" fill="var(--fg-faint)" fontFamily="var(--serif)" fontSize="30" fontWeight="600">Aa</text>
    </svg>
  );
}

export function FilesArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <rect {...line} x="26" y="26" width="68" height="68" rx="2" />
      <path {...line} d="M40 48 H80 M40 62 H66" />
      {[[26, 26], [94, 26], [26, 94], [94, 94]].map(([x, y]) => (
        <rect key={`${x}-${y}`} {...blue} fill="var(--bg)" x={x - 5} y={y - 5} width="10" height="10" rx="2" />
      ))}
    </svg>
  );
}

export function BrowserArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <rect {...line} x="12" y="22" width="96" height="76" rx="8" />
      <path {...line} d="M12 40 H108" />
      <circle {...line} cx="23" cy="31" r="2" />
      <circle {...line} cx="32" cy="31" r="2" />
      <rect {...blue} x="30" y="52" width="48" height="34" rx="3" />
    </svg>
  );
}

export function PrototypeArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <rect {...line} x="34" y="12" width="52" height="96" rx="9" />
      <path {...line} d="M54 20 H66" />
      <path {...accent} d="M54 50 L72 62 L54 74 Z" />
    </svg>
  );
}
