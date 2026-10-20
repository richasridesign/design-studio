// figma.com inside the Design Studio Mac window. The app injects this into its Figma view; it acts as the Design
// Studio plugin there (agent.ts), so Follow Claude moves this view the same way it moves the Figma app. The app holds
// the socket: messages from Design Studio come in through window.__dsEmbed.recv, answers go out through the app's
// message handler. Figma's Plugin API global exists on figma.com only once a file is open for editing, so this waits.
import { agent } from './agent';

declare const window: any;

(() => {
  if (window.__dsEmbed) return;
  const post = (m: object) => { try { window.webkit.messageHandlers.dsFigma.postMessage(JSON.stringify(m)); } catch {} };
  const fileKey = () => location.pathname.match(/^\/(?:design|file)\/([A-Za-z0-9]{10,64})/)?.[1] ?? null;
  let a: ReturnType<typeof agent> | null = null;
  window.__dsEmbed = {
    recv: (m: any) => { if (a) void a.onmessage(m); },
    ready: () => a?.hello(),
  };
  const start = () => {
    const figma = window.figma;
    if (!figma || !figma.getNodeByIdAsync || !figma.root || !figma.currentPage || !fileKey()) return false;
    a = agent(figma, post, fileKey, { embed: true });
    a.hello();
    return true;
  };
  if (!start()) {
    const t = setInterval(() => { if (start()) clearInterval(t); }, 500);
  }
})();
