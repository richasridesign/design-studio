import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { figmaFailure, onReadCost, PACK_JS, PAGE_CHARS, pagedScript, pluginRead, pluginShots, ReadState, unpack } from './pluginRead.js';

const pack = new Function(`${PACK_JS}\nreturn __pack;`)() as (s: string) => string;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = (script: string, figma: any = {}) => new AsyncFunction('figma', script)(figma);

const USE = 'mcp__plugin_figma_figma__use_figma';
const SHOT = 'mcp__plugin_figma_figma__get_screenshot';
const MCP = { servers: {}, plugins: [], configured: true, via: 'plugin' as const, name: 'plugin_figma_figma' };

// Text that LZW compresses poorly, so it spans several pages.
function noisy(n: number) {
  let x = 12345;
  let s = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += String.fromCharCode(33 + (x % 90));
  }
  return s;
}

describe('pack and unpack', () => {
  it('round trips empty, plain, unicode, emoji and long strings', () => {
    for (const s of ['', 'a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'abababababababab', 'Übersicht · Décision 1 · 日本語', 'Status 🟢 done 👍🏽', JSON.stringify({ n: 'x'.repeat(5000) }), noisy(200000)]) {
      const p = pack(s);
      expect(p).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(unpack(p)).toBe(s);
    }
  });

  it('keeps working past the dictionary cap', () => {
    const s = noisy(3_000_000);
    expect(unpack(pack(s))).toBe(s);
  }, 30000);

  it('rejects characters outside the alphabet', () => {
    expect(() => unpack('ab$c')).toThrow(/cannot read/);
  });
});

describe('pagedScript', () => {
  it('returns pages that join back into the value, each under the use_figma limit', async () => {
    const big = noisy(60000);
    const body = `return { big: ${JSON.stringify(big)}, n: 1 };`;
    const first = await runScript(pagedScript(body, 0));
    expect(first.pages).toBeGreaterThan(1);
    const parts = [first.data];
    for (let p = 1; p < first.pages; p++) {
      const r = await runScript(pagedScript(body, p));
      expect(r.len).toBe(first.len);
      parts.push(r.data);
    }
    for (const part of parts) expect(JSON.stringify({ ds: 1, page: 9, pages: 9, len: first.len, data: part }).length).toBeLessThan(20480);
    expect(parts.slice(0, -1).every((d) => d.length === PAGE_CHARS)).toBe(true);
    expect(JSON.parse(unpack(parts.join('')))).toEqual({ big, n: 1 });
  });

  it('packs undefined as null', async () => {
    const r = await runScript(pagedScript('return undefined;', 0));
    expect(JSON.parse(unpack(r.data))).toBeNull();
  });
});

const opts = (body?: string, shots?: string[]) => ({ fileKey: 'K', what: 'Read', body, shots: shots ? { ids: shots, maxDimension: 400 } : undefined, use: USE, shot: SHOT });
const pageOf = (r: any) => r.hookSpecificOutput.updatedInput.code.match(/const __PAGE = (\d+)/)[1] * 1;
const said = (r: any) => r.hookSpecificOutput.updatedMCPToolOutput?.[0].text ?? r.hookSpecificOutput.additionalContext ?? r.hookSpecificOutput.permissionDecisionReason;

describe('ReadState', () => {
  it('asks for pages until all are in, then turns more calls away', () => {
    const st = new ReadState(opts('return 1;'));
    const a = st.pre(USE, { code: 'PAGE' }, 't1');
    expect(a.hookSpecificOutput).toMatchObject({ permissionDecision: 'allow', updatedInput: { fileKey: 'K', description: 'Read' } });
    expect(pageOf(a)).toBe(0);
    expect(said(st.post(USE, {}, [{ type: 'text', text: JSON.stringify({ ds: 1, page: 0, pages: 2, len: 4, data: 'ab' }) }], 't1'))).toMatch(/again.*1 more call\b/);
    expect(pageOf(st.pre(USE, {}, 't2'))).toBe(1);
    expect(said(st.post(USE, {}, { content: [{ type: 'text', text: JSON.stringify({ ds: 1, page: 1, pages: 2, len: 4, data: 'cd' }) }] }, 't2'))).toMatch(/Everything is read/);
    expect(st.done).toBe(true);
    expect(st.pre(USE, {}, 't3').hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(st.calls).toBe(2);
  });

  it('reads each part of a list on its own and returns one value per part', async () => {
    const st = new ReadState(opts(['return "a";', `return ${JSON.stringify(noisy(30000))};`, 'return 3;']));
    for (let i = 0; i < 10; i++) {
      const pre = st.pre(USE, {}, `t${i}`);
      if (pre.hookSpecificOutput!.permissionDecision !== 'allow') break;
      st.post(USE, {}, JSON.stringify(await runScript((pre.hookSpecificOutput as any).updatedInput.code)), `t${i}`);
    }
    expect(st.done).toBe(true);
    expect(st.calls).toBeGreaterThan(3);
    expect(st.value()).toEqual(['a', noisy(30000), 3]);
  });

  it('hands out different pages to calls made at the same time', () => {
    const st = new ReadState(opts('return 1;'));
    st.pre(USE, {}, 't1');
    st.post(USE, {}, JSON.stringify({ ds: 1, page: 0, pages: 3, len: 6, data: 'ab' }), 't1');
    expect([pageOf(st.pre(USE, {}, 'a')), pageOf(st.pre(USE, {}, 'b'))]).toEqual([1, 2]);
  });

  it('tries a failed page once more, then stops with the error', () => {
    const st = new ReadState(opts('return 1;'));
    st.pre(USE, {}, 't1');
    expect(said(st.fail(USE, {}, 'Return value exceeds the 20480-byte limit', 't1'))).toMatch(/again/);
    expect(pageOf(st.pre(USE, {}, 't2'))).toBe(0);
    expect(said(st.fail(USE, {}, 'Return value exceeds the 20480-byte limit', 't2'))).toMatch(/Stop now.*20480/);
    expect(() => st.value()).toThrow(/Figma could not read the file: Return value exceeds/);
  });

  it('counts a result with no page in it as a failure', () => {
    const st = new ReadState(opts('return 1;'));
    st.pre(USE, {}, 't1');
    st.post(USE, {}, [{ type: 'text', text: 'You need to log in to Figma' }], 't1');
    st.pre(USE, {}, 't2');
    st.post(USE, {}, [{ type: 'text', text: 'You need to log in to Figma' }], 't2');
    expect(() => st.value()).toThrow(/not logged in/);
  });

  it('stops when the file changes between pages', () => {
    const st = new ReadState(opts('return 1;'));
    st.pre(USE, {}, 't1');
    st.post(USE, {}, JSON.stringify({ ds: 1, page: 0, pages: 2, len: 4, data: 'ab' }), 't1');
    st.pre(USE, {}, 't2');
    expect(said(st.post(USE, {}, JSON.stringify({ ds: 1, page: 1, pages: 2, len: 5, data: 'cde' }), 't2'))).toMatch(/changed while it was being read/);
    expect(st.fatal).toBeTruthy();
  });

  it('fills in screenshot calls, keeps their urls and refuses ids not on the list', () => {
    const st = new ReadState(opts(undefined, ['1:2', '3:4']));
    expect(st.pre(USE, {}, 'x').hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(st.pre(SHOT, { nodeId: '9:9' }, 'x').hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(st.pre(SHOT, { nodeId: '1-2', maxDimension: 4000 }, 's1').hookSpecificOutput).toMatchObject({ permissionDecision: 'allow', updatedInput: { fileKey: 'K', nodeId: '1:2', maxDimension: 400 } });
    expect(said(st.post(SHOT, { nodeId: '1:2' }, [{ type: 'text', text: JSON.stringify({ image_url: 'https://figma.example/a.png' }) }], 's1'))).toMatch(/3:4/);
    st.fail(SHOT, { nodeId: '3:4' }, 'Node not found', 's2');
    expect(st.done).toBe(true);
    expect(Object.fromEntries(st.shots)).toEqual({ '1:2': 'https://figma.example/a.png', '3:4': null });
  });
});

describe('figmaFailure', () => {
  it('names what the designer can do', () => {
    expect(figmaFailure('Error: user is not logged in').status).toBe(401);
    expect(figmaFailure('HTTP 403 Forbidden').message).toMatch(/cannot open the file/);
    expect(figmaFailure('File not found').status).toBe(404);
    expect(figmaFailure('').message).toMatch(/Log in to Figma/);
    expect(figmaFailure('Something odd').message).toBe('Figma could not read the file: Something odd');
  });
});

// A stand-in for lean(): plays use_figma and get_screenshot calls through the hooks, running the injected code.
function fakeRun(figma: any, log: { calls: number; prompts: string[] } = { calls: 0, prompts: [] }, delay = 0) {
  return (async (prompt: string, o: any) => {
    log.calls++;
    log.prompts.push(prompt);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const call = (ev: string, input: any, id: string) => o.hooks[ev][0].hooks[0](input, id);
    for (let i = 0; i < 40; i++) {
      const pre = await call('PreToolUse', { tool_name: USE, tool_input: { code: 'PAGE' } }, `u${i}`);
      if (pre.hookSpecificOutput.permissionDecision !== 'allow') break;
      try {
        const out = await runScript(pre.hookSpecificOutput.updatedInput.code, figma);
        const post = await call('PostToolUse', { tool_name: USE, tool_input: {}, tool_response: [{ type: 'text', text: JSON.stringify(out) }] }, `u${i}`);
        if (!/again/.test(said(post))) break;
      } catch (e) {
        await call('PostToolUseFailure', { tool_name: USE, tool_input: {}, error: String(e) }, `u${i}`);
      }
    }
    for (const id of prompt.match(/node ids, with fileKey "[^"]+": (.*?)\. /)?.[1].split(', ') ?? []) {
      await call('PreToolUse', { tool_name: SHOT, tool_input: { nodeId: id } }, `s${id}`);
      await call('PostToolUse', { tool_name: SHOT, tool_input: { nodeId: id }, tool_response: [{ type: 'text', text: JSON.stringify({ image_url: `https://img/${id}.png` }) }] }, `s${id}`);
    }
    return { data: { ok: true }, tokens: 5, costUsd: 0.001, text: '' };
  }) as any;
}

describe('pluginRead', () => {
  it('reads a multi-page value and screenshots in one run', async () => {
    const big = noisy(40000);
    const r = await pluginRead({ fileKey: 'K', dir: os.tmpdir(), what: 'Read', body: `return { name: figma.root.name, big: ${JSON.stringify(big)} };`, shots: { ids: ['1:2'], maxDimension: 200 } }, { mcp: MCP, run: fakeRun({ root: { name: 'Doc' } }) });
    expect(r.value).toEqual({ name: 'Doc', big });
    expect(r.shots).toEqual({ '1:2': 'https://img/1:2.png' });
    expect(r.costUsd).toBe(0.001);
  });

  it('says to log in when the plugin is not connected', async () => {
    await expect(pluginRead({ fileKey: 'K', dir: os.tmpdir(), what: 'Read', body: 'return 1;' }, { mcp: { ...MCP, configured: false }, run: fakeRun({}) })).rejects.toThrow(/Log in to Figma/);
  });

  it('reports the cost of every read to the sink, failed reads too', async () => {
    const seen: Array<{ dir: string; costUsd: number }> = [];
    onReadCost((c) => seen.push(c));
    try {
      await pluginRead({ fileKey: 'K', dir: '/chat/a', what: 'Read', body: 'return 1;' }, { mcp: MCP, run: fakeRun({}) });
      await pluginRead({ fileKey: 'K', dir: '/chat/b', what: 'Read', body: 'throw new Error("Page not found");' }, { mcp: MCP, run: fakeRun({}) }).catch(() => null);
    } finally {
      onReadCost(null);
    }
    expect(seen.map((c) => c.dir)).toEqual(['/chat/a', '/chat/b']);
    expect(seen.every((c) => c.costUsd === 0.001)).toBe(true);
  });

  it('passes a script error on as a Figma error', async () => {
    await expect(pluginRead({ fileKey: 'K', dir: os.tmpdir(), what: 'Read', body: 'throw new Error("Page not found");' }, { mcp: MCP, run: fakeRun({}) })).rejects.toThrow(/could not find/);
  });

  it('shares one run between reads with the same key', async () => {
    const log = { calls: 0, prompts: [] as string[] };
    const run = fakeRun({}, log, 20);
    const [a, b] = await Promise.all([pluginShots('K', ['1:2', '3:4'], 100, { dir: os.tmpdir(), mcp: MCP, run }), pluginShots('K', ['3:4', '1:2'], 100, { dir: os.tmpdir(), mcp: MCP, run })]);
    expect(a).toEqual(b);
    expect(log.calls).toBe(1);
  });

  it('runs at most three reads at a time', async () => {
    let now = 0;
    let peak = 0;
    const run = (async () => {
      peak = Math.max(peak, ++now);
      await new Promise((r) => setTimeout(r, 15));
      now--;
      return { data: { ok: true }, tokens: 0, costUsd: 0, text: '' };
    }) as any;
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => pluginRead({ fileKey: 'K', dir: os.tmpdir(), what: 'Read' }, { mcp: MCP, run })));
    expect(peak).toBe(3);
  });
});
