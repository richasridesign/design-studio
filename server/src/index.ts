import { allowedHost, allowedOrigin } from './origin.js';
import { AttachError, MAX_IMAGE_BYTES, saveImage } from './attach.js';
import { readRules, writeRules } from './rules.js';
import { readScope, updateScope } from './scope.js';
import { readTriage, updateTriage } from './triage.js';
import { eventFromBody, projectLabel, workflowEvent, workflowView } from './workflow.js';
import { readRecipes, writeRecipes } from './recipes.js';
import { portfolioRoute } from './portfolioRoutes.js';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { attachTerminal, closeTerminal, closeTerminals, createTerminal, listTerminals } from './terminal.js';
import { chromeStatus, connect as connectChrome, figmaTabs, focusFigma, openChrome, setup as setupChrome, showFigma } from './chrome.js';
import { followChanged, followFigma, forgetView, pauseFollow, sendFollowState, setEditing } from './followRun.js';
import { openFigmaPlugin, pluginFocus, pluginFor } from './figmaPlugin.js';
import { ensureHelper, openFigmaApp, showFigmaApp } from './figmaApp.js';
import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession, weeklyPct } from './session.js';
import { Tasks, type ChatHandle } from './tasks.js';
import { removeProject, renameToConvention } from './projectAdmin.js';
import { TASK_CAP } from '../../shared/tasks.js';
import { MODELS } from '../../shared/design.js';
import { notifyAway } from './notify.js';
import { mcpConfig, mcpProbe } from './mcp.js';
import { claudeStatus } from './doctor.js';
import { listDir, listFiles, readFileWithOriginal } from './files.js';
import { cachedOutline, fileOutline, refreshOutlineSoon, thumbs } from './figmaCache.js';
import { FigmaError, attachFolder, chatFolders, folderFor, freshChatFolder, isChatFolder, readFigma, SAMPLE_KEY, scratchFolder } from './figma.js';
import { loadSample, samplePath } from './sample.js';
import { addDaily, today } from './spend.js';
import { onReadCost } from './pluginRead.js';
import { HistoryError, historyView, onHistoryWrite, syncDecisions } from './history.js';
import { buildMap, cachedMap, ensureMapSoon, refreshMapSoon } from './fileMap.js';
import { CHATS_ROOT, loadedSettings, publicSettings, saveSettings, settings } from './settings.js';
import { projectRoot } from './roots.js';
import { adoptProposal, autoAdopt, chatContext, confirmAdopt, ensureIterationFolders, listProjects, projectIterationDir, readProject, updateProject } from './project.js';
import { iterationReviews, selectionNode, selectionView } from './selection.js';
import { cleanId } from '../../shared/project.js';
import { addFlowToIteration, createIterationInFigma, freezeIteration, makeSectionsFor, reopenIteration } from './iterations.js';
import { createFlow } from './newFlow.js';
import { createFileFor, createProject, linkFile, ProjectError, renameProject, shownRoot } from './newProject.js';
import { figmaTeams } from './figmaCreate.js';
import { commitProject } from './projectGit.js';
import { figmaProjectId } from '../../shared/newProject.js';
import type { FigmaFile } from '../../shared/design.js';
import { addFigmaToClaude, figmaMcp } from './lean.js';
import { cancelFigmaLogin, figmaLoginState, startFigmaLogin } from './figmaLogin.js';
import { readBuildChecks } from './buildcheck.js';
import { readFlowChecks, runFlowCheck } from './flowcheck.js';
import { copyApplyPrompt, readCopy, readCrit } from './crit.js';
import { readDesign, readReview } from './review.js';
import { readAwaiting, updateAwaiting } from './awaiting.js';
import { readProfile } from './profile.js';
import { changeDesignSystem, designSystemView } from './dsSources.js';
import { buildReport, reportSlug } from './report.js';
import { MCP_BAD, STALE_MS, type ClientMessage, type LiveChat, type ServerMessage } from '../../shared/protocol.js';
import { replyLine, sumEdits } from '../../shared/edits.js';

// Every server log line starts with the local time, so a lost message can be traced to a restart.
for (const level of ['log', 'warn', 'error'] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => write(new Date().toLocaleString('sv-SE'), ...args);
}

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

