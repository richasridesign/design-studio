export function touchedIds(...texts: string[]): string[] {
  const ids = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(?<![\w:.-])(\d+:\d+)(?![\w:.-])/g)) ids.add(m[1]);
  return [...ids];
}

/** Page and viewport calls that read scripts use all the time: they change nothing in the file. */
const NOT_EDITS = /figma\.(?:setCurrentPageAsync|loadAllPagesAsync|loadFontAsync|notify)\s*\(|figma\.currentPage\s*=(?!=)|figma\.viewport\.[\w$.]+\s*=(?!=)|\.selection\s*=(?!=)/g;
const EDITS = [
  /figma\.(?:create\w*|group|ungroup|flatten|union|subtract|intersect|exclude|combineAsVariants|importComponentByKeyAsync)\s*\(/,
  /\.(?:appendChild|insertChild|remove|clone|resize|resizeWithoutConstraints|rescale|swapComponent|createInstance|detachInstance|createComponentFromNode|setProperties|insertCharacters|deleteCharacters)\s*\(/,
  /\.set[A-Z]\w*\s*\(/,
  // A property set on a node: name = "x", fills = [...], x += 8. Not ==, ===, or an arrow.
  /\.[\w$]+\s*(?:[-+*/]?=)(?![=>])/,
];

/** True when a Figma script creates, changes or removes nodes; false for a read-only script. */
export function figmaEdits(code: string): boolean {
  const left = code.replace(NOT_EDITS, '');
  return EDITS.some((re) => re.test(left));
}

/**
 * The ids Claude's Figma calls touched, for the auto check, which looks at only the first few screens. Ids from a call
 * that created, changed or removed nodes come first, named in its script or returned in its result (a call that only
 * creates frames returns their new ids), with set_status nodes. Then a read's ids: named in its script before returned,
 * since a read often lists a whole section in its result. Within each kind the newest touch comes first, so the
 * screens edited last are never the ones cut off.
 */
export class TouchedIds {
  private edited = new Set<string>();
  private named = new Set<string>();
  private returned = new Set<string>();

  /** `edited`: any id from an edit call, or set_status nodes. `named`: ids in a read's script. `returned`: ids in a read's result. */
  add(ids: Iterable<string>, kind: 'edited' | 'named' | 'returned') {
    const set = this[kind];
    // Delete then add: a Set keeps first-seen order, and a touch again should count as the newest.
    for (const id of ids) { set.delete(id); set.add(id); }
  }

  ranked(): string[] {
    const seen = new Set<string>();
    return [this.edited, this.named, this.returned].flatMap((set) => [...set].reverse()).filter((id) => !seen.has(id) && !!seen.add(id));
  }

  clear() {
    this.edited.clear();
    this.named.clear();
    this.returned.clear();
  }
}
