import path from 'node:path';
import http from 'node:http';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it, beforeEach } from 'vitest';

const ROOTS = await vi.hoisted(async () => {
  const [{ mkdtempSync }, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const chats = mkdtempSync(path.join(os.tmpdir(), 'ds-chats-'));
  const projects = mkdtempSync(path.join(os.tmpdir(), 'ds-projects-'));
  process.env.DESIGN_STUDIO_ROOT = chats;
  process.env.DESIGN_STUDIO_PROJECTS = projects;
  return { chats, projects };
});

import { vi } from 'vitest';
const P = await import('./portfolio.js');
const { portfolioRoute } = await import('./portfolioRoutes.js');
const { SUGGEST_SYSTEM, PLAN_SYSTEM, EDIT_SYSTEM, cleanChromePlan, runGuard, DENY_REASON } = await import('./portfolioChat.js');
const { framerTabState } = await import('./portfolioChrome.js');
const { ensureIteration, replaceDecisions } = await import('../../shared/history.js');
const { blockKey } = await import('../../shared/portfolio.js');

const PROJECT = 'https://framer.com/projects/Portfolio--abc123';
const FROZEN = new Date(2026, 9, 18, 12).getTime();
let n = 0;

/** A project with a frozen 1.19 (Connectors, decisions synced), a working 1.20, and an adopted baseline (1). */
async function project(name = 'Harisson', key = `KEY${++n}`) {
  const root = path.join(ROOTS.projects, `p-${key}`);
  await mkdir(path.join(root, 'flows', '01-connectors'), { recursive: true });
  await writeFile(path.join(root, 'figma.json'), JSON.stringify({ key, name, url: `https://www.figma.com/design/${key}` }));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({
    key, adoptedAt: new Date(2026, 9, 1).getTime(),
    flows: [{ n: 1, slug: 'connectors', name: 'Connectors', entry: [] }],
    iterations: [
      { id: '1', state: 'frozen', adopted: true },
      { id: '1.19', state: 'frozen', topic: 'Readiness', date: '2026-10-18', frozenAt: FROZEN, flows: { connectors: { node: '50:2' } } },
      { id: '1.20', state: 'working', topic: 'Next', flows: { connectors: { node: '51:2' } } },
    ],
  }));
  let md = ensureIteration('', { n: 1, name: 'Connectors' }, { id: '1.19', title: '1.19 · Readiness', state: 'frozen' });
  md = replaceDecisions(md, '1.19', [{ id: '60:1', name: 'Connectors', link: `https://www.figma.com/design/${key}?node-id=60-1`, stickies: [{ decision: 'Readiness shows which workflows are close', why: 'she starts with the closest one.' }] }], new Date(2026, 9, 18, 13));
  md = md.replace('<!-- /ds:done 1.19 -->', '- Sun 18 Oct 11:00 · typed chat text that must stay out\n<!-- /ds:done 1.19 -->');
  await writeFile(path.join(root, 'flows', '01-connectors', 'history.md'), md);
  return { root, key, block: blockKey(key, '1.19', 'connectors') };
}

/** Response.url is a getter, so a fake sets it by defining the property. */
const at = (r: Response, url: string) => Object.defineProperty(r, 'url', { value: url });
const page = (body: string) => new Response(`<html><head><script>x()</script></head><body><h1>Helpdesk</h1><p>${body}</p></body></html>`, { status: 200 });
const fakeFetch = (async (url: string) => {
  const u = String(url);
  if (u.includes('/creative')) return at(page('Moved'), 'https://evil.example/creative');
  return at(page(`I led the redesign of the helpdesk. ${'Some longer copy on the page. '.repeat(10)}`), u);
}) as unknown as typeof fetch;