// A flow's history file sits two levels above its chat folders, out of their file watchers: tell the open chats.
onHistoryWrite((file) => {
  const flowDir = path.dirname(file) + path.sep;
  for (const { chat } of live.values()) if (path.resolve(chat.cwd).startsWith(flowDir)) chat.fileChangedExternally('history.md');
});

// Plugin reads (thumbnails, outline, file map, checks) count toward the chat that asked for them, or today's total.
onReadCost(({ dir, costUsd, tokens }) => {
  const chat = [...live.values()].map((l) => l.chat).find((c) => c.cwd === dir);
  if (chat) chat.recordRead(costUsd, tokens);
  else addDaily(tokens, costUsd).catch(() => {});
});

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
    ...(chat.taskId ? { task: chat.taskId } : {}),
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

/**
 * Shows one node in her Figma: through the Design Studio plugin when it runs in that file in the Figma app, else in
 * a Figma tab in Chrome. `navigate`: Chrome may open or reload a tab for it.
 */
async function focusNode(file: FigmaFile, nodeId: string, navigate: boolean) {
  const plugin = pluginFor(file.key, file.name);
  if (!plugin) return focusFigma(file.key, nodeId, navigate);
  forgetView(file.key);
  // A plugin started before it knew how to go to a node never answers: Chrome is tried then.
  const r = await pluginFocus(plugin, nodeId, 3000);
  return typeof r === 'string' ? focusFigma(file.key, nodeId, navigate) : r.status;
}

// A flow or iteration selected in the sidebar: her Figma moves to its section when that file is already open, through
// the plugin or a Figma tab in Chrome. It never opens a tab or navigates.
async function focusSelection(msg: { cwd: string; flow?: string; iteration?: string }) {
  const dir = path.resolve(String(msg.cwd ?? ''));
  if (!isChatFolder(dir)) return;
  const [file, project] = await Promise.all([readFigma(dir), readProject(dir)]);
  const node = file && file.key !== SAMPLE_KEY && project ? selectionNode(project, { flow: msg.flow, iteration: msg.iteration }) : null;
  if (node) await focusNode(file!, node, false).catch(() => null);
}

