import { COMPACT_AT } from './protocol.js';

/** One row of the SDK's model list. resolvedModel is the id an alias runs as ('opus' -> 'claude-opus-5-5'). */
export type ModelOption = { value: string; displayName: string; description?: string; resolvedModel?: string };

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** The model family in an id or alias ("claude-opus-5-5[1m]" -> "opus"). */
export function family(id: string | null | undefined): string | null {
  const s = (id ?? '').toLowerCase();
  return FAMILIES.find((f) => s.includes(f)) ?? null;
}

/** Which option the current model is: exact value first, then the alias that runs as it, then the same family. */
export function currentOption(model: string | null, options: ModelOption[]): ModelOption | null {
  if (!model) return options.find((o) => o.value === 'default') ?? null;
  const exact = options.find((o) => o.value === model);
  if (exact) return exact;
  // The SDK reports the id a turn ran on ("claude-opus-5-5"): the alias row that runs as it, never "default".
  const bare = model.replace(/\[1m\]$/i, '');
  const runsAs = options.find((o) => o.value !== 'default' && o.resolvedModel && o.resolvedModel.replace(/\[1m\]$/i, '') === bare);
  if (runsAs) return runsAs;
  const fam = family(model);
  const famOf = (o: ModelOption) => family(o.value) ?? family(o.displayName) ?? family(o.description);
  return (fam && options.find((o) => famOf(o) === fam)) || null;
}

/** Short label for the composer pill: "Opus", "Sonnet", or the SDK's own name. */
export function modelLabel(model: string | null, options: ModelOption[]): string {
  const opt = currentOption(model, options);
  const fam = family(model) ?? family(opt?.displayName) ?? family(opt?.description);
  if (fam) return fam[0].toUpperCase() + fam.slice(1);
  return opt?.displayName ?? 'Model';
}

/** The menu: the SDK's short aliases (default, opus, sonnet...), plus the current model if it is a pinned id. */
export function pickerOptions(model: string | null, options: ModelOption[]): ModelOption[] {
  const aliases = options.filter((o) => !o.value.startsWith('claude-'));
  const list = aliases.length ? aliases : options;
  const cur = currentOption(model, options);
  return cur && !list.includes(cur) ? [...list, cur] : list;
}

/** The context window of a model: 1M tokens for "[1m]" ids and aliases, 200k otherwise. */
export const contextWindow = (model: string | null | undefined) => (/\[1m\]/i.test(model ?? '') ? 1_000_000 : 200_000);

/** Design Studio compacts a chat at this share of its window, never below COMPACT_AT (200k). */
export const COMPACT_SHARE = 0.5;
/** Where a chat compacts: 200k on a 200k window, as before, and 500k on a 1M window. The meter's tooltip says the same. */
export const compactAt = (model: string | null | undefined) => Math.max(COMPACT_AT, Math.round(contextWindow(model) * COMPACT_SHARE));

/** Share of the window the last turn filled, 0 to 100, or null before the first turn. */
export const contextPercent = (context: number | null, model: string | null | undefined) =>
  context === null ? null : Math.min(100, Math.round((context / contextWindow(model)) * 100));
