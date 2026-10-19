import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPlan, isMixed, keyCheckError, openSite, projectInfo, undoAll, type RawFramer } from './framer.js';
import { hasKey, readKey, saveKey, type Exec } from './framerKey.js';
import type { EditPlanItem } from '../../shared/portfolio.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A fake framer-api project: two pages, text nodes with plain or styled HTML. */
function fakeFramer() {
  const nodes = new Map<string, { text: string; html: string }>([
    ['t1', { text: 'I led the redesign.', html: '<p>I led the redesign.</p>' }],
    ['t2', { text: 'Results', html: '<h2>Results</h2>' }],
    ['t3', { text: 'Cut setup by half', html: '<p>Cut setup by <strong>half</strong></p>' }],
  ]);
  const calls: string[] = [];
  const node = (id: string) => ({
    id,
    getText: async () => nodes.get(id)?.text ?? null,
    getHTML: async () => nodes.get(id)?.html ?? null,
    setText: async (t: string) => { calls.push(`set ${id}`); nodes.set(id, { text: t, html: `<p>${t}</p>` }); },
  });
  const raw: RawFramer & Record<string, unknown> = {
    getNodesWithType: async () => [
      { id: 'p1', path: '/helpdesk-dashboard', draft: false, getNodesWithType: async () => ['t1', 't2', 't3'].map(node) },
      { id: 'p2', path: null },
    ],
    getNode: async (id: string) => (nodes.has(id) ? node(id) : null),
    getUnpublishedPageChanges: async () => [{ path: '/helpdesk-dashboard', status: 'modified' }, { path: '/about', status: 'modified' }],
    disconnect: async () => { calls.push('disconnect'); },
    publish: async () => { calls.push('PUBLISH'); },
    deploy: async () => { calls.push('DEPLOY'); },
  };
  return { raw, nodes, calls };
}

const plan: EditPlanItem[] = [
  { id: 'e1', suggestion: 's1', kind: 'text', page: '/helpdesk-dashboard', node: 't1', old: 'I led the redesign.', text: 'I led the redesign and the readiness column.' },
  { id: 'e2', suggestion: 's1', kind: 'text', page: '/helpdesk-dashboard', node: 't3', old: 'Cut setup by half', text: 'Cut setup a lot' },
  { id: 'e3', suggestion: 's2', kind: 'copy', reason: 'A new case study' },
];

