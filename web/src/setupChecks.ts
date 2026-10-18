import { getJson, postJson } from './store';
import type { McpServer } from '../../shared/protocol';

export type Tone = 'idle' | 'checking' | 'ok' | 'warn' | 'bad';
export type CheckResult = { tone: 'ok' | 'warn' | 'bad'; detail: string; fix?: string; fixLabel?: string; fixId?: string };
export type CheckId = 'figma' | 'mcp' | 'chrome' | 'claude';

export const CHECK_IDS: CheckId[] = ['figma', 'mcp', 'chrome', 'claude'];
export const CHECK_TITLES: Record<CheckId, string> = {
  figma: 'Figma token',
  mcp: 'Figma tools in Claude',
  chrome: 'Chrome',
  claude: 'Claude CLI',
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function figma(): Promise<CheckResult> {
  try {
    const m = await getJson<{ handle: string; email: string }>('/api/figma/me');
    return { tone: 'ok', detail: `Signed in as ${m.handle} (${m.email})` };
  } catch (e) {
    const err = msg(e);
    return { tone: 'bad', detail: err, fix: 'Add a personal access token above, then save.' };
  }
}

async function mcp(): Promise<CheckResult> {
  try {
    const config = await getJson<{ name: string }[]>('/api/mcp/config');
    if (!config.some((c) => /figma/i.test(c.name))) {
      return { tone: 'bad', detail: 'The Figma plugin is not installed in Claude', fix: 'Add the Figma plugin to Claude, then sign in once.', fixLabel: 'Add Figma plugin', fixId: 'add-mcp' };
    }
    const rows = await getJson<McpServer[]>('/api/mcp/probe?refresh=1');
    const row = rows.find((r) => /figma/i.test(r.name));
    if (!row) return { tone: 'bad', detail: 'Figma did not answer the check', fix: 'Run the check again.' };
    if (row.status === 'connected') return { tone: 'ok', detail: `Figma tools connected${row.tools ? `, ${row.tools.length} tools` : ''}` };
    if (row.status === 'needs-auth') return { tone: 'warn', detail: 'The Figma plugin needs you to log in', fix: 'Run claude in a terminal, type /mcp and pick plugin:figma:figma.' };
    return { tone: 'bad', detail: row.error ?? `Figma tools: ${row.status}`, fix: 'Check the Figma entry on the MCP page, or add Figma to Claude again.', fixLabel: 'Add Figma plugin', fixId: 'add-mcp' };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

const CHROME_FIX: Record<string, string> = {
  nofda: 'Grant Full Disk Access to DesignStudio.app: drag Design Studio from the Finder window into the Full Disk Access list and turn it on.',
  disabled: 'Start Chrome with remote debugging enabled: in Chrome, tick "Allow remote debugging for this browser instance", then click Allow.',
  nochrome: 'Open Chrome, then start it with remote debugging enabled.',
};

async function chrome(): Promise<CheckResult> {
  try {
    const c = await getJson<{ state: string; reason: string }>('/api/chrome/status');
    if (c.state === 'on') return { tone: 'ok', detail: 'Chrome is connected' };
    const why: Record<string, string> = { nofda: 'macOS blocks Design Studio from finding Chrome', nochrome: 'Chrome is not running', disabled: 'Chrome is running, but remote debugging is off', denied: 'Chrome refused the connection', timeout: 'Chrome did not answer in time' };
    return { tone: 'bad', detail: why[c.reason] ?? 'Chrome is not connected', fix: CHROME_FIX[c.reason] ?? 'Start Chrome with remote debugging enabled, then open the Figma tab.', fixLabel: 'Open Figma tab', fixId: 'open-figma' };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

async function claude(): Promise<CheckResult> {
  try {
    const r = await getJson<{ ok: boolean; detail: string }>('/api/claude/status');
    if (r.ok) return { tone: 'ok', detail: r.detail };
    return { tone: 'bad', detail: r.detail, fix: 'Run claude in a terminal and sign in with /login (or claude auth login).' };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

export const CHECKS: Record<CheckId, () => Promise<CheckResult>> = { figma, mcp, chrome, claude };

export const addFigmaToClaude = () => postJson('/api/figma/mcp', {});
