import { allowedHost, allowedOrigin } from './origin.js';
import { AttachError, MAX_IMAGE_BYTES, saveImage } from './attach.js';
import { readRules, writeRules } from './rules.js';
import { readScope, updateScope } from './scope.js';
import { readRecipes, writeRecipes } from './recipes.js';
import { DecisionError, readDecisions, writeDecisions } from './decisions.js';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './terminal.js';
import { chromeStatus, connect as connectChrome, figmaTabs, focusFigma, openChrome, showFigma } from './chrome.js';
import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';
import { notifyAway } from './notify.js';
import { mcpConfig, mcpProbe } from './mcp.js';
import { claudeStatus } from './doctor.js';
import { listDir, listFiles, readFileWithOriginal } from './files.js';
import { FigmaError, attachFolder, chatFolders, fileOutline, folderFor, freshChatFolder, images, isChatFolder, listComments, me, postComment, projectFiles, readFigma, replyComment, SAMPLE_KEY, scratchFolder, teamProjects, versions } from './figma.js';
import { loadSample, samplePath } from './sample.js';
import { today } from './spend.js';
import { CHATS_ROOT, publicSettings, saveSettings, settings } from './settings.js';
import { addFigmaToClaude, figmaMcp } from './lean.js';
import { pickDirection, readBoard, readSketch, writeBoard } from './sketch.js';
import { readBuildChecks } from './buildcheck.js';
import { readFlowChecks, runFlowCheck } from './flowcheck.js';
import { copyApplyPrompt, readCopy, readCrit } from './crit.js';
import { markPosted, readDesign, readReview } from './review.js';
import { readProfile } from './profile.js';
import { buildReport, reportSlug } from './report.js';
import { changeStage, readApprovals, readStages } from './stages.js';
import { stageLabel } from '../../shared/stages.js';
import { MCP_BAD, STALE_MS, type ClientMessage, type LiveChat, type ServerMessage } from '../../shared/protocol.js';
import { replyLine, sumEdits } from '../../shared/edits.js';

const PORT = Number(process.env.PORT ?? 7778);
const PROJECT = path.resolve(process.argv[2] ?? process.env.PROJECT_DIR ?? (await scratchFolder()));
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');
const DEV_WEB = process.env.DESIGN_STUDIO_DEV_WEB;

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv|__pycache__|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.tox)(\/|$)/;

const LAST = path.join(os.homedir(), '.designstudio-last.json');

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));

const IDLE_MS = 10 * 60 * 1000;

type Client = { send: (m: ServerMessage) => void; view: AgentSession };
const clients = new Set<Client>();
const live = new Map<string, { chat: AgentSession; watcher: FSWatcher }>();
let lastViewed: AgentSession;

const viewers = (chat: AgentSession) => [...clients].filter((c) => c.view === chat).length;

function summary(chat: AgentSession): LiveChat {
  const s = chat.state;
  const firstPrompt = s.events.find((e) => e.kind === 'user');
  return {
    id: chat.id,
    sessionId: s.session.sessionId,
    cwd: chat.cwd,
    title: chat.title || (firstPrompt?.kind === 'user' ? firstPrompt.text.split('\n')[0].slice(0, 80) : 'New chat'),
    running: s.session.running,
    pending: s.pending.length,
    status: s.status,
    lastActive: s.events[s.events.length - 1]?.at ?? chat.created,
    mcpFailed: s.session.mcp.filter((m) => MCP_BAD.includes(m.status)).length,
    last: replyLine(s.events),
    edits: sumEdits(s.events),
    file: s.session.figma?.name,
    fileUrl: s.session.figma?.url,
  };
}

let liveTimer: NodeJS.Timeout | null = null;
function broadcastLive() {
  liveTimer ??= setTimeout(() => {
    liveTimer = null;
    const chats = [...live.values()].map((l) => summary(l.chat)).sort((a, b) => b.lastActive - a.lastActive);
    clients.forEach((c) => c.send({ type: 'live', chats }));
  }, 100);
}

