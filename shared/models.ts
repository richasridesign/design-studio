export type ModelOption = { value: string; displayName: string; description?: string };

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** The model family in an id or alias ("claude-opus-5-5[1m]" -> "opus"). */
export function family(id: string | null | undefined): string | null {
  const s = (id ?? '').toLowerCase();
  return FAMILIES.find((f) => s.includes(f)) ?? null;
}

/** Which option the current model is: exact value first, then the same family. */
export function currentOption(model: string | null, options: ModelOption[]): ModelOption | null {
  if (!model) return null;
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
