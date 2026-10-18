export function touchedIds(...texts: string[]): string[] {
  const ids = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(?<![\w:.-])(\d+:\d+)(?![\w:.-])/g)) ids.add(m[1]);
  return [...ids];
}
