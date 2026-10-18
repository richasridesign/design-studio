type VersionLike = { id: string; at: string; checkpoint: boolean };

export function reviewTarget<T extends VersionLike>(versions: T[]): T | undefined {
  return [...versions].sort((a, b) => b.at.localeCompare(a.at)).find((v) => v.checkpoint);
}

export function laterSaves(versions: VersionLike[], target: VersionLike) {
  return versions.filter((v) => !v.checkpoint && v.at > target.at).length;
}
