import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { logDecisions, readChatDecisions } from './decisionLog.js';

describe('decision log file', () => {
  it('keeps every row when several calls write at once, and each what once', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dv-dlog-'));
    expect(await readChatDecisions(dir)).toEqual([]);
    await Promise.all([
      logDecisions(dir, [{ what: 'Ready replaces Ready to turn on', by: 'designer' }], 1),
      logDecisions(dir, [{ what: 'Turn on becomes Activate', by: 'designer' }], 2),
      logDecisions(dir, [{ what: 'ready replaces ready to turn on', by: 'claude', why: 'Shorter' }], 3),
    ]);
    const rows = await readChatDecisions(dir);
    expect(rows.map((r) => [r.what, r.at])).toEqual([['Ready replaces Ready to turn on', 1], ['Turn on becomes Activate', 2]]);
    expect(rows[0].why).toBe('Shorter');
    expect(JSON.parse(await readFile(path.join(dir, 'decisions-log.json'), 'utf8'))).toHaveLength(2);
  });

  it('reads a broken file as empty and writes over it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dv-dlog-'));
    await writeFile(path.join(dir, 'decisions-log.json'), '{oops');
    expect(await readChatDecisions(dir)).toEqual([]);
    expect(await logDecisions(dir, [{ what: 'A', by: 'claude' }], 5)).toEqual([{ what: 'A', by: 'claude', at: 5 }]);
  });
});
