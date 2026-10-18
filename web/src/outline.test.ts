import { describe, expect, it } from 'vitest';
import { frameName, splitFrameLinks, type Outline } from './outline';

const A = 'https://www.figma.com/design/abc123/File?node-id=1-2';
const B = 'https://figma.com/file/xyz/Other?node-id=3%3A4&t=1';

describe('splitFrameLinks', () => {
  it('keeps text without links', () => {
    expect(splitFrameLinks('hello world')).toEqual(['hello world']);
  });
  it('splits a link mid-sentence and returns trailing punctuation to text', () => {
    expect(splitFrameLinks(`Check ${A}. Thanks`)).toEqual(['Check ', { url: A, id: '1:2' }, '. Thanks']);
  });
  it('splits two links', () => {
    const c = 'https://www.figma.com/design/abc/F?node-id=5:6';
    expect(splitFrameLinks(`${A} and ${c}`)).toEqual([{ url: A, id: '1:2' }, ' and ', { url: c, id: '5:6' }]);
  });
  it('leaves a link without node-id as text', () => {
    const t = 'see https://www.figma.com/design/abc123/File now';
    expect(splitFrameLinks(t)).toEqual([t]);
  });
});

describe('frameName', () => {
  const outline: Outline = { name: 'F', lastModified: '', pages: [{ id: '0:1', name: 'P', frames: [{ id: '1:2', name: 'Login', page: 'P' }] }] };
  it('finds a frame', () => expect(frameName(outline, '1:2')).toBe('Login'));
  it('returns null when missing', () => {
    expect(frameName(outline, '9:9')).toBeNull();
    expect(frameName(null, '1:2')).toBeNull();
  });
});
