// New project, the rules both the popover and the server use: the name, the folder it makes, and the Figma project
// link for "In a Figma project". No Node imports.

export const PROJECT_NAME_MAX = 60;

/** Spaces collapsed and trimmed, as the name is saved. */
export const cleanProjectName = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The folder name: lower case, dashes between words. Empty when the name has no letters or numbers. */
export const projectSlug = (name: string) => cleanProjectName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, PROJECT_NAME_MAX);

/** What is wrong with a name, in plain words, or '' when it is fine. An empty name is not an error until submit. */
export function projectNameProblem(raw: string): string {
  const name = cleanProjectName(raw);
  if (!name) return 'Give the project a name.';
  if (name.length > PROJECT_NAME_MAX) return `Use ${PROJECT_NAME_MAX} characters or fewer.`;
  if (!/^[\p{L}\p{N} -]+$/u.test(name)) return 'Use letters, numbers, spaces and dashes only.';
  if (!projectSlug(name)) return 'Use at least one letter or number from a to z or 0 to 9.';
  return '';
}

export const takenText = (name: string) => `A project called ${cleanProjectName(name)} already exists. Pick another name.`;

/**
 * The project id in a Figma project link: figma.com/files/project/123, figma.com/files/<org>/project/123 or
 * figma.com/files/team/<team>/project/123. Null for anything else.
 */
export function figmaProjectId(link: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?figma\.com\/files\/(?:[^/?#\s]+\/)*project\/(\d{1,24})(?:[/?#]|$)/i.exec(String(link ?? '').trim());
  return m ? m[1] : null;
}

/** A Figma team or organization key, as whoami lists it and create_new_file takes it. */
export const isPlanKey = (s: unknown) => typeof s === 'string' && /^(team|organization)::\d+$/.test(s);

export type FigmaTeam = { key: string; name: string };