describe('Framer wrapper', () => {
  it('reads pages and text, flags mixed styles and lists unpublished changes', async () => {
    const { raw } = fakeFramer();
    const site = await openSite('https://framer.com/projects/x', 'k', async () => raw);
    expect(await site.pages()).toEqual([{ id: 'p1', path: '/helpdesk-dashboard', draft: false }]);
    expect((await site.texts('/helpdesk-dashboard')).map((t) => [t.id, t.mixed])).toEqual([['t1', false], ['t2', false], ['t3', true]]);
    expect(await site.unpublished()).toEqual([{ path: '/helpdesk-dashboard', status: 'modified' }, { path: '/about', status: 'modified' }]);
    expect(isMixed('<p>Plain</p>')).toBe(false);
    expect(isMixed('<p>A <a href="/x">link</a></p>')).toBe(true);
  });

  it('applies a plan, turns mixed styles into copy and paste, and never publishes', async () => {
    const { raw, nodes, calls } = fakeFramer();
    const site = await openSite('p', 'k', async () => raw);
    const { records, error } = await applyPlan(site, plan);
    expect(error).toBeNull();
    expect(records.map((r) => r.state)).toEqual(['done', 'copy', 'copy']);
    expect(nodes.get('t1')?.text).toBe('I led the redesign and the readiness column.');
    expect(nodes.get('t3')?.text).toBe('Cut setup by half');
    expect(calls).not.toContain('PUBLISH');
    expect(calls).not.toContain('DEPLOY');
  });

  it('stops when her text changed since the plan', async () => {
    const { raw, nodes } = fakeFramer();
    nodes.set('t1', { text: 'She changed it.', html: '<p>She changed it.</p>' });
    const site = await openSite('p', 'k', async () => raw);
    const { records, error } = await applyPlan(site, plan);
    expect(error).toBe('The text changed in Framer since the plan');
    expect(records[0].state).toBe('failed');
    expect(nodes.get('t1')?.text).toBe('She changed it.');
  });

  it('undoes only edits that are still as Design Studio left them', async () => {
    const { raw, nodes } = fakeFramer();
    const site = await openSite('p', 'k', async () => raw);
    const twoText: EditPlanItem[] = [plan[0], { id: 'e4', suggestion: 's1', kind: 'text', page: '/helpdesk-dashboard', node: 't2', old: 'Results', text: 'What changed' }];
    const { records } = await applyPlan(site, twoText);
    nodes.set('t2', { text: 'Her own edit', html: '<p>Her own edit</p>' });
    const r = await undoAll(site, records);
    expect(r.kept).toBe(1);
    expect(nodes.get('t1')?.text).toBe('I led the redesign.');
    expect(nodes.get('t2')?.text).toBe('Her own edit');
    expect(r.records.map((x) => x.state)).toEqual(['undone', 'done']);
  });

  it('has no publish or deploy call anywhere in the Framer files', async () => {
    const files = (await readdir(here)).filter((f) => /^(framer|portfolio).*\.ts$/.test(f) && !f.endsWith('.test.ts'));
    expect(files).toContain('framer.ts');
    for (const f of files) {
      const src = await readFile(path.join(here, f), 'utf8');
      expect(src, f).not.toMatch(/\.(publish|deploy|createBranch)\s*\(/);
    }
  });
});

describe('Framer key in the Keychain', () => {
  function fakeSecurity() {
    const store = new Map<string, string>();
    const seen: Array<{ args: string[]; input?: string }> = [];
    const exec: Exec = async (args, input) => {
      seen.push({ args, input });
      if (args[0] === '-i') {
        const m = /-a (\S+) .* -w (\S+)/.exec(input ?? '');
        if (m) store.set(m[1], m[2]);
        return { code: 0, out: '' };
      }
      const site = args[args.indexOf('-a') + 1];
      if (!store.has(site)) return { code: 44, out: '' };
      return { code: 0, out: args.includes('-w') ? `${store.get(site)}\n` : 'keychain: attributes' };
    };
    return { exec, seen };
  }

  it('saves the key over stdin, never in argv, and reads it back', async () => {
    const { exec, seen } = fakeSecurity();
    expect(await hasKey('Portfolio--abc123', { exec })).toBe(false);
    await saveKey('Portfolio--abc123', 'fr_fake_test_key_1', { exec });
    expect(seen.flatMap((s) => s.args).join(' ')).not.toContain('fr_fake_test_key_1');
    expect(await hasKey('Portfolio--abc123', { exec })).toBe(true);
    expect(await readKey('Portfolio--abc123', { exec })).toBe('fr_fake_test_key_1');
  });

  it('keys the item by project id under DesignStudio.framer', async () => {
    const { exec, seen } = fakeSecurity();
    await saveKey('Portfolio--abc123', 'fr_fake_test_key_1', { exec });
    expect(seen[0].input).toMatch(/^add-generic-password -U -s DesignStudio\.framer -a Portfolio--abc123 /);
  });

  it('refuses a key or project that is not plain', async () => {
    const { exec } = fakeSecurity();
    await expect(saveKey('Portfolio--abc123', 'x; rm -rf ~', { exec })).rejects.toThrow('does not look like a Framer API key');
    await expect(saveKey('a b', 'fr_fake_test_key_1', { exec })).rejects.toThrow('This is not a Framer project link');
    await expect(hasKey('Portfolio--abc123')).rejects.toThrow('Tests must not reach the Keychain');
  });
});

describe('Check key', () => {
  const KEY = 'fr_fake_test_key_1';
  it('reads the project name, then disconnects', async () => {
    let closed = 0;
    const connect = async (_p: string, k: string) => {
      expect(k).toBe(KEY);
      return { getProjectInfo: async () => ({ name: 'Portfolio', id: 'x' }), disconnect: async () => { closed++; } } as unknown as RawFramer;
    };
    expect(await projectInfo('https://framer.com/projects/Portfolio--abc123', KEY, connect)).toEqual({ name: 'Portfolio' });
    expect(closed).toBe(1);
  });

  it('says what went wrong in plain words and never repeats the key', async () => {
    let closed = 0;
    const connect = async () => ({ getProjectInfo: async () => { throw Object.assign(new Error(`bad token ${KEY}`), { code: 'UNAUTHORIZED' }); }, disconnect: async () => { closed++; } }) as unknown as RawFramer;
    await expect(projectInfo('https://framer.com/projects/Portfolio--abc123', KEY, connect)).rejects.toThrow('Framer did not accept this key. Make a new one in Site Settings > General > API keys.');
    expect(closed).toBe(1);
    expect(keyCheckError(new Error(`odd failure for ${KEY}`), KEY)).toBe('Framer did not accept the key check: odd failure for [key]');
    expect(keyCheckError(new Error('getaddrinfo ENOTFOUND api.framer.com'), KEY)).toBe('Could not reach Framer. Check your internet connection, then try again.');
  });
});
