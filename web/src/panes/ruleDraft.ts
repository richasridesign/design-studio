const LINK = /https?:\/\/(?:www\.)?figma\.com\/\S+/g;

/** A rule draft from one of the designer's messages: no links, one line, at most 200 characters. */
export function ruleDraft(text: string) {
  const line = text.replace(LINK, '').replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 199).trimEnd()}…` : line;
}

/** Appends a rule as its own line, unless the same rule is already there. */
export function addRule(rules: string, rule: string) {
  const r = rule.trim();
  if (!r) return rules;
  const lines = rules.split('\n').map((l) => l.trim());
  if (lines.some((l) => l.toLowerCase() === r.toLowerCase())) return rules;
  return rules.trim() ? `${rules.replace(/\s+$/, '')}\n${r}\n` : `${r}\n`;
}
