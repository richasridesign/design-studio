import { cleanReading, publishMoved, type PublishReading } from '../../shared/portfolio.js';

// Framer in Richa's signed-in Chrome: how every past portfolio edit was made (no key, no Framer AI). Design Studio
// only reads tab addresses here. Reading the Publish panel, reading a rendered page and the edits themselves need a
// browser tool the portfolio chat can reach; which one (Design Studio's CDP mirror in chrome.ts, or the Claude in
// Chrome extension tools) is the Phase 0 question, so those are injected and the real ones say they wait for it.

export class BrowserPending extends Error {
  constructor() {
    super('Editing Framer in Chrome waits for the Phase 0 check of the browser tool. Use the copy pack for now.');
  }
}

export type FramerBrowser = {
  /** Open tabs (address, title, last active), read only. */
  tabs(): Promise<Array<{ url: string; title: string; at: number }>>;
  /** The Publish panel of the project, as { lastPublishedAt, changed, warnings }. */
  readPublish(project: string): Promise<unknown>;
  /** Visible text of a rendered page, for a client-rendered site a plain GET reads empty. */
  pageText(url: string): Promise<string>;
};

/** True once Phase 0 wires a real browser tool. Until then the run offers the copy pack only. */
export const CHROME_EDITS_READY = false;

export const pendingBrowser: FramerBrowser = {
  tabs: async () => {
    if (process.env.VITEST) throw new Error('Tests must not reach Chrome');
    const chrome = await import('./chrome.js');
    if (chrome.chromeStatus().state !== 'on') await chrome.connect();
    return chrome.chromeStatus().state === 'on' ? chrome.tabList() : [];
  },
  readPublish: async () => {
    throw new BrowserPending();
  },
  pageText: async () => {
    throw new BrowserPending();
  },
};

/** The project id in a Framer project link: https://framer.com/projects/<name>--<id>?... */
export const projectId = (url: string) => /framer\.com\/projects\/([^/?#]+)/.exec(url)?.[1] ?? null;

/**
 * Is the project open in her Chrome, signed in? A signed-out Framer tab lands on a login page, so the project address
 * itself is the signal. Only addresses are read, never page content.
 */
export function framerTabState(tabs: Array<{ url: string; title: string; at: number }>, project: string): { ok: boolean; reason?: string } {
  const id = projectId(project);
  if (!id) return { ok: false, reason: 'This is not a Framer project link' };
  const framer = tabs.filter((t) => /^https:\/\/(www\.)?framer\.com\//.test(t.url));
  if (framer.some((t) => projectId(t.url) === id)) return { ok: true };
  if (framer.some((t) => /\/(login|signup|sign-in)/.test(t.url))) return { ok: false, reason: 'Framer in your Chrome is signed out. Sign in, then check again.' };
  return { ok: false, reason: 'Chrome is not showing this Framer project. Open it there, signed in.' };
}

export async function checkChrome(browser: FramerBrowser, project: string) {
  try {
    return framerTabState(await browser.tabs(), project);
  } catch {
    return { ok: false, reason: 'Design Studio cannot see Chrome yet. Open Chrome, then check again.' };
  }
}

export async function readPublish(browser: FramerBrowser, project: string, at: number): Promise<PublishReading> {
  const r = cleanReading(await browser.readPublish(project), at);
  if (!r) throw new Error('Could not read the Publish panel in Framer');
  return r;
}

/**
 * Re-reads the Publish panel while edits run and calls onMoved once if a publish happened (an unexplained publish
 * mid-edit happened on 18 Oct). Returns a stop function.
 */
export function watchPublish(browser: FramerBrowser, project: string, before: PublishReading, every: number, onMoved: (after: PublishReading) => void, now = () => Date.now()): () => void {
  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const after = await readPublish(browser, project, now());
      if (!stopped && publishMoved(before, after)) {
        stopped = true;
        clearInterval(timer);
        onMoved(after);
      }
    } catch {
      // A failed reading is checked again after the run.
    } finally {
      busy = false;
    }
  }, every);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
