import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { lastModel, readChatModel, saveChatModel, startModel } from './chatModel.js';
import { currentOption } from '../../shared/models.js';
import { CHAT_MODEL } from '../../shared/design.js';

const reply = (model: string, sub = false) => ({ type: 'assistant', uuid: 'u', session_id: 's', parent_tool_use_id: sub ? 't1' : null, parent_agent_id: null, message: { model } }) as SessionMessage;

describe('chat model', () => {
  it('keeps an old chat on the model it ran on, and starts a new chat on Opus', () => {
    expect(startModel(undefined, null, null)).toBe(CHAT_MODEL);
    expect(startModel('s1', null, 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(startModel('s1', 'opus', 'claude-sonnet-5-5')).toBe('opus');
    expect(startModel('s1', null, null)).toBe('claude-sonnet-5-5');
  });

  it('reads the last main-thread reply, not a subagent or a synthetic row', () => {
    expect(lastModel([reply('claude-sonnet-5-5'), reply('claude-haiku-5-5', true), reply('<synthetic>')])).toBe('claude-sonnet-5-5');
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
