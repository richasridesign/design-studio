import { useSyncExternalStore } from 'react';

const KEY = 'designstudio.notify';
export const canNotify = typeof Notification !== 'undefined';
const subs = new Set<() => void>();
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();

const changed = () => subs.forEach((f) => f());
const active = () => on && canNotify && Notification.permission === 'granted';

function ask() {
  if (on && canNotify && Notification.permission === 'default') Promise.resolve(Notification.requestPermission()).catch(() => {}).finally(changed);
}

globalThis.document?.addEventListener('click', ask, { capture: true, once: true });

export function toggleNotify() {
  on = !active();
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {}
  ask();
  changed();
}

export const useNotify = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), active);

export function notify(title: string, body: string, onClick: () => void) {
  if (!active() || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {}
}
