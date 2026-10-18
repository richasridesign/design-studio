import { useState } from 'react';
import { RECIPE_GROUPS, type CustomRecipe, type RecipeGroup } from '../../../shared/recipes';
import { getCustomRecipes, saveCustomRecipes } from '../recipes';

export type Draft = { id?: string; title: string; blurb: string; prompt: string; group: RecipeGroup };

export const newDraft = (prompt = ''): Draft => ({ title: '', blurb: '', prompt, group: 'make' });

export function RecipeEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = d.title.trim() && d.prompt.trim();
  const set = (patch: Partial<Draft>) => setD((v) => ({ ...v, ...patch }));

  const commit = async (list: CustomRecipe[]) => {
    setBusy(true);
    setError('');
    try {
      await saveCustomRecipes(list);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  const save = () => {
    const list = getCustomRecipes();
    const id = d.id ?? `custom-${Date.now().toString(36)}`;
    const next = { id, title: d.title, blurb: d.blurb, prompt: d.prompt, group: d.group };
    void commit(d.id ? list.map((r) => (r.id === id ? next : r)) : [...list, next]);
  };

  return (
    <div className="nc-overlay" onClick={onClose}>
      <form className="nc-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (valid && !busy) save(); }}>
        <h2>{d.id ? 'Edit recipe' : 'New recipe'}</h2>
        <div className="dialog-label">Title</div>
        <input autoFocus maxLength={60} value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="dialog-label">Description</div>
        <input maxLength={140} placeholder="One line shown on the card" value={d.blurb} onChange={(e) => set({ blurb: e.target.value })} />
        <div className="dialog-label">Group</div>
        <select value={d.group} onChange={(e) => set({ group: e.target.value as RecipeGroup })}>
          {RECIPE_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <div className="dialog-label">Prompt</div>
        <textarea rows={10} maxLength={4000} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        <div className="hint">Use {'{frames}'} for the focused frame.</div>
        {error && <div className="error-text">{error}</div>}
        <div className="dialog-actions">
          {d.id && <button type="button" className="ghost recipe-delete" disabled={busy} onClick={() => void commit(getCustomRecipes().filter((r) => r.id !== d.id))}>Delete</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid || busy}>Save</button>
        </div>
      </form>
    </div>
  );
}
