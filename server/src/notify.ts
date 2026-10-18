import { execFile } from 'node:child_process';
import path from 'node:path';
import type { LiveChat, ServerMessage } from '../../shared/protocol.js';

const last = new Map<string, number>();

function detail(m: ServerMessage) {
  if (m.type === 'pending') return m.request.kind === 'question' ? m.request.questions[0]?.question ?? 'Claude has a question' : m.request.title;
  if (m.type === 'event' && m.event.kind === 'result') return m.event.text.trim().split('\n')[0] || 'Turn ended';
  return null;
}

export function notifyAway(m: ServerMessage, away: () => LiveChat | null) {
  const body = detail(m);
  if (body === null || process.platform !== 'darwin') return;
  const chat = away();
  if (!chat || Date.now() - (last.get(chat.id) ?? 0) < 30_000) return;
  last.set(chat.id, Date.now());
  const title = `Claude ${m.type === 'pending' ? 'needs you' : 'finished'} in ${path.basename(chat.cwd)}`;
  const script = 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name "Glass"';
  execFile('osascript', ['-e', 'on run argv', '-e', script, '-e', 'end run', title, chat.title, body.slice(0, 200)], () => {});
}