function fakeChat(seen: Array<{ system: string; cwd: string; tools: string[] }>) {
  return (async (_prompt: string, o: any) => {
    seen.push({ system: o.system, cwd: o.cwd, tools: o.tools });
    if (o.system === SUGGEST_SYSTEM) {
      const cands = JSON.parse(await readFile(path.join(o.cwd, 'candidates.json'), 'utf8'));
      const block = cands[0].key;
      return { data: { suggestions: [
        { page: '/helpdesk-dashboard', section: 'Results', kind: 'change', what: 'Add readiness', why: 'Shows how I rank work', sources: [{ block, quotes: ['Readiness shows which workflows are close'] }], draft: 'I added a readiness column \u2014 so people start with the closest one.', images: ['60:1'], flags: [{ kind: 'product', text: 'Harisson' }] },
        { page: '/', section: 'Home card', kind: 'add', what: 'Mention it', why: 'Short', sources: [{ block, quotes: [] }], draft: 'New work on readiness.', images: [], flags: [] },
      ] }, tokens: 1, costUsd: 0, text: '' };
    }
    if (o.system === PLAN_SYSTEM) {
      return { data: { items: [
        { suggestion: 's1', kind: 'text', page: '/helpdesk-dashboard', node: 'Results / Body', old: 'I led the redesign of the helpdesk.', text: 'I added a readiness column.' },
      ] }, tokens: 1, costUsd: 0, text: '' };
    }
    if (o.system === EDIT_SYSTEM) {
      const plan = JSON.parse(await readFile(path.join(o.cwd, 'plan.json'), 'utf8'));
      return { data: { edits: plan.filter((p: any) => p.kind === 'text').map((p: any) => ({ id: p.id, state: 'done', old: p.old, now: p.text })) }, tokens: 1, costUsd: 0, text: '' };
    }
    return { data: null, tokens: 0, costUsd: 0, text: '', error: 'unknown turn' };
  }) as any;
}

const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
};

const tabs = [{ url: `${PROJECT}?node=augiA20Il`, title: 'Portfolio - Framer', at: 1 }];

beforeEach(() => {
  for (const k of Object.keys(P.portfolioDeps)) delete (P.portfolioDeps as any)[k];
  P.portfolioDeps.fetch = fakeFetch;
});

describe('setup', () => {
  it('saves copy mode with no project, and checks the Chrome tab for chrome mode', async () => {
    P.portfolioDeps.browser = { tabs: async () => [], readPublish: async () => ({}), pageText: async () => '' };
    await expect(P.setup({ site: 'richadesign.in', project: PROJECT })).rejects.toThrow('Chrome is not showing this Framer project. Open it there, signed in.');
    await expect(P.setup({ site: 'richadesign.in', project: 'https://x.com', mode: 'chrome' })).rejects.toThrow('This is not a Framer project link');
    expect(await P.setup({ site: 'https://richadesign.in/', mode: 'copy' })).toEqual({ site: 'richadesign.in', project: '', mode: 'copy' });
    P.portfolioDeps.browser = { tabs: async () => tabs, readPublish: async () => ({}), pageText: async () => '' };
    expect(await P.setup({ site: 'richadesign.in', project: PROJECT })).toEqual({ site: 'richadesign.in', project: PROJECT, mode: 'chrome' });
    expect(JSON.parse(await readFile(path.join(P.portfolioDir(), 'framer.json'), 'utf8')).mode).toBe('chrome');
  });

  it('reads only tab addresses to tell signed in from signed out', () => {
    expect(framerTabState(tabs, PROJECT)).toEqual({ ok: true });
    expect(framerTabState([{ url: 'https://framer.com/login', title: 'Log in', at: 1 }], PROJECT).reason).toMatch(/signed out/);
  });
});

