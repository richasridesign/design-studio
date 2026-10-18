import { useEffect, useState } from 'react';
import { RecipeEditor, newDraft, type Draft } from './panes/RecipeEditor';

export function RecipeEditorHost() {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const onNew = (e: Event) => setDraft(newDraft((e as CustomEvent<string>).detail));
    const onEdit = (e: Event) => setDraft((e as CustomEvent<Draft>).detail);
    window.addEventListener('designstudio:recipe-new', onNew);
    window.addEventListener('designstudio:recipe-edit', onEdit);
    return () => {
      window.removeEventListener('designstudio:recipe-new', onNew);
      window.removeEventListener('designstudio:recipe-edit', onEdit);
    };
  }, []);
  return draft && <RecipeEditor draft={draft} onClose={() => setDraft(null)} />;
}
