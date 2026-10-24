import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readChatModel, saveChatModel, startModel } from './chatModel.js';
import { currentOption } from '../../shared/models.js';
import { CHAT_MODEL } from '../../shared/design.js';

describe('chat model', () => {
  it('starts new and reopened chats on Opus, and a chat she switched on her pick', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ds-model-'));
    // Saved by the old turn-start save (the id it ran on) and a pick from before: only the alias counts as a pick.
    await writeFile(path.join(dir, 'models.json'), JSON.stringify({ old: 'claude-sonnet-5-5', picked: 'sonnet' }));
    expect(startModel(await readChatModel(dir, 'old'))).toBe(CHAT_MODEL);
    expect(startModel(await readChatModel(dir, 'picked'))).toBe('sonnet');
    expect(startModel(await readChatModel(dir, 'none'))).toBe(CHAT_MODEL);
    // A run across flows picks a full id: saved as a pick, so it keeps it.
    await saveChatModel(dir, 'task', 'claude-sonnet-5-5');
    expect(startModel(await readChatModel(dir, 'task'))).toBe('claude-sonnet-5-5');
  });

  it('saves a switch per session and refuses odd values', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ds-model-'));
    await saveChatModel(dir, 'a', 'opus[1m]');
    await saveChatModel(dir, 'b', 'sonnet');
    await saveChatModel(dir, 'b', '../../etc');
    expect(await readChatModel(dir, 'a')).toBe('opus[1m]');
    expect(await readChatModel(dir, 'b')).toBe('sonnet');
  });

  it('ticks the Opus row, not Default, for the id a turn reports', () => {
    const rows = [
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    ];
    expect(currentOption('claude-opus-5-5', rows)?.value).toBe('opus');
    expect(currentOption('claude-opus-5-5[1m]', rows)?.value).toBe('opus');
    expect(currentOption('default', rows)?.value).toBe('default');
  });
});
