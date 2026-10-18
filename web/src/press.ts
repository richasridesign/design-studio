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