describe('setup with a Framer API key (Keychain and Framer faked)', () => {
  const KEY = 'fr_fake_test_key_2';
  function fakes(accept: boolean) {
    const store = new Map<string, string>();
    const argv: string[] = [];
    P.portfolioDeps.keychain = { exec: async (args, input) => {
      argv.push(...args);
      if (args[0] === '-i') { const m = /-a (\S+) .* -w (\S+)/.exec(input ?? ''); if (m) store.set(m[1], m[2]); return { code: 0, out: '' }; }
      const a = args[args.indexOf('-a') + 1];
      if (args[0] === 'delete-generic-password') { store.delete(a); return { code: 0, out: '' }; }
      if (!store.has(a)) return { code: 44, out: '' };
      return { code: 0, out: args.includes('-w') ? `${store.get(a)}\n` : '' };
    } };
    P.portfolioDeps.framerConnect = async (_p, key) => ({
      getProjectInfo: async () => { if (!accept || key !== KEY) throw Object.assign(new Error(`rejected ${key}`), { code: 'UNAUTHORIZED' }); return { name: 'Portfolio' }; },
      disconnect: async () => {},
    }) as any;
    return { store, argv };
  }

  it('checks the key with Framer, keeps it only in the Keychain, and Remove key deletes it', async () => {
    const { store, argv } = fakes(true);
    expect(await P.checkKey({ project: PROJECT, key: KEY })).toEqual({ ok: true, name: 'Portfolio' });
    const config = await P.setup({ site: 'richadesign.in', project: PROJECT, mode: 'api', key: KEY });
    expect(config).toEqual({ site: 'richadesign.in', project: PROJECT, mode: 'api', hasKey: true });
    expect(store.get('Portfolio--abc123')).toBe(KEY);
    expect(argv.join(' ')).not.toContain(KEY);
    expect(await readFile(path.join(P.portfolioDir(), 'framer.json'), 'utf8')).not.toContain(KEY);
    expect(JSON.stringify(await P.portfolioView())).not.toContain(KEY);
    // No key typed: the stored one is checked.
    expect(await P.checkKey({ project: PROJECT })).toEqual({ ok: true, name: 'Portfolio' });
    expect((await P.removeKey())?.mode).toBe('chrome');
    expect(store.size).toBe(0);
    expect(JSON.parse(await readFile(path.join(P.portfolioDir(), 'framer.json'), 'utf8'))).toEqual({ site: 'richadesign.in', project: PROJECT, mode: 'chrome' });
  });

  it('a key Framer refuses changes nothing, and the error never holds the key', async () => {
    fakes(false);
    await P.setup({ site: 'richadesign.in', mode: 'copy' });
    const r = await P.checkKey({ project: PROJECT, key: KEY });
    expect(r).toEqual({ ok: false, error: 'Framer did not accept this key. Make a new one in Site Settings > General > API keys.' });
    await expect(P.setup({ site: 'richadesign.in', project: PROJECT, mode: 'api', key: KEY })).rejects.toThrow('Framer did not accept this key');
    expect((await P.readConfig())?.mode).toBe('copy');
    await expect(P.setup({ site: 'richadesign.in', project: PROJECT, mode: 'api', key: 'x; rm -rf ~' })).rejects.toThrow('does not look like a Framer API key');
    await expect(P.setup({ site: 'richadesign.in', project: PROJECT, mode: 'api' })).rejects.toThrow('Paste the API key');
  });
});

describe('finding finished work', () => {
  it('offers frozen, unused blocks after the adoption date, counts adopted ones, and skips Never projects', async () => {
    const a = await project();
    const view = await P.findBlocks(await P.readPortfolio());
    const mine = view.blocks.filter((b) => b.project.key === a.key);
    expect(mine.map((b) => b.key)).toEqual([a.block]);
    expect(view.adopted).toBeGreaterThan(0);
    await P.updateSettings({ clearance: { key: a.key, value: 'never' } });
    expect((await P.findBlocks(await P.readPortfolio())).blocks.some((b) => b.project.key === a.key)).toBe(false);
    await P.updateSettings({ clearance: { key: a.key, value: 'ask' }, since: '2026-10-19' });
    expect((await P.findBlocks(await P.readPortfolio())).blocks.some((b) => b.project.key === a.key)).toBe(false);
    await P.updateSettings({ since: null });
  });
});

describe('the live site', () => {
  it('reads known pages, refuses other hosts, and falls back to the rendered page when the GET is thin', async () => {
    const dir = path.join(ROOTS.chats, 'site-test');
    const thin = (async (url: string) => at(new Response('<html><body><div id="root"></div></body></html>'), url)) as unknown as typeof fetch;
    const r = await P.fetchSite('richadesign.in', dir, fakeFetch);
    expect(r.failed).toEqual(['/creative']);
    expect(await readFile(path.join(dir, 'helpdesk-dashboard.txt'), 'utf8')).toContain('# Helpdesk\nI led the redesign');
    const seen: string[] = [];
    await P.fetchSite('richadesign.in', dir, thin, async (url) => (seen.push(url), 'Rendered text of the page'));
    expect(seen).toHaveLength(8);
    expect(await readFile(path.join(dir, 'home.txt'), 'utf8')).toContain('Rendered text of the page');
  });
});

