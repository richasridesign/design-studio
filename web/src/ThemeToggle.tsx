import { nextThemePref, setThemePref, THEME_LABEL, THEME_PREFS, useThemePref, type ThemePref } from './theme';

// Lucide sun, moon and monitor (stroke 1.5). Codicons has no sun or moon.
const PATHS: Record<ThemePref, string> = {
  light: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  dark: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  system: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4',
};

export function ThemeIcon({ pref, size = 18 }: { pref: ThemePref; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[pref]} />
    </svg>
  );
}

// Topbar button: cycles Dark, Light, System. Hidden on phones, where Settings has the control.
export function ThemeButton() {
  const pref = useThemePref();
  const label = `Theme: ${THEME_LABEL[pref]}`;
  return (
    <button className="icon-btn desktop-only" title={`${label}. Switch to ${THEME_LABEL[nextThemePref(pref)]}`} aria-label={label} onClick={() => setThemePref(nextThemePref(pref))}>
      <ThemeIcon pref={pref} />
    </button>
  );
}

// Settings: one segmented control with all three options.
export function ThemeSegment() {
  const pref = useThemePref();
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {THEME_PREFS.map((p) => (
        <button key={p} role="radio" aria-checked={pref === p} className={pref === p ? 'on' : ''} onClick={() => setThemePref(p)}>
          <ThemeIcon pref={p} size={16} /> {THEME_LABEL[p]}
        </button>
      ))}
    </div>
  );
}
