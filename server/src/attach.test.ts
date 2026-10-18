import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AttachError, loadImages, refPath, saveImage, sniffType, userContent, withRefs } from './attach.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('attach', () => {
  it('saves an image under refs and loads it as a base64 block', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dv-'));
    const ref = await saveImage(dir, 'image/png', PNG);
    expect(refPath(ref)).toBe(true);
    const { refs, blocks } = await loadImages(dir, [ref, '../etc/passwd', 'refs/missing.png']);
    expect(refs).toEqual([ref]);
    expect(blocks[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
  });

  it('rejects other types and empty or large bodies', async () => {
    await expect(saveImage('/tmp', 'image/svg+xml', Buffer.from('x'))).rejects.toThrow(/png/);
    await expect(saveImage('/tmp', 'image/png', Buffer.alloc(0))).rejects.toThrow(/5 MB/);
    await expect(saveImage('/tmp', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1, 1))).rejects.toMatchObject({ status: 413 });
  });

  it('sniffs magic bytes', () => {
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffType(WEBP)).toBe('image/webp');
    expect(sniffType(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(sniffType(Buffer.from('<svg>'))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });

  it('returns 415 when content does not match the claimed type', async () => {
    await expect(saveImage('/tmp', 'image/png', Buffer.from('<svg onload=x>'))).rejects.toMatchObject({ status: 415 });
    await expect(saveImage('/tmp', 'image/jpeg', PNG)).rejects.toBeInstanceOf(AttachError);
  });

  it('builds content and the reference line', () => {
    expect(withRefs('hi', [])).toBe('hi');
    expect(withRefs('hi', ['refs/a.png', 'refs/b.jpg'])).toBe('hi\n\nReference images: refs/a.png, refs/b.jpg');
    expect(userContent('hi', [])).toBe('hi');
    expect(userContent('hi', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }])).toHaveLength(2);
  });
});
