import { useSyncExternalStore } from 'react';

// Theme preference: stored per browser, applied as data-theme on <html>.
// index.html runs the same logic inline before first paint, so keep the key and colours in sync.
export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'designstudio.theme';
export const THEME_PREFS: ThemePref[] = ['dark', 'light', 'system'];
export const THEME_LABEL: Record<ThemePref, string> = { dark: 'Dark', light: 'Light', system: 'System' };
const BG: Record<Theme, string> = { dark: '#141414', light: '#ffffff' };
const EVENT = 'designstudio:theme';

const hasWindow = typeof window !== 'undefined';

export function getThemePref(): ThemePref {
  try {
    const v = hasWindow ? localStorage.getItem(THEME_KEY) : null;
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function systemTheme(): Theme {
  return hasWindow && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(pref: ThemePref = getThemePref()): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[theme]);
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode or blocked storage: still apply for this page.
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

export function nextThemePref(pref: ThemePref): ThemePref {
  return THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
}

// Call once at startup: follows the OS setting while the preference is System.
export function initTheme() {
  if (!hasWindow) return;
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'system') {
      applyTheme('system');
      window.dispatchEvent(new Event(EVENT));
    }
  });
  window.addEventListener('storage', (e) => e.key === THEME_KEY && applyTheme());
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, () => 'dark');
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => resolveTheme(), () => 'dark');
}
