export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function imageProblem(file: { type: string; size: number }, have: number) {
  if (have >= MAX_IMAGES) return `At most ${MAX_IMAGES} images per message`;
  if (!IMAGE_TYPES.includes(file.type)) return 'Only png, jpeg, webp and gif images can be attached';
  if (file.size > MAX_IMAGE_BYTES) return 'Images must be 5 MB or smaller';
  return '';
}

export const imagesIn = (files: Iterable<File> | null | undefined) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