async function createChat(cwd: string, resume?: string, title = '') {
  const figma = await readFigma(cwd);
  const chat = new AgentSession(cwd, figma, resume);
  chat.title = title;
  await chat.init();
  chat.onFocus = (nodeId) => {
    clients.forEach((c) => c.view === chat && c.send({ type: 'focus', nodeId }));
    const current = chat.figmaFile;
    if (current && current.key !== SAMPLE_KEY) void settings().then((s) => (s.followClaude ? focusFigma(current.key, nodeId, false) : null));
  };
  await chat.loadHistory();
  chat.onMessage((m) => {
    clients.forEach((c) => c.view === chat && c.send(m));
    notifyAway(m, () => (viewers(chat) ? null : summary(chat)));
    if (m.type === 'session' && chat === lastViewed) remember(chat);
    if (m.type !== 'event' || m.event.kind === 'user') broadcastLive();
  });
  if (!resume) chat.start();
  live.set(chat.id, { chat, watcher: watchFiles(cwd, (rel) => chat.fileChangedExternally(rel)) });
  return chat;
}

function closeChat(chat: AgentSession) {
  chat.close();
  closeTerminals(chat.id);
  live.get(chat.id)?.watcher.close();
  live.delete(chat.id);
  broadcastLive();
}

async function closeByUser(chat: AgentSession) {
  const others = [...live.values()].map((l) => l.chat).filter((c) => c !== chat);
  const next = others.sort((a, b) => summary(b).lastActive - summary(a).lastActive)[0] ?? (await createChat(chat.cwd));
  if (lastViewed === chat) lastViewed = next;
  for (const c of clients) if (c.view === chat) view(c, next);
  closeChat(chat);
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

function view(client: Client, chat: AgentSession) {
  const prev = client.view;
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  client.send({ type: 'init', state: chat.state });
  void chat.refreshMcp();
  if (prev && prev !== chat && idle(prev) && !prev.state.session.sessionId) closeChat(prev);
  broadcastLive();
}

setInterval(() => {
  for (const { chat } of live.values()) if (idle(chat) && Date.now() - summary(chat).lastActive > IDLE_MS) closeChat(chat);
}, 60_000);

function watchFiles(cwd: string, onChange: (rel: string) => void) {
  const timers = new Map<string, NodeJS.Timeout>();
  return watch(cwd, { recursive: true }, (_, rel) => {
    if (!rel || IGNORED.test(rel)) return;
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
      timers.delete(rel);
      stat(path.join(cwd, rel)).then((s) => s.isFile() && onChange(rel)).catch(() => {});
    }, 200));
  }).on('error', (err) => console.error(`watcher: ${String(err)}`));
}

