import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, imageProblem } from './attach';

describe('imageProblem', () => {
  it('accepts a small png', () => expect(imageProblem({ type: 'image/png', size: 1000 }, 0)).toBe(''));
  it('rejects other types', () => expect(imageProblem({ type: 'image/svg+xml', size: 10 }, 0)).toMatch(/png/));
  it('rejects large files', () => expect(imageProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 }, 0)).toMatch(/5 MB/));
  it('rejects a sixth image', () => expect(imageProblem({ type: 'image/gif', size: 10 }, MAX_IMAGES)).toMatch(/At most/));
});
