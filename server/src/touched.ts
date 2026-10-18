export function touchedIds(...texts: string[]): string[] {
  const ids = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(?<![\w:.-])(\d+:\d+)(?![\w:.-])/g)) ids.add(m[1]);
  return [...ids];
}

/**
 * The ids Claude's Figma calls touched, for the auto check, which looks at only the first few screens. Ids a call names
 * in its script come first, since a read often lists a whole section in its result. Within each kind the newest touch
 * comes first, so the screens edited last are never the ones cut off.
 */
export class TouchedIds {
  private named = new Set<string>();
  private returned = new Set<string>();

  /** `named`: ids from a call's script (or set_status nodes). Otherwise ids from a call's result. */
  add(ids: Iterable<string>, named: boolean) {
    const set = named ? this.named : this.returned;
    // Delete then add: a Set keeps first-seen order, and a touch again should count as the newest.
    for (const id of ids) { set.delete(id); set.add(id); }
  }

  ranked(): string[] {
    return [...[...this.named].reverse(), ...[...this.returned].reverse().filter((id) => !this.named.has(id))];
  }

  clear() {
    this.named.clear();
    this.returned.clear();
  }
}