describe('a copy pack run', () => {
  it('gathers decisions only, suggests in her voice, autosaves picks, and records what was used', async () => {
    const a = await project('Harisson');
    P.portfolioDeps.browser = { tabs: async () => tabs, readPublish: async () => ({}), pageText: async () => '' };
    await P.setup({ site: 'richadesign.in', mode: 'copy' });
    const seen: Array<{ system: string; cwd: string; tools: string[] }> = [];
    P.portfolioDeps.chat = { run: fakeChat(seen) };
    const run = await P.startRun([a.block]);
    await until(async () => (await P.readRun(run.id)).state === 'picking');
    const dir = P.runDir(run.id);
    const cands = await readFile(path.join(dir, 'candidates.json'), 'utf8');
    expect(cands).toContain('Readiness shows which workflows are close');
    expect(cands).not.toContain('typed chat text');
    expect(seen[0]).toMatchObject({ cwd: dir, tools: ['Read'] });
    const v = await P.runView(run.id);
    expect(v.suggestions[0].draft).toBe('I added a readiness column, so people start with the closest one.');
    expect(v.suggestions[0].flags.map((f) => f.text)).toEqual(['Harisson']);
    expect((await P.readRun(run.id)).note).toMatch(/Screens were not exported/);
    await expect(P.toCopy(run.id)).rejects.toThrow('Pick at least one suggestion to use');
    await P.savePicks(run.id, { s1: { choice: 'use', draft: v.suggestions[0].draft, images: ['60:1', '99:9'], cleared: false }, s2: { choice: 'skip' } });
    expect((await P.readPicks(run.id)).s1.images).toEqual(['60:1']);
    await expect(P.toCopy(run.id)).rejects.toThrow('tick "I can show this" first');
    await P.savePicks(run.id, { s1: { choice: 'use', draft: v.suggestions[0].draft, images: ['60:1'], cleared: true }, s2: { choice: 'skip' } });
    expect((await P.toCopy(run.id)).state).toBe('copy');
    const done = await P.finishRun(run.id);
    expect(done).toMatchObject({ state: 'done', used: 1, skipped: 0 });
    const file = await P.readPortfolio();
    expect(file.used[a.block]).toMatchObject({ frozenAt: FROZEN, run: run.id, state: 'edited' });
    expect(file.lastUpdate?.run).toBe(run.id);
    const flowMd = await readFile(path.join(a.root, 'flows', '01-connectors', 'history.md'), 'utf8');
    expect(flowMd).toMatch(/· Used on the portfolio: \/helpdesk-dashboard, Results$/m);
    const own = await readFile(path.join(P.portfolioDir(), 'history.md'), 'utf8');
    expect(own).toContain(`<!-- ds:run ${run.id} -->`);
    expect(own).toContain('Harisson · 1.19 · Flow 1 · Connectors');
    // Used work is not offered again.
    expect((await P.findBlocks(await P.readPortfolio())).blocks.some((b) => b.key === a.block)).toBe(false);
  });
});

