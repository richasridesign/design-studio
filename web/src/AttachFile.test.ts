import { describe, expect, it } from 'vitest';
import { recentFiles } from './AttachFile';
import type { LiveChat } from '../../shared/protocol';

const chat = (id: string, lastActive: number, file?: string): LiveChat => ({ id, sessionId: null, cwd: `/c/${id}`, title: id, running: false, pending: 0, status: 'Idle', lastActive, file, fileUrl: file && `https://www.figma.com/design/${file}` });

describe('recentFiles', () => {
  it('lists unique files newest first, skips chats without a file and the current file', () => {
    const live = [chat('a', 1, 'A'), chat('b', 5), chat('c', 3, 'C'), chat('d', 4, 'A'), chat('e', 2, 'E')];
    expect(recentFiles(live).map((f) => f.name)).toEqual(['A', 'C', 'E']);
    expect(recentFiles(live, 'https://www.figma.com/design/A').map((f) => f.name)).toEqual(['C', 'E']);
  });

  it('caps the list at five', () => {
    const live = Array.from({ length: 8 }, (_, i) => chat(`x${i}`, i, `F${i}`));
    expect(recentFiles(live)).toHaveLength(5);
  });
});
