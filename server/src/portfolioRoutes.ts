import type http from 'node:http';
import {
  PortfolioError, applyRun, backToPicks, chromeCheck, finishRun, makePlan, portfolioView, readShot, retryRun, runView, savePicks, setup, skipBlocks,
  startRun, stopRun, toCopy, undoRun, updateSettings,
} from './portfolio.js';

// /api/portfolio/*: one line in index.ts hands these over. The origin check runs there first.

const MAX = 512 * 1024;

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX) throw new PortfolioError('Request body too large', 413);
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new PortfolioError('Request body is not JSON');
  }
}

const RUN = /^\/api\/portfolio\/runs\/(\d{8}-\d{6})(?:\/([a-z]+))?(?:\/([\d:-]+)\.png)?$/;

export async function portfolioRoute(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/portfolio')) return false;
  const json = (data: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const post = req.method === 'POST';
  try {
    const p = url.pathname;
    if (p === '/api/portfolio' && !post) return json(await portfolioView()), true;
    if (p === '/api/portfolio/setup' && post) {
      const b = await body(req);
      await setup({ project: b.project, site: b.site, mode: b.mode });
      return json(await portfolioView()), true;
    }
    if (p === '/api/portfolio/check' && post) return json(await chromeCheck(String((await body(req)).project ?? ''))), true;
    if (p === '/api/portfolio/settings' && post) {
      await updateSettings(await body(req));
      return json(await portfolioView()), true;
    }
    if (p === '/api/portfolio/skip' && post) {
      const b = await body(req);
      await skipBlocks(Array.isArray(b.keys) ? b.keys.map(String) : []);
      return json(await portfolioView()), true;
    }
    if (p === '/api/portfolio/runs' && post) {
      const b = await body(req);
      return json(await startRun(Array.isArray(b.blocks) ? b.blocks.map(String) : [])), true;
    }
    const m = RUN.exec(p);
    if (m) {
      const [, id, act, shot] = m;
      if (act === 'shots' && shot && !post) {
        const png = await readShot(id, shot);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' });
        res.end(png);
        return true;
      }
      if (!act && !post) return json(await runView(id)), true;
      if (post) {
        const acts: Record<string, () => Promise<unknown>> = {
          picks: async () => savePicks(id, (await body(req)).picks),
          copy: () => toCopy(id),
          back: () => backToPicks(id),
          plan: () => makePlan(id),
          go: () => applyRun(id),
          undo: () => undoRun(id),
          done: () => finishRun(id),
          stop: () => stopRun(id),
          retry: () => retryRun(id),
        };
        const fn = act ? acts[act] : undefined;
        if (fn) {
          await fn();
          return json(await runView(id)), true;
        }
      }
    }
    return json({ error: 'Not found' }, 404), true;
  } catch (e) {
    json({ error: e instanceof Error ? e.message : String(e) }, e instanceof PortfolioError ? e.status : 500);
    return true;
  }
}
