import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const key = (view: string, id: string) => `designstudio.section.${view}.${id}`;
const read = (view: string, id: string) => {
  try {
    return localStorage.getItem(key(view, id)) === '1';
  } catch {
    return false;
  }
};

export const openSection = (view: string, section: string) => {
  try {
    localStorage.setItem(key(view, section), '1');
  } catch {}
  window.dispatchEvent(new CustomEvent('designstudio:section', { detail: { view, section } }));
};

export function Section({ view, id, title, children }: { view: string; id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => read(view, id));
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ view: string; section: string }>).detail;
      if (d.view === view && d.section === id) setOpen(true);
    };
    window.addEventListener('designstudio:section', on);
    return () => window.removeEventListener('designstudio:section', on);
  }, [view, id]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key(view, id), next ? '1' : '0');
    } catch {}
  };
  return (
    <section className="side-section">
      <button className="page-row" onClick={toggle}><Icon name={open ? 'chevron-down' : 'chevron-right'} small /> {title}</button>
      {open && children}
    </section>
  );
}
