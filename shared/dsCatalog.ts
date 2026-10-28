import type { DsColor, DsComponent } from './design.js';

/** The structure of a design system page, after Elastic UI (eui.elastic.co/docs) and docs/design-system-structure.md. */

/** Component categories in Elastic UI's order, plus AI and Design file for what Elastic has no home for. */
export const COMPONENT_GROUPS = ['Layout', 'Containers', 'Navigation', 'Display', 'Forms', 'Tables and lists', 'AI', 'Templates', 'Design file', 'Icons', 'Deprecated'] as const;
export type ComponentGroup = (typeof COMPONENT_GROUPS)[number];

// First match wins, so the narrow words (row, persona, menu) come before the broad ones (button, card).
const BY_WORD: [ComponentGroup, RegExp][] = [
  ['Icons', /_\d+dp_|^icon\s*\/|^(polygon|ellipse) \d+$|^triangle$/i],
  ['Design file', /flow note|decision sticky/i],
  ['AI', /message item|chat|suggestion chip|answer actions|trace|starter group|simulate|persona|test mode|preview footer/i],
  ['Display', /tooltip/i],
  ['Tables and lists', /\brow\b|table|action log|directory$/i],
  ['Forms', /input|search|toggle|chip|dropdown|access (option|menu)|segmented/i],
  ['Navigation', /button|text link|breadcrumb|nav|\btab\b|segment|header actions|menu/i],
  ['Layout', /page header|footer|section heading|^line$/i],
  ['Containers', /card|dialog|side sheet|drawer|accordion|attention item|empty state/i],
  ['Display', /tag|count|avatar|profile|logo|tile|toast|banner|tooltip|info|progress|path|tim(e)?line|connected to|who can use|highlight/i],
];

/** One lowercase word with a trailing number ("user-cog 1"), or a bare lucide name ("loader-circle", "x"), is an icon pasted into the file. */
const ICON_NAME = /^[a-z0-9-]+ \d+$|^[a-z0-9]+-[a-z0-9-]+$|^(x|menu|history)$/;

export function componentGroup(c: DsComponent): ComponentGroup {
  const name = c.name.trim();
  if (/deprecated|\(\s*old\s*\)/i.test(name)) return 'Deprecated';
  if (ICON_NAME.test(name)) return 'Icons';
  for (const [group, re] of BY_WORD) if (re.test(name)) return group;
  return 'Display';
}

export function groupComponents(list: DsComponent[]) {
  const out = new Map<ComponentGroup, DsComponent[]>(COMPONENT_GROUPS.map((g) => [g, []]));
  for (const c of list) out.get(componentGroup(c))!.push(c);
  return out;
}

/** Colour roles, Elastic style. A token named "surface/subtle" is a Surface colour; plain names ("blue light") are raw colours. */
export const COLOR_ROLES = ['Text', 'Icon', 'Surface', 'Border', 'Action', 'Status', 'Feedback', 'Focus', 'Accent', 'Chat'] as const;
export const RAW_COLORS = 'Raw colours';

export function groupColors(list: DsColor[]) {
  const out = new Map<string, DsColor[]>([...COLOR_ROLES, RAW_COLORS].map((r) => [r, []]));
  for (const c of list) {
    const head = c.name.includes('/') ? c.name.split('/')[0].trim().toLowerCase() : '';
    const role = COLOR_ROLES.find((r) => r.toLowerCase() === head);
    out.get(role ?? RAW_COLORS)!.push(c);
  }
  return out;
}

export type Principle = { title: string; means: string };

/** GOV.UK Government design principles, all 11 kept. */
export const GOVUK_PRINCIPLES: Principle[] = [
  { title: 'Start with user needs', means: 'Find real needs through research and data, not assumptions.' },
  { title: 'Do less', means: 'Reuse what works; build only what only we can build.' },
  { title: 'Design with data', means: 'Decide from real behaviour, keep measuring after launch.' },
  { title: 'Do the hard work to make it simple', means: 'Simple to use takes more effort than simple to look at.' },
  { title: 'Iterate. Then iterate again', means: 'Start small, test, refine or drop.' },
  { title: 'This is for everyone', means: 'Inclusive and accessible from the start.' },
  { title: 'Understand context', means: 'Design for people, devices and situations, not screens.' },
  { title: 'Build digital services, not websites', means: 'Design the whole service, end to end.' },
  { title: 'Be consistent, not uniform', means: 'Shared language and patterns, flexible where needed.' },
  { title: 'Make things open', means: 'Share designs, ideas and failures.' },
  { title: 'Minimise environmental impact', means: 'Keep energy and material use low over the whole life.' },
];

/** Richa's own, for what no GOV.UK principle covers. */
export const OWN_PRINCIPLES: Principle[] = [
  { title: 'Plan before you build', means: 'List screens, steps, buttons and copy, and agree them before changing anything.' },
  { title: 'Calm and clear', means: 'Hierarchy and whitespace over boxes; colour only when it means something.' },
  { title: 'Honest about what the AI does', means: 'Never promise more than the product delivers; say who did what and where it came from.' },
  { title: 'Say exactly what happens', means: 'Labels name the exact thing; waits say how long and what comes next.' },
];

/** Slots that hold nothing yet. Shown so it is clear where things go. */
export const FOUNDATION_SLOTS = ['Grid and layout', 'Elevation', 'Motion'] as const;
export const PATTERN_SLOTS = ['Error messages', 'Help content', 'Save buttons', 'Health and severity', 'Tables', 'Nested drag and drop', 'Forms', 'Empty states', 'Waits and progress', 'Destructive actions', 'Approvals and AI access', 'Chat side panel', 'Connect an app'];
export const CONTENT_SLOTS = ['Voice and style', 'Tone', 'Language', 'Accessibility', 'Inclusivity', 'Word choice', 'Glossary', 'Sample data'];
export const DATAVIZ_SLOTS = ['Chart types', 'Colour', 'Stat tiles and meters', 'Axes and labels', 'Legends and tooltips', 'States', 'Accessibility'];

/** The headings of a component page, from Elastic UI's Button page plus Figma. Empty ones are hidden. */
export const COMPONENT_HEADINGS = ['Overview', 'Types', 'Style', 'States', 'Content', 'Usage', 'Accessibility', 'Do and don\'t', 'In Figma', 'Changelog'] as const;
