export type ModelOption = { value: string; displayName: string; description?: string };

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** The model family in an id or alias ("claude-opus-5-5[1m]" -> "opus"). */
export function family(id: string | null | undefined): string | null {
  const s = (id ?? '').toLowerCase();
  return FAMILIES.find((f) => s.includes(f)) ?? null;
}

/** Which option the current model is: exact value first, then the same family. */
export function currentOption(model: string | null, options: ModelOption[]): ModelOption | null {
  if (!model) return options.find((o) => o.value === 'default') ?? null;
  const exact = options.find((o) => o.value === model);
  if (exact) return exact;
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
