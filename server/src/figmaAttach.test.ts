import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = await mkdtemp(path.join(os.tmpdir(), 'dv-attach-'));
vi.mock('./settings.js', () => ({ CHATS_ROOT: root, settings: async () => ({ figmaToken: 'tok' }) }));

const { attachFolder, freshChatFolder, FigmaError } = await import('./figma.js');

afterEach(() => vi.unstubAllGlobals());

const stubName = (name: string) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ name }) })));

describe('freshChatFolder', () => {
  it('creates a timestamped folder and a different one at the same instant', async () => {
    const now = new Date('2026-10-18T09:08:07Z');
    const a = await freshChatFolder(now);
    const b = await freshChatFolder(now);
    expect(path.basename(a)).toBe('chat-20261018-090807');
    expect(b).not.toBe(a);
    expect(path.basename(b)).toMatch(/^chat-20261018-090807-[a-z0-9]+$/);
    expect(await readdir(root)).toContain(path.basename(a));
  });
});

describe('attachFolder', () => {
  it('writes figma.json with the looked up name', async () => {
    stubName('Checkout');
    const dir = await freshChatFolder(new Date('2026-01-02T03:04:05Z'));
    const f = await attachFolder(dir, 'https://www.figma.com/design/AbC1234567/Checkout?node-id=1-2');
    expect(f).toEqual({ key: 'AbC1234567', name: 'Checkout', url: 'https://www.figma.com/design/AbC1234567' });
    expect(JSON.parse(await readFile(path.join(dir, 'figma.json'), 'utf8'))).toEqual(f);
  });

  it('rejects links that are not Figma files', async () => {
    const dir = await freshChatFolder(new Date('2026-01-02T03:04:06Z'));
    await expect(attachFolder(dir, 'https://example.com/x')).rejects.toBeInstanceOf(FigmaError);
    expect(await readdir(dir)).not.toContain('figma.json');
  });
});
