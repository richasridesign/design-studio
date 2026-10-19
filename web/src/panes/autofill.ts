import { useEffect, useState } from 'react';
import { postJson } from '../store';

// Auto-fill after a Figma file is linked to a project: the server adopts the file's flows and iterations (read only,
// no dialog). The project row shows "Reading flows from Figma…" or an error with Try again, and a toast reports.

export type Autofill = { kind: 'reading' } | { kind: 'error'; text: string; file: string };

/** Same as PROJECTS_CHANGED in ProjectDialogs: the sidebar reloads its projects. */
const PROJECTS_CHANGED = 'designstudio:projects';
const EVENT = 'designstudio:autofill';
/** AttachHost shows these at the top of the page, like its own toasts. */
export const TOAST = 'designstudio:toast';
export type ToastDetail = { text: string; error?: boolean };

const state = new Map<string, Autofill>();
const emit = () => window.dispatchEvent(new Event(EVENT));
const toast = (detail: ToastDetail) => window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST, { detail }));

export function autofill(cwd: string, file: string) {
  if (state.get(cwd)?.kind === 'reading') return;
  state.set(cwd, { kind: 'reading' });
  emit();
  postJson<{ flows: number; iterations: number; file: string }>(`/api/projects/autofill?cwd=${encodeURIComponent(cwd)}`, {})
    .then((r) => {
      state.delete(cwd);
      const name = r.file || file;
      toast({ text: r.flows ? `Found ${r.flows} ${r.flows === 1 ? 'flow' : 'flows'} and ${r.iterations} ${r.iterations === 1 ? 'iteration' : 'iterations'} in ${name}.` : `${name} has no flows yet. Start one with New flow.` });
    })
    .catch((e: Error) => state.set(cwd, { kind: 'error', text: e.message.replace(/\s+/g, ' ').trim(), file }))
    .finally(() => {
      emit();
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
    });
}

export function useAutofill(): ReadonlyMap<string, Autofill> {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return state;
}
