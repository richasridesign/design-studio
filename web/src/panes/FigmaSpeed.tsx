import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../Icon';

// How fast Figma calls are in this chat. Through Design Studio's plugin a script takes well under a second; without
// it, chats fall back to the Figma MCP, which took 5.6 s (median) and up to 40 s a call on her files.

/** Above the composer: Figma calls are on the slow path because no plugin runs in the chat's file. */
export function FigmaSpeedLine() {
  const file = useStore((s) => s.session.figma);
  const fast = useStore((s) => s.session.figmaFast);
  if (!file || fast !== false) return null;
  return (
    <div className="ctx-line figma-slow" role="status">
      <Icon name="warning" small />
      <span>Figma is slow in this chat: the Design Studio plugin is not running in {file.name}. Open it in the Figma tab, or start the plugin in the Figma app.</span>
    </div>
  );
}

const FAST = /^mcp__designstudio__(use_figma|get_screenshot)$/;
const SLOW = /^mcp__(?!designstudio__).*figma.*__(use_figma|get_screenshot|get_design_context|get_metadata)$/i;

/** What a running Figma call should take, by the path it went: null for other tools. */
export function expectedTime(tool: string) {
  if (FAST.test(tool)) return 'usually under 1s';
  if (SLOW.test(tool)) return 'Figma MCP, usually 5 to 40s';
  return null;
}

/** Seconds since `since`, ticking once a second while `on`. */
export function useElapsed(since: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return Math.max(0, Math.floor((now - since) / 1000));
}
