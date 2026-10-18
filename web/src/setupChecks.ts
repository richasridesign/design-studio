import { getJson, postJson } from './store';
import type { McpServer } from '../../shared/protocol';

export type Tone = 'idle' | 'checking' | 'ok' | 'warn' | 'bad';
/** One numbered step of a fix. `cmd` is text she types, shown with a Copy button. */
export type Step = { text: string; cmd?: string; after?: string };
export type CheckResult = { tone: 'ok' | 'warn' | 'bad'; detail: string; fix?: string; steps?: Step[]; fixLabel?: string; fixId?: string };
export type CheckId = 'figma' | 'mcp' | 'chrome' | 'claude';

export const CHECK_IDS: CheckId[] = ['figma', 'mcp', 'chrome', 'claude'];
export const CHECK_TITLES: Record<CheckId, string> = {
  figma: 'Figma token',
  mcp: 'Figma plugin in Claude',
  chrome: 'Figma tab in Chrome',
  claude: 'Claude sign-in',
};

/** Why Design Studio cannot see Chrome, in plain words. The Figma tab and Check setup both use these. */
export const CHROME_REASONS: Record<string, string> = {
  nofda: 'macOS needs your OK before Design Studio can find Chrome',
  nochrome: 'Chrome is not open',
  disabled: 'Chrome has not let Design Studio see your tabs yet',
  denied: 'Chrome said no when Design Studio asked to see your tabs',
  timeout: 'Chrome did not answer in time',
  closed: 'Design Studio lost its link to Chrome',
  server: 'The Design Studio server is not reachable',
};

/** The label of the button on the Figma tab that asks Chrome. Server errors point at it too. */
export const ALLOW_CHROME = 'Allow in Chrome';
/** The exact checkbox Chrome shows: she has to find it by this text. */
export const CHROME_CHECKBOX = 'Allow remote debugging for this browser instance';

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
    if (row.status === 'connected') return { tone: 'ok', detail: 'Figma plugin: Connected. Claude can edit your file.' };
    if (row.status === 'needs-auth') return { tone: 'warn', detail: 'Figma plugin: Needs login', fix: 'Log in once from the terminal. How to log in shows each step.', fixLabel: 'How to log in', fixId: 'figma-login' };
    return { tone: 'bad', detail: `Figma plugin: Not connected${row.error ? ` (${row.error})` : ''}`, fix: 'Add the Figma plugin to Claude again, then log in once.', fixLabel: 'Add Figma plugin', fixId: 'add-mcp' };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

const CHROME_FIX: Record<string, string> = {
  nofda: 'In System Settings, give Design Studio Full Disk Access: drag Design Studio from the Finder window into the list and turn it on.',
  disabled: `On the Figma tab, press ${ALLOW_CHROME}. In Chrome, tick "${CHROME_CHECKBOX}", then click Allow.`,
  nochrome: `Open Chrome, then press ${ALLOW_CHROME} on the Figma tab.`,
};

async function chrome(): Promise<CheckResult> {
  try {
    const c = await getJson<{ state: string; reason: string }>('/api/chrome/status');
    if (c.state === 'on') return { tone: 'ok', detail: 'Design Studio can see your Figma tab in Chrome' };
    return { tone: 'bad', detail: CHROME_REASONS[c.reason] ?? 'Design Studio cannot see Chrome yet', fix: CHROME_FIX[c.reason] ?? `Open the Figma tab and press ${ALLOW_CHROME}.`, fixLabel: 'Open Figma tab', fixId: 'open-figma' };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

async function claude(): Promise<CheckResult> {
  try {
    const r = await getJson<{ ok: boolean; detail: string }>('/api/claude/status');
    if (r.ok) return { tone: 'ok', detail: r.detail };
    return { tone: 'bad', detail: r.detail, fix: 'Sign in to Claude once from the terminal:', steps: [{ text: 'Open Terminal and run', cmd: 'claude' }, { text: 'Type', cmd: '/login', after: 'and sign in in the browser window that opens.' }, { text: 'Come back here and press Check.' }] };
  } catch (e) {
    return { tone: 'bad', detail: msg(e), fix: 'Make sure the Design Studio server is running.' };
  }
}

export const CHECKS: Record<CheckId, () => Promise<CheckResult>> = { figma, mcp, chrome, claude };

export const addFigmaToClaude = () => postJson('/api/figma/mcp', {});
