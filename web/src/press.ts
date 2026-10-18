import type React from 'react';

// Keyboard access for a clickable row part: Enter or Space acts like a click.
export const press = (fn: () => void) => ({
  role: 'button',
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn();
  },
});

// Menus: arrow keys, Home and End move focus between items (put on the role="menu" element).
export function menuKeys(e: React.KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const n = items.length;
  const next = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (!n || next < 0) return;
  e.preventDefault();
  items[next].focus();
}

// When a menu opens, focus its ticked item (or the first one).
export const focusChecked = (menu: HTMLElement | null) =>
  (menu?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
