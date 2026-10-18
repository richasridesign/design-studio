// Dictation often mishears design tool names. Fix the ones Richa says most.
const TERMS: Array<[RegExp, string]> = [
  [/\b(?:fake|fig|pic|big)\s?jam\b/gi, 'FigJam'],
  [/\bfig\s?ma\b/gi, 'Figma'],
  [/\blucid(?:e)?(?=\s+icons?\b)/gi, 'Lucide'],
  [/\b(?:double\s?u|w)\s?cag\b/gi, 'WCAG'],
  [/\bharrison\b/gi, 'Harisson'],
  [/\ba\s?o\s?p\b/gi, 'AOP'],
  [/\be\s(vals?)\b/gi, 'e$1'],
];

export function fixTerms(text: string) {
  return TERMS.reduce((t, [re, to]) => t.replace(re, to), text);
}
