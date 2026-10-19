import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { changeStage, folderLabel, readApprovals, readChatSteps, readStages, STAGES_FILE } from './stages.js';
import type { StageEvidence } from '../../shared/stages.js';

const none: StageEvidence = { brief: null, figma: false, sketch: null, design: null, review: null };
const folder = () => mkdtemp(path.join(os.tmpdir(), 'stages-'));

describe('stages.json', () => {
  it('still loads an old file of folder-wide approvals, and keeps it when a chat marks a step', async () => {
    const dir = await folder();
    await writeFile(path.join(dir, STAGES_FILE), JSON.stringify({ spec: { at: 1, note: 'Brief is clear' }, explore: { at: 2 } }));
    expect(await readApprovals(dir)).toEqual({ spec: { at: 1, note: 'Brief is clear' }, explore: { at: 2 } });
    expect(await folderLabel(dir)).toBe('Build');
    await changeStage(dir, 'chat-a', { action: 'done', id: 'build' }, { first: 'Fix it across all 8 flows', now: 5 });
    const raw = JSON.parse(await readFile(path.join(dir, STAGES_FILE), 'utf8'));
    expect(raw.spec).toEqual({ at: 1, note: 'Brief is clear' });
    expect(raw.chats['chat-a']).toEqual({ kind: 'fix', marks: { build: { state: 'done', at: 5 } } });
    expect(await readApprovals(dir)).toEqual({ spec: { at: 1, note: 'Brief is clear' }, explore: { at: 2 }, build: { at: 5 } });
  });

  it('keeps steps per chat, so a new chat on the same file starts clean', async () => {
    const dir = await folder();
    await changeStage(dir, 'chat-a', { action: 'kind', kind: 'review' }, { now: 1 });
    await changeStage(dir, 'chat-a', { action: 'done', id: 'validate' }, { now: 2 });
    expect((await readChatSteps(dir, 'chat-b')).marks).toEqual({});
    const b = await readStages(dir, 'chat-b', 'Design a new onboarding flow', none);
    expect(b).toMatchObject({ kind: 'new', guessed: true });
    expect(b.steps.every((s) => s.state === 'todo')).toBe(true);
    expect((await readStages(dir, 'chat-a', 'Design a new onboarding flow', none))).toMatchObject({ kind: 'review', guessed: false, steps: [{ id: 'validate', state: 'done' }] });
    expect(await folderLabel(dir)).toBe('All done');
  });

  it('takes the old approve and reopen actions', async () => {
    const dir = await folder();
    await changeStage(dir, 'c', { action: 'approve', id: 'spec', note: 'go' }, { first: 'Design a new flow', now: 3 });
    expect((await readChatSteps(dir, 'c')).marks.spec).toEqual({ state: 'done', at: 3, note: 'go' });
    await changeStage(dir, 'c', { action: 'reopen', id: 'spec' }, { now: 4 });
    expect((await readChatSteps(dir, 'c')).marks).toEqual({ spec: { state: 'todo', at: 4 } });
  });

  it('needs a chat that has started, a known step and a known kind', async () => {
    const dir = await folder();
    await expect(changeStage(dir, null, { action: 'done', id: 'spec' })).rejects.toThrow('Send a message first');
    await expect(changeStage(dir, 'c', { action: 'done', id: 'nope' })).rejects.toThrow('Pick a step');
    await expect(changeStage(dir, 'c', { action: 'kind', kind: 'nope' })).rejects.toThrow('Pick a kind');
  });
});
