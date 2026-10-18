import { useEffect, useState } from 'react';
import { getJson, getState, postJson, send } from './store';
import { insertPrompt } from './panes/Files';
import { RECIPES, recipePrompt, toRecipe, type CustomRecipe, type Recipe } from '../../shared/recipes';
import { figmaNodeUrl } from '../../shared/design';
import { getOutline } from './outline';

async function selectedFrames() {
  const { figma } = getState().session;
  const focus = getState().ui.focus;
  if (!figma || !focus) return null;
  const outline = await getOutline(figma.key).catch(() => null);
  const name = outline?.pages.flatMap((p) => p.frames).find((f) => f.id === focus)?.name;
  return `${name ?? focus} (${figmaNodeUrl(figma.key, focus)})`;
}

export async function recipeText(recipe: Recipe) {
  const frames = recipe.needsFrames ? await selectedFrames() : null;
  if (recipe.id === 'brief') send({ type: 'set_flow', patch: { mode: 'design' } });
  return recipePrompt(recipe, frames).trimEnd();
}

export async function runRecipe(recipe: Recipe) {
  const text = await recipeText(recipe);
  window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'tab:chat' } }));
  insertPrompt(text);
}

let custom: CustomRecipe[] = [];

const publish = (list: CustomRecipe[]) => {
  custom = list;
  window.dispatchEvent(new Event('designstudio:recipes'));
};

export const loadCustomRecipes = () => getJson<CustomRecipe[]>('/api/recipes').then(publish).catch(() => {});
export const getCustomRecipes = () => custom;
export const saveCustomRecipes = (list: CustomRecipe[]) => postJson<CustomRecipe[]>('/api/recipes', list).then(publish);

export function useCustomRecipes() {
  const [list, setList] = useState(custom);
  useEffect(() => {
    const sync = () => setList(custom);
    window.addEventListener('designstudio:recipes', sync);
    void loadCustomRecipes();
    return () => window.removeEventListener('designstudio:recipes', sync);
  }, []);
  return list;
}

export const runRecipeById = (id: string) => {
  const r = RECIPES.find((x) => x.id === id) ?? custom.map(toRecipe).find((x) => x.id === id);
  if (r) void runRecipe(r);
};