const MAX_BODY = 1024 * 1024;

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AttachError('Request body too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBinary(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new AttachError('Images must be 5 MB or smaller', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const isDir = (dir: string) => stat(dir).then((s) => s.isDirectory()).catch(() => false);

async function openSaved(sessionId: string) {
  const open = [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId);
  if (open) return open.chat;
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
  return createChat(info.cwd, sessionId, info.summary);
}

async function newChat(cwd: string, from: AgentSession) {
  const dir = path.resolve(cwd);
  if (dir !== from.cwd && dir !== PROJECT && !isChatFolder(dir)) throw new Error(`Not a Design Studio folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  return createChat(dir);
}

let remembered = '';
function remember(chat: AgentSession) {
  const sessionId = chat.state.session.sessionId;
  if (!sessionId || sessionId === remembered) return;
  remembered = sessionId;
  writeFile(LAST, JSON.stringify({ sessionId, cwd: chat.cwd })).catch(() => {});
}

const DEFAULT_PROJECT = !process.argv[2] && !process.env.PROJECT_DIR;
const firstChat = async () => createChat(DEFAULT_PROJECT ? await freshChatFolder() : PROJECT);
const last = await readFile(LAST, 'utf8').then(JSON.parse).catch(() => null);
lastViewed = await (last?.sessionId ? openSaved(last.sessionId).catch(firstChat) : firstChat());

async function chatForUrl(url: string) {
  const dir = await folderFor(url);
  const open = [...live.values()].map((l) => l.chat).filter((c) => c.cwd === dir).sort((a, b) => summary(b).lastActive - summary(a).lastActive)[0];
  return open ?? createChat(dir);
}

const inside = (root: string, rel: string) => {
  const file = path.resolve(root, rel);
  return file.startsWith(path.resolve(root) + path.sep) ? file : null;
};

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (body: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method !== 'GET' && (!allowedOrigin(req.headers.origin) || !allowedHost(req.headers.host))) return json({ error: 'Forbidden' }, 403);
    const chat = live.get(url.searchParams.get('chat') ?? '')?.chat ?? lastViewed;
    const liveCwds = [...live.values()].map((l) => l.chat.cwd);
    if (url.pathname === '/api/terms' && req.method === 'POST') return json(createTerminal(chat.id, chat.cwd));
    if (url.pathname === '/api/terms' && req.method === 'DELETE') return json(closeTerminal(url.searchParams.get('id') ?? ''));
    if (url.pathname === '/api/terms') return json(listTerminals(chat.id));
    if (url.pathname === '/api/files') return json(await listFiles(chat.cwd));
    if (url.pathname === '/api/dir') return json(await listDir(chat.cwd, url.searchParams.get('path') ?? ''));
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') ?? '';
      return json(await readFileWithOriginal(chat.cwd, rel));
    }
    const readJsonBody = async () => JSON.parse((await readBody(req)) || '{}');
    const figma = chat.state.session.figma;
    const needFigma = () => {
      if (!figma) throw new FigmaError('This chat has no Figma file. Start a chat from a Figma link.', 409);
      return figma;
    };
    if (url.pathname === '/api/sessions' && req.method === 'DELETE') {
      const id = url.searchParams.get('id') ?? '';
      if ([...live.values()].some((l) => l.chat.state.session.sessionId === id)) return json({ error: 'This chat is still open. It closes after 10 minutes without use.' }, 409);
      const info = await getSessionInfo(id);
      if (!info) return json({ error: 'Chat not found' }, 404);
      if (Date.now() - info.lastModified < STALE_MS) return json({ error: 'This chat was used in the last 12 hours.' }, 409);
      await deleteSession(id, { dir: info.cwd });
      return json({ ok: true });
    }
    if (url.pathname === '/api/sample' && req.method === 'POST') {
      // An open sample chat keeps its files: reloading would rewrite run times its review cards point at.
      const opened = [...live.values()].map((l) => l.chat).find((c) => c.cwd === samplePath());
      if (opened) return json({ id: opened.id, cwd: opened.cwd });
      const dir = await loadSample();
      const open = await createChat(dir);
      return json({ id: open.id, cwd: dir });
    }
    if (url.pathname === '/api/attach' && req.method === 'POST') return json({ ref: await saveImage(chat.cwd, String(req.headers['content-type'] ?? ''), await readBinary(req)) });
    if (url.pathname === '/api/recipes' && req.method === 'POST') return json(await writeRecipes(await readJsonBody()));
    if (url.pathname === '/api/recipes') return json(await readRecipes());
    if (url.pathname === '/api/rules' && req.method === 'POST') return json(await writeRules(chat.cwd, await readJsonBody()));
    if (url.pathname === '/api/rules') return json(await readRules(chat.cwd));
    if (url.pathname === '/api/decisions') {
      const key = url.searchParams.get('key') || figma?.key || '';
      return json(req.method === 'POST' ? await writeDecisions(key, await readJsonBody()) : await readDecisions(key));
    }
    if (url.pathname === '/api/scope') return json(req.method === 'POST' ? await updateScope(chat.cwd, await readJsonBody()) : await readScope(chat.cwd));
    if (url.pathname === '/api/stages') {
      if (req.method === 'POST') await changeStage(chat.cwd, await readJsonBody());
      const brief = chat.state.events.find((e) => e.kind === 'user')?.text ?? null;
      const [sketch, design, review, decisions] = await Promise.all([readSketch(chat.cwd).catch(() => null), readDesign(chat.cwd), readReview(chat.cwd), figma ? readDecisions(figma.key).catch(() => ({})) : null]);
      return json(await readStages(chat.cwd, { brief: brief as string | null, figma: !!figma, scope: await readScope(chat.cwd), sketch, design, review, decisions }));
    }
    if (url.pathname === '/api/spend') return json({ today: await today(), budgetUsd: (await settings()).dailyBudgetUsd });
    if (url.pathname === '/api/settings' && req.method === 'POST') return json(publicSettings(await saveSettings(await readJsonBody())));
    if (url.pathname === '/api/settings') return json(publicSettings(await settings()));
    if (url.pathname === '/api/figma/mcp' && req.method === 'POST') return json({ out: await addFigmaToClaude() });
    if (url.pathname === '/api/figma/mcp') return json({ configured: (await figmaMcp()).configured, status: chat.state.session.mcp.find((m) => /figma/i.test(m.name)) ?? null });
    if (url.pathname === '/api/chrome/status') return json(chromeStatus());
    if (url.pathname === '/api/chrome/figma-tabs') return json(figmaTabs());
    if (url.pathname === '/api/claude/status') return json(await claudeStatus());
    if (url.pathname === '/api/figma/me') return json(await me());
    if (url.pathname === '/api/figma/projects') {
      const { teamId } = await settings();
      return json(teamId ? await teamProjects(teamId) : []);
    }
    if (url.pathname === '/api/figma/files') return json(await projectFiles(url.searchParams.get('project') ?? ''));
    if (url.pathname === '/api/figma/folders') return json(await Promise.all((await chatFolders()).filter((f) => f.figma).map(async (f) => ({ cwd: f.dir, ...f.figma, stage: stageLabel(await readApprovals(f.dir)) }))));
    if (url.pathname === '/api/figma/outline') return json(await fileOutline(needFigma().key));
    if (url.pathname === '/api/figma/thumbs') return json(await images(needFigma().key, (url.searchParams.get('ids') ?? '').split(',').filter(Boolean), 0.3, 'png', undefined, url.searchParams.has('r')));
    if (url.pathname === '/api/figma/versions') return json(await versions(needFigma().key));
    if (url.pathname === '/api/figma/render') return json(await images(needFigma().key, (url.searchParams.get('ids') ?? '').split(',').filter(Boolean), 1, 'png', url.searchParams.get('version') || undefined));
    if (url.pathname === '/api/figma/comments/reply' && req.method === 'POST') {
      const { commentId, message } = await readJsonBody();
      if (!commentId || !String(message ?? '').trim()) throw new FigmaError('A comment and a message are required');
      return json(await replyComment(needFigma().key, String(commentId), String(message).trim()));
    }
    if (url.pathname === '/api/figma/comments') return json(await listComments(needFigma().key));
    if (url.pathname === '/api/figma/show' && req.method === 'POST') {
      const f = needFigma();
      return json({ tab: await showFigma(f.key, f.url) });
    }
    if (url.pathname === '/api/figma/focus' && req.method === 'POST') {
      const { nodeId } = await readJsonBody();
      return json({ result: await focusFigma(needFigma().key, String(nodeId), true) });
    }
    if (url.pathname === '/api/sketch/pick' && req.method === 'POST') {
      const { screen, direction, reason } = await readJsonBody();
      return json(await pickDirection(chat.cwd, String(screen), String(direction), reason));
    }
    if (url.pathname === '/api/sketch/board' && req.method === 'POST') {
      await writeBoard(chat.cwd, (await readJsonBody()).elements);
      return json({ ok: true });
    }
    if (url.pathname === '/api/sketch/board') return json(await readBoard(chat.cwd));
    if (url.pathname === '/api/sketch') return json(await readSketch(chat.cwd).catch((err) => ({ error: (err as Error).message })));
    if (url.pathname === '/api/review/post' && req.method === 'POST') {
      const f = needFigma();
      const { ids } = await readJsonBody();
      const doc = await readReview(chat.cwd);
      const all = doc.runs.flatMap((r) => [...r.check, ...r.results.flatMap((x) => x.findings)]);
      const chosen = all.filter((x) => Array.isArray(ids) && ids.includes(x.id) && !doc.posted?.includes(x.id));
      for (const x of chosen) await postComment(f.key, `[Design Studio · ${x.area} · ${x.severity}] ${x.rule}\nFix: ${x.fix}`, x.node);
      await markPosted(chat.cwd, chosen.map((x) => x.id));
      return json({ posted: chosen.length });
    }
    if (url.pathname === '/api/buildcheck') return json({ runs: await readBuildChecks(chat.cwd) });
    if (url.pathname === '/api/flowcheck' && req.method === 'POST') return json({ run: await runFlowCheck({ dir: chat.cwd, fileKey: needFigma().key }) });
    if (url.pathname === '/api/flowcheck') return json({ runs: await readFlowChecks(chat.cwd) });
    if (url.pathname === '/api/crit') return json({ runs: await readCrit(chat.cwd) });
    if (url.pathname === '/api/copy/apply' && req.method === 'POST') {
      const { runId, nodeIds, edits } = await readJsonBody();
      const run = (await readCopy(chat.cwd)).find((r) => r.id === runId);
      if (!run) return json({ error: 'Copy run not found' }, 404);
      const items = run.items.filter((i) => Array.isArray(nodeIds) && nodeIds.includes(i.nodeId)).map((i) => ({ ...i, after: typeof edits?.[i.nodeId] === 'string' ? edits[i.nodeId] : i.after }));
      return json({ prompt: copyApplyPrompt(items) });
    }
    if (url.pathname === '/api/copy') return json({ runs: await readCopy(chat.cwd) });
    if (url.pathname === '/api/report') {
      const figma = chat.state.session.figma;
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'" };
      if (url.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="${reportSlug(figma)}-design-report.html"`;
      res.writeHead(200, headers);
      return void res.end(await buildReport(chat.cwd, figma));
    }
    if (url.pathname === '/api/review') return json(await readReview(chat.cwd));
    if (url.pathname === '/api/design') return json(await readDesign(chat.cwd));
    if (url.pathname === '/api/design-system') return json(await readProfile(chat.cwd));
    if (url.pathname.startsWith('/api/chat-file/')) {
      const file = inside(chat.cwd, decodeURIComponent(url.pathname.slice('/api/chat-file/'.length)));
      const data = file && (await readFile(file).catch(() => null));
      if (!data) return json({ error: 'Not found' }, 404);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(data);
    }
    if (url.pathname === '/api/mcp/config') return json(await mcpConfig(chat.cwd));
    if (url.pathname === '/api/mcp/probe') return json(await mcpProbe(chat.cwd, url.searchParams.has('refresh')));
    if (url.pathname === '/api/sessions') {
      const list = await listSessions({ limit: 300 });
      return json(list.map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
    }
    if (url.pathname === '/api/state') return json(chat.state);
    if (url.pathname === '/api/connect') {
      const port = url.searchParams.get('port') || (req.headers.host?.match(/:(\d+)$/)?.[1] ?? String(PORT));
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => a!.address);
      const rank = (ip: string) => (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ? 0 : ip.startsWith('192.168.') || ip.startsWith('10.') ? 1 : 2);
      ips.sort((a, b) => rank(a) - rank(b));
      return json({ hostname: os.hostname(), urls: ips.map((ip) => `http://${ip}:${port}`) });
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    if (DEV_WEB) {
      res.writeHead(302, { location: `http://${(req.headers.host ?? 'localhost').replace(/:\d+$/, '')}:${DEV_WEB}${url.pathname}${url.search}` });
      return res.end();
    }
    let file = path.join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    const exists = await stat(file).then((s) => s.isFile()).catch(() => false);
    if (!exists) file = path.join(WEB_DIST, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) return json({ error: 'web client not built, run npm run dev or npm run build' }, 404);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    json({ error: err instanceof Error ? err.message : String(err) }, err instanceof FigmaError || err instanceof AttachError || err instanceof DecisionError ? err.status : 500);
  }
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }, done) => (allowedOrigin(req.headers.origin) ? done(true) : done(false, 403, 'Forbidden')),
});

