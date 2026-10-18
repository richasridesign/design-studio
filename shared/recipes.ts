export type RecipeGroup = 'make' | 'improve' | 'ship';

export type Recipe = {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  group: RecipeGroup;
  needsFrames: boolean;
  prompt: string;
};

export type CustomRecipe = { id: string; title: string; blurb: string; prompt: string; group: RecipeGroup };

export const toRecipe = (c: CustomRecipe): Recipe => ({ ...c, icon: 'bookmark', needsFrames: c.prompt.includes('{frames}') });

export const RECIPE_GROUPS: { id: RecipeGroup; label: string }[] = [
  { id: 'make', label: 'Make' },
  { id: 'improve', label: 'Improve' },
  { id: 'ship', label: 'Ship' },
];

export const NO_FRAMES = 'the frames I name below';

export const RECIPES: Recipe[] = [
  {
    id: 'brief',
    title: 'Design from a brief',
    blurb: 'Plan, sketch, design and review screens from a few lines of text.',
    icon: 'sparkle',
    group: 'make',
    needsFrames: false,
    prompt: 'Design this: ',
  },
  {
    id: 'research',
    title: 'Research first',
    blurb: 'Look at how others solve it, with screenshots, then weigh options. No Figma edits.',
    icon: 'search',
    group: 'make',
    needsFrames: false,
    prompt:
      'Research this before any design. Do not change the Figma file. Look at 3 to 5 products or patterns that solve it (competitors, well known apps, NN/g or platform guidelines). Open each in Chrome. When you can save a screenshot, save it as a PNG in a research folder in this chat folder and show it with ![name](research/<file>.png). Write research.md in the chat folder with these sections, short bullets in plain words: ## Question, ## Looked at (one bullet per reference: name, what it shows, link), ## Findings (at most 5), ## Options (A, B, C, one line each), ## What we give up, ## Sources. End your reply with the option you recommend and why in one line, then wait for my pick. Research this: ',
  },
  {
    id: 'states',
    title: 'Missing states',
    blurb: 'Add empty, loading, error, long content and no permission variants.',
    icon: 'layers',
    group: 'improve',
    needsFrames: true,
    prompt:
      'For {frames}, design the states that are missing: empty, loading, error, long content (long names, many items, wrapped text) and no permission. Build each as a copy of the source frame, placed to the right of that source frame on the Design Studio page with a gap of 100px and named "<source> / <state>". Reuse the existing components and variables, and list which states you added for each frame.',
  },
  {
    id: 'responsive',
    title: 'Responsive variants',
    blurb: 'Create mobile, tablet and desktop versions with auto layout.',
    icon: 'device-mobile',
    group: 'improve',
    needsFrames: true,
    prompt:
      'Create responsive variants of {frames} at 390 (mobile), 834 (tablet) and 1440 (desktop) wide. Use auto layout with resizing rules (fill, hug, fixed) so each variant reflows rather than scales, and adapt navigation, columns and spacing to the width. Place the variants next to the source frame on the Design Studio page, named "<source> / 390", "<source> / 834" and "<source> / 1440".',
  },
  {
    id: 'copy',
    title: 'Copy pass',
    blurb: 'Make UI copy clear, short and consistent in tone. Cheap, one Sonnet call.',
    icon: 'symbol-string',
    group: 'improve',
    needsFrames: true,
    prompt:
      '/copy tone:friendly {frames}',
  },
  {
    id: 'crit',
    title: 'Design crit',
    blurb: 'Get feedback from four points of view, without any edits. Cheap, one Sonnet call.',
    icon: 'comment-discussion',
    group: 'improve',
    needsFrames: true,
    prompt:
      '/crit {frames}',
  },
  {
    id: 'handoff',
    title: 'Handoff notes',
    blurb: 'Write developer notes with spacing, tokens, props and interactions.',
    icon: 'file-code',
    group: 'ship',
    needsFrames: true,
    prompt:
      'Write developer handoff notes for {frames} as a markdown file named handoff.md in the chat folder. For each frame cover layout and spacing (with the variable names), colors and type as tokens, the components used with their props and variants, interactions and transitions, responsive behavior and open questions. Read values from Figma rather than estimating them.',
  },
];

export function recipePrompt(recipe: Recipe, frames: string | null) {
  return recipe.prompt.replaceAll('{frames}', frames || NO_FRAMES);
}
