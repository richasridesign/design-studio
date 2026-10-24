import os from 'node:os';
import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';

// Her ~/.claude/CLAUDE.md @-imports her design skills (about 60 KB, 18k tokens), so every turn carried every checklist.
// In Design Studio chats those imports are left out (claudeMdExcludes), the hard rules below go in the system prompt,
// and the full checklists stay reachable as the same skills (listed by description, loaded with the Skill tool).
// The rest of her CLAUDE.md still loads. Reviews read the area's SKILL.md themselves (dsSources.ts).

export type SkillImport = { folder: string; files: string[] };

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * The SKILL.md files her user CLAUDE.md imports that are also loadable skills (~/.claude/skills/<folder>/SKILL.md is
 * the same file). Only those are left out of CLAUDE.md, so no rule becomes unreachable.
 */
export function skillImports(home = os.homedir()): SkillImport[] {
  let text = '';
  try {
    text = readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  } catch {
    return [];
  }
  const out: SkillImport[] = [];
  for (const m of text.matchAll(/(?:^|\s)@(\S+\/SKILL\.md)\b/g)) {
    const ref = m[1];
    const abs = ref.startsWith('~/') ? path.join(home, ref.slice(2)) : path.resolve(home, '.claude', ref);
    const folder = path.basename(path.dirname(abs));
    const target = real(abs);
    if (!target || target !== real(path.join(home, '.claude', 'skills', folder, 'SKILL.md'))) continue;
    if (!out.some((s) => s.folder === folder)) out.push({ folder, files: [...new Set([abs, target])] });
  }
  return out;
}

/** The hard rules, near verbatim from her skills (design-process first), picked from what went wrong in her chats. */
export const CORE_RULES = [
  'Plan before change: list screens, interactions, buttons (label, type, position), click targets, exact copy and side effects. Wait for approval. (design-process)',
  'Interaction first: list every step the user takes (open, type, filled, error, wait, done, cancel, back) as screens or states in the plan. Never ship a static screen where an input or a choice needs its filled, typing or error state. (design-process)',
  'Iterate, never replace: new versions sit beside old ones, named, documented and timestamped. Old versions stay frozen. (design-process)',
  'Where versions live: every new iteration goes on the "Design Studio" page as a section named "V0.N · Flow · topic · weekday date", stacked below the previous V0.N section. Build from the latest screens on that page, never from the old copies on "Virtual assistant". If the chat says one place and Richa has said another, ask once before building. (design-process)',
  'Richa edits the file while you work. Re-read the nodes right before every write and compare with what you read earlier; if anything changed that you did not change, stop and ask. Only write the exact properties the request names. (design-process)',
  'Never change an established component or style on your own. "Visual refinement" is not a licence to restyle. List every difference in the plan as "Proposed change: <what>, from <old> to <new>, why", and wait for approval. (design-process)',
  'Apply a fix everywhere it repeats, not only where Richa pointed. (design-process)',
  'Build every part from existing components. Extend a set with a new variant before creating a new component. Never duplicate. Editing a main component changes every instance, including old versions: check instances first. (design-system-review)',
  'Component-level changes only: change a style by editing the main component or adding a variant (with approval), never by setting strokes, fills, padding or text sizes on instances. Never copy styles from one screen onto another by walking their layer trees. (design-system-review)',
  'Fix it once in the master: when a style is wrong on one screen\'s instance, change the main component in every variant of its set, never one variant or one screen. Then scan all instances file-wide for drift. (design-system-review)',
  'One primary button per screen. (design-system-review)',
  'Every interactive element has a hover state wired in the prototype, and links in the latest version never open a screen from an old version. (interaction-design-review)',
  'Never leave a screen loose on the flow canvas or let screens overlap. Run an overlap scan before reporting. 4px grid, font sizes 12/14/16/18/20/24. (visual-craft-review)',
  'No em dashes. Keep the product\'s own terms. (ux-writing-review)',
  'Text at least 4.5:1 against its background, WCAG 2.2 AA. (accessibility-review)',
];

/** The rules block for a chat's system prompt (and a Figma subagent's prompt), or '' when nothing was left out. */
export function designCore(skills = skillImports()): string {
  if (!skills.length) return '';
  const names = skills.map((s) => s.folder);
  const process = names.filter((n) => n === 'design-process');
  const checks = names.filter((n) => n !== 'design-process');
  const load = [
    process.length ? 'Load design-process with the Skill tool before you plan or build any flow, screen or version in Figma.' : '',
    checks.length ? `Before you report a build, and when you review or check work, load the skills for what changed: ${checks.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return [
    'Design rules: the hard rules from the designer\'s skills, always on.',
    ...CORE_RULES.map((r) => `- ${r}`),
    `The full rules are the skills ${names.join(', ')} (her CLAUDE.md points at the same files). ${load}`,
  ].join('\n');
}

/** The CLAUDE.md files a chat leaves out: the imported skill files, by path and by real path. */
export const claudeMdExcludes = (skills = skillImports()) => skills.flatMap((s) => s.files);