wss.on('connection', (ws: WebSocket, req) => {
  const params = new URL(req.url ?? '', 'http://x').searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, req.headers.origin);
  const client: Client = { send: (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)), view: lastViewed };
  clients.add(client);
  view(client, lastViewed);
  const fail = (err: unknown) => client.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const chat = client.view;
    switch (msg.type) {
      case 'prompt':
        void chat.prompt(msg.text, msg.images);
        break;
      case 'steer':
        void chat.steer(msg.text, typeof msg.id === 'string' ? msg.id.slice(0, 64) : undefined, msg.images);
        break;
      case 'plan':
        chat.changePlan(msg.next.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 120)).slice(0, 12));
        break;
      case 'answer':
        chat.answerQuestion(msg.id, msg.answers);
        break;
      case 'permission':
        chat.answerPermission(msg.id, msg.allow, msg.always, typeof msg.note === 'string' ? msg.note : undefined);
        break;
      case 'set_permission_mode':
        void chat.setPermissionMode(msg.mode);
        break;
      case 'set_model':
        void chat.setModel(String(msg.model));
        break;
      case 'set_flow':
        chat.updateFlow(msg.patch ?? {});
        break;
      case 'flow_continue':
        chat.continueFlow();
        break;
      case 'flow_pick':
        pickDirection(chat.cwd, String(msg.screen), String(msg.direction), msg.reason).catch(fail);
        break;
      case 'new_chat':
        (msg.url?.trim() ? chatForUrl(msg.url) : freshChatFolder().then(createChat)).then((c) => view(client, c), fail);
        break;
      case 'set_figma': {
        const url = String(msg.url ?? '').trim();
        const attach = !chat.figmaFile && isChatFolder(chat.cwd) && path.resolve(chat.cwd) !== path.resolve(CHATS_ROOT, 'scratch');
        if (!attach) chatForUrl(url).then((c) => view(client, c), fail);
        else attachFolder(chat.cwd, url).then((f) => (chat.setFigma(f), broadcastLive()), fail);
        break;
      }
      case 'interrupt':
        void chat.interrupt();
        break;
      case 'long_run_start':
        void chat.startLongRun(String(msg.text ?? ''), Number(msg.until), Number(msg.cap), msg.images);
        break;
      case 'long_run_stop':
        void chat.stopLongRun();
        break;
      case 'long_run_clear':
        chat.clearLongRun();
        break;
      case 'close': {
        const target = live.get(msg.id)?.chat;
        if (target) closeByUser(target).catch(fail);
        break;
      }
      case 'view': {
        const next = live.get(msg.id)?.chat;
        if (next) view(client, next);
        else fail(new Error('This chat was closed'));
        break;
      }
      case 'open_session':
        openSaved(msg.sessionId).then((c) => view(client, c), fail);
        break;
      case 'mcp_status':
        void chat.refreshMcp();
        break;
      case 'mcp_reconnect':
        void chat.reconnectMcp(String(msg.name), Boolean(msg.quiet));
        break;
      case 'mcp_toggle':
        void chat.toggleMcp(String(msg.name), Boolean(msg.enabled));
        break;
      case 'new_session':
        newChat(msg.cwd ?? chat.cwd, chat).then((c) => view(client, c), fail);
        break;
    }
  });
  ws.on('close', () => {
    clients.delete(client);
    broadcastLive();
  });
});

server.listen(PORT, () => {
  console.log(`designstudio on http://localhost:${PORT}, chats in ${path.dirname(PROJECT)}`);
  void connectChrome();
});