async function createChat(cwd: string, resume?: string, title = '') {
  const figma = await readFigma(cwd);
  const chat = new AgentSession(cwd, figma, resume);
  chat.title = title;
  await chat.init();
  chat.onFocus = (nodeIds, start) => {
    if (!start) clients.forEach((c) => c.view === chat && c.send({ type: 'focus', nodeId: nodeIds[0] }));
    const current = chat.figmaFile;
    if (current && current.key !== SAMPLE_KEY) void settings().then((s) => (s.followClaude ? followFigma(current.key, nodeIds, start, current.name) : null));
  };
  chat.onEditing = (on) => {
    const current = chat.figmaFile;
    if (current && current.key !== SAMPLE_KEY) setEditing(current.key, on, current.name);
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

// Run across flows: one chat per flow, started here and followed by the runner (tasks.ts).
function taskHandle(chat: AgentSession): ChatHandle {
  return {
    id: chat.id,
    state: () => {
      const s = chat.state;
      const last = [...s.events].reverse().find((e) => e.kind === 'result');
      return { running: s.session.running, pending: s.pending.length, error: Boolean(last?.kind === 'result' && last.isError), tokens: s.session.spend.tokens, costUsd: s.session.spend.costUsd, model: s.session.model, sessionId: s.session.sessionId, closed: !live.has(chat.id) };
    },
    onChange: (fn) => { const off = chat.onMessage((m) => { if (m.type !== 'event' || m.event.kind === 'result') fn(); }); return () => void off(); },
    stop: () => chat.interrupt(),
  };
}

const tasks = new Tasks({
  startChat: async ({ cwd, model, prompt, taskId, title }) => {
    const chat = await createChat(cwd, undefined, title);
    chat.taskId = taskId;
    // Every chat starts on Sonnet (options.ts); another model is set before the first message.
    if (model !== MODELS.work) await chat.setModel(model);
    await chat.prompt(prompt);
    broadcastLive();
    return taskHandle(chat);
  },
  weeklyPct,
  parallel: () => loadedSettings().parallelChats,
  readProject,
  flowFolder: (root, slug, iteration) => ensureIterationFolders(root, slug, iteration),
  roots: async () => (await chatFolders()).filter((f) => f.figma).map((f) => f.dir),
  // After the first flow ran on an iteration with no section: read the map, move the ids to the tagged nodes, and look.
  sectionReady: async (root, key, iteration) => {
    await buildMap(root, key);
    await listProjects();
    const p = await updateProject(root, (x) => x);
    return Boolean(p?.iterations.find((it) => it.id === iteration)?.node);
  },
  onChange: () => broadcastLive(),
});

function closeChat(chat: AgentSession) {
  chat.close();
  tasks.chatClosed(chat.id);
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

/** Remove project: closes every live chat inside the folder. Whoever views one moves to a chat outside it, or a new one. */
async function closeChatsIn(root: string): Promise<number> {
  const inside = (c: AgentSession) => { const d = path.resolve(c.cwd); return d === root || d.startsWith(root + path.sep); };
  const all = [...live.values()].map((l) => l.chat);
  const doomed = all.filter(inside);
  if (!doomed.length) return 0;
  const next = all.filter((c) => !inside(c)).sort((a, b) => summary(b).lastActive - summary(a).lastActive)[0] ?? (await freshChatFolder().then(createChat));
  if (doomed.includes(lastViewed)) lastViewed = next;
  for (const c of clients) if (doomed.includes(c.view)) view(c, next);
  for (const c of doomed) closeChat(c);
  return doomed.length;
}

const idle = (chat: AgentSession) => !chat.state.session.running && chat.state.pending.length === 0 && viewers(chat) === 0 && chat !== lastViewed;

function view(client: Client, chat: AgentSession) {
  const prev = client.view;
  client.view = chat;
  lastViewed = chat;
  remember(chat);
  client.send({ type: 'init', state: chat.state });
  // A chat on a real Figma file starts Claude now, so the first message does not wait for it and its tools to load.
  const figma = chat.figmaFile;
  if (figma && figma.key !== SAMPLE_KEY) {
    chat.start();
    void ensureMapSoon(chat.cwd, figma.key);
  }
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

/** Only chats in the chats root, the projects root or this server's own folder are Design Studio chats. Coding and personal sessions never show. */
const designSession = (cwd: string) => path.resolve(cwd) === PROJECT || isChatFolder(cwd);

async function openSaved(sessionId: string) {
  const open = [...live.values()].find((l) => l.chat.state.session.sessionId === sessionId);
  if (open) return open.chat;
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error('Session not found');
  if (!info.cwd) throw new Error('This session has no folder recorded, so it cannot be resumed');
  if (!designSession(info.cwd)) throw new Error('Not a Design Studio chat');
  if (!(await isDir(info.cwd))) throw new Error(`Folder no longer exists: ${info.cwd}`);
  return createChat(info.cwd, sessionId, info.summary);
}

async function newChat(cwd: string, from: AgentSession, flow?: string, iteration?: string, brainstorm = false) {
  let dir = path.resolve(cwd);
  if (dir !== from.cwd && dir !== PROJECT && !isChatFolder(dir)) throw new Error(`Not a Design Studio folder: ${dir}`);
  if (!(await isDir(dir))) throw new Error(`Folder no longer exists: ${dir}`);
  // A chat on a flow in an iteration runs in that iteration's folder of the project (made on first use).
  if (flow && iteration) dir = await ensureIterationFolders(dir, String(flow), String(iteration));
  const chat = await createChat(dir);
  // A chat for a new flow or a new iteration starts in Brainstorm mode: talk first, build when she clicks Build this.
  if (brainstorm) chat.setBrainstorm(true, true);
  return chat;
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
await settings().catch(() => null);
const last = await readFile(LAST, 'utf8').then(JSON.parse).catch(() => null);
lastViewed = await (last?.sessionId ? openSaved(last.sessionId).catch(firstChat) : firstChat());

/** After a file is linked to a project: every open chat in it gets the file, and the file map is read. */
function fileLinked(root: string, f: FigmaFile) {
  for (const c of [...live.values()].map((l) => l.chat)) if (!c.figmaFile && projectRoot(c.cwd) === root) c.setFigma(f);
  refreshOutlineSoon(root, f.key);
  void commitProject(root, `Link Figma file ${f.name}`);
  broadcastLive();
}

async function chatForUrl(url: string) {
  const { dir, created, name } = await folderFor(url);
  if (created) void commitProject(dir, `Create project ${name} from its Figma file`);
  const key = (await readFigma(dir))?.key;
  if (key) refreshOutlineSoon(dir, key);
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
    if (await portfolioRoute(req, res, url)) return;
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
    // The flow's history file (flows/NN-slug/history.md) and a read of its Decision stickies from Figma.
    if (url.pathname === '/api/history/sync' && req.method === 'POST') {
      await syncDecisions(chat.cwd);
      return json(await historyView(chat.cwd));
    }
    if (url.pathname === '/api/history') return json(await historyView(chat.cwd));
    if (url.pathname === '/api/scope') return json(req.method === 'POST' ? await updateScope(chat.cwd, await readJsonBody()) : await readScope(chat.cwd));
    if (url.pathname === '/api/awaiting') return json(req.method === 'POST' ? await updateAwaiting(await readJsonBody()) : await readAwaiting());
    if (url.pathname === '/api/triage') return json(req.method === 'POST' ? await updateTriage(chat.cwd, await readJsonBody()) : await readTriage(chat.cwd));
    // The flow's workflow in this iteration (workflow.json): the strip and the step card.
    if (url.pathname === '/api/workflow') {
      if (req.method === 'POST') await workflowEvent(chat.cwd, eventFromBody(await readJsonBody(), chat.id));
      const f = chat.state.session.flow;
      return json(await workflowView(chat.cwd, { preset: f.preset, areas: f.areas, reviewing: (f.reviewers ?? []).some((r) => r.state === 'running') }));
    }
    if (url.pathname === '/api/spend') return json({ today: await today(), budgetUsd: (await settings()).dailyBudgetUsd });
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const saved = await saveSettings(await readJsonBody());
      sendFollowState();
      return json(publicSettings(saved));
    }
    if (url.pathname === '/api/settings') return json(publicSettings(await settings()));
    if (url.pathname === '/api/figma/mcp' && req.method === 'POST') return json({ out: await addFigmaToClaude() });
    if (url.pathname === '/api/figma/login' && req.method === 'POST') return json(startFigmaLogin((await readJsonBody())?.auto === true));
    if (url.pathname === '/api/figma/login' && req.method === 'DELETE') return json(cancelFigmaLogin());
    if (url.pathname === '/api/figma/login') return json(figmaLoginState());
    if (url.pathname === '/api/figma/mcp') return json({ configured: (await figmaMcp()).configured, status: chat.state.session.mcp.find((m) => /figma/i.test(m.name)) ?? null });
    if (url.pathname === '/api/chrome/setup' && req.method === 'POST') { setupChrome(); return json(chromeStatus()); }
    if (url.pathname === '/api/chrome/status') return json(chromeStatus());
    if (url.pathname === '/api/chrome/figma-tabs') return json(figmaTabs());
    if (url.pathname === '/api/claude/status') return json(await claudeStatus());
    if (url.pathname === '/api/projects') return json({ projects: await listProjects() });
    if (url.pathname.startsWith('/api/tasks')) {
      const meta = { weeklyPct: weeklyPct(), cap: TASK_CAP, parallel: (await settings()).parallelChats };
      if (url.pathname === '/api/tasks' && req.method === 'POST') {
        const asked = url.searchParams.get('cwd');
        const dir = asked ? path.resolve(asked) : chat.cwd;
        if (!isChatFolder(dir)) return json({ error: 'Not a Design Studio folder' }, 400);
        const root = projectRoot(dir);
        const file = await readFigma(root);
        if (!file || file.key === SAMPLE_KEY) return json({ error: 'This folder has no Figma file' }, 400);
        const body = await readJsonBody();
        return json({ task: await tasks.start(root, { prompt: String(body?.prompt ?? ''), flows: Array.isArray(body?.flows) ? body.flows.map(String) : [], model: body?.model, componentsFirst: Boolean(body?.componentsFirst) }), ...meta });
      }
      const act = /^\/api\/tasks\/(pause|resume|stop)$/.exec(url.pathname)?.[1];
      if (act && req.method === 'POST') {
        const id = String((await readJsonBody())?.id ?? '');
        const task = act === 'pause' ? await tasks.pause(id) : act === 'resume' ? await tasks.resume(id) : await tasks.stop(id);
        return json({ task, ...meta });
      }
      if (url.pathname === '/api/tasks') {
        const asked = url.searchParams.get('cwd');
        return json({ tasks: await tasks.list(asked ? projectRoot(path.resolve(asked)) : undefined), ...meta });
      }
    }
    if (url.pathname.startsWith('/api/projects/')) {
      // The sidebar acts on any project folder, not only the viewed chat's: ?cwd= names it, checked against the roots.
      const asked = url.searchParams.get('cwd');
      const dir = asked ? path.resolve(asked) : chat.cwd;
      if (asked && !isChatFolder(dir)) return json({ error: 'Not a Design Studio folder' }, 400);
      // New project: a named folder with no Figma file yet. Then a file is linked, or made in Figma on her click.
      if (url.pathname === '/api/projects/root') return json({ root: shownRoot() });
      if (url.pathname === '/api/projects/new' && req.method === 'POST') {
        const r = await createProject((await readJsonBody())?.name);
        void commitProject(r.cwd, `Create project ${r.name}`);
        broadcastLive();
        return json({ cwd: r.cwd, name: r.name });
      }
      if (url.pathname === '/api/projects/link' && req.method === 'POST') {
        if (!asked) return json({ error: 'Name the project' }, 400);
        const f = await linkFile(dir, { url: String((await readJsonBody())?.url ?? '') });
        fileLinked(projectRoot(dir), f);
        return json({ figma: f });
      }
      // A POST, though it only reads: it starts a paid Claude run, so a GET-only walk or prefetch never calls Figma.
      if (url.pathname === '/api/projects/figma-teams' && req.method === 'POST') {
        if (!asked) return json({ error: 'Name the project' }, 400);
        return json({ teams: await figmaTeams(projectRoot(dir)) });
      }
      if (url.pathname === '/api/projects/figma-file' && req.method === 'POST') {
        if (!asked) return json({ error: 'Name the project' }, 400);
        const body = await readJsonBody();
        const link = String(body?.projectLink ?? '').trim();
        const projectId = link ? figmaProjectId(link) : undefined;
        if (link && !projectId) return json({ error: 'That is not a Figma project link.' }, 400);
        const f = await createFileFor(dir, { planKey: String(body?.planKey ?? ''), ...(projectId ? { projectId } : {}) });
        fileLinked(projectRoot(dir), f);
        return json({ figma: f });
      }
      const file = asked ? await readFigma(dir) : figma;
      if (url.pathname === '/api/projects/adopt' && req.method === 'POST') {
        if (!file || file.key === SAMPLE_KEY) return json({ error: 'This folder has no Figma file' }, 400);
        const r = await confirmAdopt(dir, file.key, await readJsonBody());
        void commitProject(dir, `Adopt ${file.name}: ${r.project.flows.length} flows, ${r.project.iterations.length} iterations`);
        broadcastLive();
        return json(r);
      }
      // After a file is linked (Add Figma file, a file she has, a pasted link or a new file): adoption with no dialog.
      if (url.pathname === '/api/projects/autofill' && req.method === 'POST') {
        if (!file || file.key === SAMPLE_KEY) return json({ error: 'This folder has no Figma file' }, 400);
        const r = await autoAdopt(dir, file.key);
        if (r.flows) void commitProject(dir, `Adopt ${file.name}: ${r.flows} flows, ${r.iterations} iterations`);
        broadcastLive();
        return json({ flows: r.flows, iterations: r.iterations, file: file.name });
      }
      if (url.pathname === '/api/projects/adopt') {
        if (!file || file.key === SAMPLE_KEY) return json({ error: 'This folder has no Figma file' }, 400);
        return json(await adoptProposal(dir, file.key));
      }
      // Iterations in Figma: create makes project.json, the folders and then the section (best effort, with Retry on
      // /sections), state freezes or reopens, /flow adds a flow to a working iteration.
      const figmaKey = file && file.key !== SAMPLE_KEY ? file.key : null;
      if (url.pathname === '/api/projects/iteration' && req.method === 'POST') {
        const body = await readJsonBody();
        const id = String(body?.id ?? '');
        const r = body?.state === 'working' ? await reopenIteration(dir, id) : body?.state ? await freezeIteration(dir, figmaKey, id) : await createIterationInFigma(dir, figmaKey, body);
        const made = 'iteration' in r ? r.iteration : null;
        void commitProject(dir, body?.state === 'working' ? `Reopen iteration ${cleanId(id) ?? id}` : body?.state ? `Freeze iteration ${cleanId(id) ?? id}` : `Create iteration ${made?.id ?? ''} ${made?.topic ?? ''}`);
        broadcastLive();
        return json(r);
      }
      // New flow (From scratch): the flow, project.json on a file that has none, a working iteration, then its subsection.
      if (url.pathname === '/api/projects/flow' && req.method === 'POST') {
        const r = await createFlow(dir, figmaKey, await readJsonBody());
        void commitProject(dir, `Create flow ${r.flow.n} ${r.flow.name}`);
        broadcastLive();
        return json(r);
      }
      if (url.pathname === '/api/projects/iteration/sections' && req.method === 'POST') {
        if (!figmaKey) return json({ error: 'This folder has no Figma file' }, 400);
        const body = await readJsonBody();
        const r = await makeSectionsFor(dir, figmaKey, String(body?.id ?? ''), Array.isArray(body?.flows) ? body.flows.map(String) : null);
        broadcastLive();
        return json(r);
      }
      if (url.pathname === '/api/projects/iteration/flow' && req.method === 'POST') {
        if (!figmaKey) return json({ error: 'This folder has no Figma file' }, 400);
        const body = await readJsonBody();
        const r = await addFlowToIteration(dir, figmaKey, String(body?.id ?? ''), String(body?.slug ?? ''));
        broadcastLive();
        return json(r);
      }
      // A project, flow or iteration selected in the sidebar with no chat for it: its screens from the cached map, the
      // review runs of an iteration's flow folders, and a flow check scoped to the iteration (kept in <root>/iterations/<id>).
      const sel = { flow: url.searchParams.get('flow') || undefined, iteration: cleanId(url.searchParams.get('iteration') ?? '') ?? undefined };
      if (url.pathname === '/api/projects/view') {
        const project = await readProject(dir);
        if (!project || !figmaKey) return json({ groups: [], readAt: null });
        const map = await cachedMap(projectRoot(dir), figmaKey).catch(() => null);
        return json({ groups: selectionView(project, map, sel), readAt: map?.readAt ?? null });
      }
      if (url.pathname === '/api/projects/reviews') {
        const project = await readProject(dir);
        return json({ flows: project && sel.iteration ? await iterationReviews(projectRoot(dir), project, sel.iteration) : [] });
      }
      if (url.pathname === '/api/projects/flowcheck') {
        if (!sel.iteration) return json({ error: 'Name an iteration' }, 400);
        const at = projectIterationDir(projectRoot(dir), sel.iteration);
        if (req.method !== 'POST') return json({ runs: await readFlowChecks(at) });
        if (!figmaKey) return json({ error: 'This folder has no Figma file' }, 400);
        return json({ run: await runFlowCheck({ dir: at, fileKey: figmaKey, iteration: sel.iteration }) });
      }
      // Remove project moves the folder to .trash (nothing deleted, Figma untouched); rename fixes the working sections' names.
      if (url.pathname === '/api/projects/remove' && req.method === 'POST') {
        if (!asked || file?.key === SAMPLE_KEY || (!file && !(await readProject(dir)))) return json({ error: 'Only a project folder can be removed' }, 400);
        const r = await removeProject(dir, { stopTasks: (root) => tasks.forget(root), closeChats: closeChatsIn });
        broadcastLive();
        return json(r);
      }
      // Rename project changes only the name in project.json; the folder keeps its name. (/rename is the sections.)
      if (url.pathname === '/api/projects/name' && req.method === 'POST') {
        if (!asked) return json({ error: 'Name the project' }, 400);
        const r = await renameProject(dir, (await readJsonBody())?.name);
        void commitProject(dir, `Rename project ${r.from} to ${r.name}`);
        broadcastLive();
        return json(r);
      }
      if (url.pathname === '/api/projects/rename' && req.method === 'POST') {
        if (!figmaKey) return json({ error: 'This folder has no Figma file' }, 400);
        return json(await renameToConvention(dir, figmaKey));
      }
    }
    if (url.pathname === '/api/figma/folders') return json(await Promise.all((await chatFolders()).filter((f) => f.figma).map(async (f) => ({ cwd: f.dir, ...f.figma, stage: await projectLabel(f.dir, await readProject(f.dir)).catch(() => null) }))));
    // Saved on disk per chat: only a missing outline or ?fresh=1 reads the file again.
    if (url.pathname === '/api/figma/outline') {
      const fresh = url.searchParams.get('fresh') === '1';
      if (fresh) refreshMapSoon(chat.cwd, needFigma().key);
      return json(await fileOutline(chat.cwd, needFigma().key, { fresh }));
    }
    if (url.pathname === '/api/figma/thumbs') {
      const rev = Number(url.searchParams.get('r') ?? 0) || 0;
      return json(await thumbs(chat.cwd, needFigma().key, (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map((id) => [id, rev])));
    }
    if (url.pathname === '/api/figma/show' && req.method === 'POST') {
      const f = needFigma();
      // The plugin runs in the file, so it is open in the Figma app: that window comes forward.
      if (pluginFor(f.key, f.name)) {
        showFigmaApp();
        return json({ app: true });
      }
      return json({ tab: await showFigma(f.key, f.url) });
    }
    if (url.pathname === '/api/figma/focus' && req.method === 'POST') {
      const { nodeId } = await readJsonBody();
      return json({ result: await focusNode(needFigma(), String(nodeId), true) });
    }
    if (url.pathname === '/api/buildcheck') return json({ runs: await readBuildChecks(chat.cwd) });
    if (url.pathname === '/api/flowcheck' && req.method === 'POST') {
      // A flow chat checks its own iteration's section; other chats check the whole file.
      const ctx = await chatContext(chat.cwd).catch(() => null);
      return json({ run: await runFlowCheck({ dir: chat.cwd, fileKey: needFigma().key, ...(ctx?.scope === 'flow' && ctx.iteration ? { iteration: ctx.iteration.id } : {}) }) });
    }
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
      if (url.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="${reportSlug(figma)}-handoff-report.html"`;
      // Frame names from the saved outline, so findings and frames never show as raw layer ids. The report never reads Figma.
      const saved = figma ? await cachedOutline(chat.cwd, figma.key) : null;
      const names: Record<string, string> = Object.fromEntries((saved?.pages ?? []).flatMap((p) => p.frames.map((f) => [f.id, f.name])));
      res.writeHead(200, headers);
      return void res.end(await buildReport(chat.cwd, figma, summary(chat).title, names));
    }
    if (url.pathname === '/api/review') return json(await readReview(chat.cwd));
    if (url.pathname === '/api/design') return json(await readDesign(chat.cwd));
    if (url.pathname === '/api/design-system') {
      if (req.method !== 'POST') return json(await readProfile(chat.cwd));
      const body = await readJsonBody();
      const r = await changeDesignSystem(chat.cwd, chat.state.session.figma, body);
      // A starter sets this chat's review areas (Lo-fi reviews flow and copy only); removing the profile gives the default back.
      const action = (body as { action?: unknown } | null)?.action;
      if (action === 'starter' || action === 'clear') chat.useProfileAreas(r.ds);
      return json(r);
    }
    if (url.pathname === '/api/design-system/view') return json(await designSystemView(chat.cwd));
    if (url.pathname.startsWith('/api/chat-file/')) {
      // Project files (thumbs, the map cache) sit at the project root, a flow chat's own files in its folder.
      const rel = decodeURIComponent(url.pathname.slice('/api/chat-file/'.length));
      const file = inside(chat.cwd, rel) ?? inside(projectRoot(chat.cwd), rel);
      const data = file && (await readFile(file).catch(() => null));
      if (!data) return json({ error: 'Not found' }, 404);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(data);
    }
    if (url.pathname === '/api/mcp/config') return json(await mcpConfig(chat.cwd));
    if (url.pathname === '/api/mcp/probe') return json(await mcpProbe(chat.cwd, url.searchParams.has('refresh')));
    if (url.pathname === '/api/sessions') {
      const list = await listSessions({ limit: 300 });
      return json(list.filter((x) => x.cwd && designSession(x.cwd)).map((x) => ({ sessionId: x.sessionId, title: x.summary, cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified })));
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
    json({ error: err instanceof Error ? err.message : String(err) }, err instanceof FigmaError || err instanceof AttachError || err instanceof ProjectError ? err.status : err instanceof HistoryError ? 409 : 500);
  }
});

// The Design Studio plugin's window in the Figma app has no origin of its own ("null"). It may only open the plugin
// socket, on this computer, and that socket carries node ids and views, never code.
function pluginFromFigma(req: http.IncomingMessage) {
  const origin = req.headers.origin;
  if (origin !== 'null' && origin !== 'https://www.figma.com') return false;
  const url = new URL(req.url ?? '', 'http://x');
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return url.pathname === '/ws' && url.searchParams.has('figma-plugin') && [...url.searchParams.keys()].length === 1 && ['localhost', '127.0.0.1'].includes(host);
}

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }, done) => (allowedOrigin(req.headers.origin) || pluginFromFigma(req) ? done(true) : done(false, 403, 'Forbidden')),
});

wss.on('connection', (ws: WebSocket, req) => {
  const params = new URL(req.url ?? '', 'http://x').searchParams;
  const term = params.get('term');
  if (term !== null) return attachTerminal(ws, term);
  if (params.has('chrome')) return openChrome(ws, req.headers.origin);
  if (params.has('figma-plugin')) return openFigmaPlugin(ws, { moved: pauseFollow, changed: () => { forgetView(); sendFollowState(); }, page: sendFollowState, edited: followChanged });
  if (params.has('figma-app')) return openFigmaApp(ws, params.has('embed'));
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
        chat.answerQuestion(msg.id, msg.answers, typeof msg.response === 'string' ? msg.response : undefined);
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
      case 'set_edits_anywhere':
        chat.setEditsAnywhere(Boolean(msg.on));
        break;
      case 'set_brainstorm':
        chat.setBrainstorm(Boolean(msg.on));
        break;
      case 'brainstorm_build':
        chat.buildOption(Number(msg.round), Number(msg.option)).catch(fail);
        break;
      case 'selection':
        void focusSelection(msg);
        break;
      case 'set_flow':
        chat.updateFlow(msg.patch ?? {});
        break;
      case 'new_chat':
        (msg.url?.trim() ? chatForUrl(msg.url) : freshChatFolder().then(createChat)).then((c) => view(client, c), fail);
        break;
      case 'set_figma': {
        const url = String(msg.url ?? '').trim();
        const attach = !chat.figmaFile && isChatFolder(chat.cwd) && path.resolve(chat.cwd) !== path.resolve(CHATS_ROOT, 'scratch');
        // A chat in a project made with New project links the file to the project's own folder, not the chat's.
        const root = projectRoot(chat.cwd);
        if (!attach) chatForUrl(url).then((c) => view(client, c), fail);
        else if (existsSync(path.join(root, 'project.json')) && !existsSync(path.join(root, 'figma.json'))) linkFile(root, { url }).then((f) => fileLinked(root, f), fail);
        else attachFolder(chat.cwd, url).then((f) => (chat.setFigma(f), refreshOutlineSoon(chat.cwd, f.key), broadcastLive()), fail);
        break;
      }
      case 'interrupt':
        void chat.interrupt();
        break;
      case 'long_run_start':
        void chat.startLongRun(String(msg.text ?? ''), Number(msg.until), Number(msg.cap), msg.images, { weeklyCap: msg.weeklyCap, rounds: msg.rounds });
        break;
      case 'long_run_options':
        chat.setLongRunOptions({ weeklyCap: msg.weeklyCap, rounds: msg.rounds });
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
        newChat(msg.cwd ?? chat.cwd, chat, msg.flow, msg.iteration, msg.brainstorm === true).then((c) => view(client, c), fail);
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
  // The Figma window helper is built here when it is missing or older than its source, so a restart is enough.
  void ensureHelper();
});