describe('edits in her Chrome (mocked browser)', () => {
  async function pickedRun(reading: () => unknown) {
    const a = await project('Harisson');
    P.portfolioDeps.browser = { tabs: async () => tabs, readPublish: async () => reading(), pageText: async () => '' };
    P.portfolioDeps.browserTools = { mcp: {}, names: ['mcp__browser__click'], pattern: /^mcp__browser__/ };
    P.portfolioDeps.pollMs = 5;
    await P.setup({ site: 'richadesign.in', project: PROJECT });
    P.portfolioDeps.chat = { run: fakeChat([]) };
    const run = await P.startRun([a.block]);
    await until(async () => (await P.readRun(run.id)).state === 'picking');
    const v = await P.runView(run.id);
    await P.savePicks(run.id, { s1: { choice: 'use', draft: 'I added a readiness column.', images: [], cleared: true } });
    await P.makePlan(run.id);
    await until(async () => (await P.readRun(run.id)).state === 'plan');
    return { a, run, v };
  }

  it('reads the Publish panel before and after, and lists the pages it changed', async () => {
    const { run } = await pickedRun(() => ({ lastPublishedAt: new Date(2026, 9, 17, 23, 22).getTime(), changed: ['/helpdesk-dashboard', '/about'], warnings: [] }));
    expect((await P.runView(run.id)).edits.map((e) => [e.kind, e.state])).toEqual([['text', 'waiting']]);
    await P.applyRun(run.id);
    await until(async () => (await P.readRun(run.id)).state === 'edited');
    const r = await P.readRun(run.id);
    expect(r.publishBefore).toBe('Framer: Published Sat 17 Oct, 23:22. Unpublished changes: /helpdesk-dashboard, /about.');
    expect(r.changed).toEqual(['/helpdesk-dashboard']);
    expect(r.outside).toEqual(['/about']);
    const dir = P.runDir(run.id);
    expect(JSON.parse(await readFile(path.join(dir, 'publish-before.json'), 'utf8')).lastPublishedAt).toBeTruthy();
    expect(JSON.parse(await readFile(path.join(dir, 'publish-after.json'), 'utf8')).changed).toContain('/helpdesk-dashboard');
    expect((await P.finishRun(run.id)).published).toBe(true);
  });

  it('stops the run when Framer publishes during it', async () => {
    let calls = 0;
    const { run } = await pickedRun(() => ({ lastPublishedAt: ++calls > 1 ? Date.now() : 1000, changed: [], warnings: [] }));
    P.portfolioDeps.chat = { run: (async (_p: string, o: any) => {
      await new Promise((r) => setTimeout(r, 60));
      if (o?.signal?.aborted) throw new Error('Stopped');
      return fakeChat([])(_p, o);
    }) as any };
    await P.applyRun(run.id);
    await until(async () => (await P.readRun(run.id)).state === 'publish-changed');
    expect((await P.readRun(run.id)).publishAfter).toMatch(/^Framer: Published /);
    // Keep them is refused while an edit never reached Framer, so its block is not marked used.
    expect((await P.runView(run.id)).edits.some((e) => e.state !== 'done')).toBe(true);
    const before = JSON.stringify(await P.readPortfolio());
    await expect(P.finishRun(run.id)).rejects.toThrow('Some edits did not reach Framer');
    expect((await P.readRun(run.id)).state).toBe('publish-changed');
    expect(JSON.stringify(await P.readPortfolio())).toBe(before);
  });

  it('plans only text the live page shows, the rest as copy and paste', () => {
    const plan = cleanChromePlan({ items: [
      { suggestion: 's1', kind: 'text', page: '/', node: 'Hero', old: 'Not on the page', text: 'x' },
      { suggestion: 's2', kind: 'copy', reason: 'A new case study' },
    ] }, { '/': 'I design calm tools.' }, [{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
    expect(plan.map((p) => p.kind)).toEqual(['copy', 'copy', 'copy']);
    expect(plan[0]).toMatchObject({ reason: 'The text was not found on the live page, paste it by hand' });
  });
});

describe('the portfolio chat reads only its run folder', () => {
  it('denies other tools and any path outside, links included', async () => {
    const dir = path.join(ROOTS.chats, 'guard-run');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'candidates.json'), '[]');
    await symlink(ROOTS.projects, path.join(dir, 'out')).catch(() => {});
    const g = runGuard(dir);
    const ask = async (tool_name: string, tool_input: Record<string, unknown>) => ((await g({ tool_name, tool_input } as any, undefined, { signal: new AbortController().signal })) as any).hookSpecificOutput?.permissionDecision ?? 'allow';
    expect(await ask('Read', { file_path: path.join(dir, 'candidates.json') })).toBe('allow');
    expect(await ask('Read', { file_path: 'candidates.json' })).toBe('allow');
    expect(await ask('Read', { file_path: '../other/x.json' })).toBe('deny');
    expect(await ask('Read', { file_path: path.join(dir, 'out', 'p-KEY1', 'project.json') })).toBe('deny');
    expect(await ask('Read', { file_path: path.join(process.env.HOME ?? '/', '.claude/projects/x/y.jsonl') })).toBe('deny');
    expect(await ask('Glob', { pattern: '/Users/**/*.jsonl' })).toBe('deny');
    expect(await ask('Bash', { command: 'security find-generic-password' })).toBe('deny');
    expect(await ask('WebFetch', { url: 'https://richadesign.in' })).toBe('deny');
    expect(DENY_REASON).toMatch(/Publishing is Richa's click in Framer/);
    const edit = runGuard(dir, /^mcp__browser__/);
    expect(((await edit({ tool_name: 'mcp__browser__click', tool_input: {} } as any, undefined, { signal: new AbortController().signal })) as any).hookSpecificOutput).toBeUndefined();
  });
});

describe('routes', () => {
  it('serves the view and refuses unknown runs', async () => {
    const server = http.createServer(async (req, res) => {
      if (!(await portfolioRoute(req, res, new URL(req.url ?? '/', 'http://x')))) res.end('other');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const view = await (await fetch(`http://127.0.0.1:${port}/api/portfolio`)).json();
    expect(view).toHaveProperty('blocks');
    expect(view.canEdit).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port}/api/portfolio/runs/20260101-000000`)).status).toBe(404);
    expect(await (await fetch(`http://127.0.0.1:${port}/api/other`)).text()).toBe('other');
    server.close();
  });
});
