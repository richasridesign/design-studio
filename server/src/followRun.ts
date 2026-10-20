import type { FollowResult, FollowView } from './follow.js';
import { loadedSettings } from './settings.js';
import { markStalled, pluginEditing, pluginFiles, pluginFollow, pluginFor, pluginForget } from './figmaPlugin.js';

// Follow Claude in Figma, whichever way her Figma is reached: the Design Studio plugin in the Figma app when it runs
// in the chat's file, else a Figma tab in Chrome over CDP (chrome.ts registers that way). One move at a time, only
// the newest waits, moves at least FOLLOW_GAP apart, and each file pauses on its own when she moves the view.

export type FollowOnce = (fileKey: string, ids: string[], last: FollowView | null, start: boolean) => Promise<FollowResult | string>;

/** `editing`: Claude is editing this file now, so the changes the plugin sees land there are his and are followed. */
type Follow = { paused: boolean; last: FollowView | null; ids: string[]; name?: string; editing: boolean; editTimer?: ReturnType<typeof setTimeout> };
const follows = new Map<string, Follow>();
const followOf = (fileKey: string) => {
  let f = follows.get(fileKey);
  if (!f) follows.set(fileKey, (f = { paused: false, last: null, ids: [], editing: false }));
  return f;
};

let cdpOnce: FollowOnce = async () => 'nochrome';
let chromeShown = () => false;
const senders = new Set<(m: object) => void>();
const broadcast = (m: object) => senders.forEach((send) => send(m));
/**
 * chrome.ts hands over its CDP follow, the way to reach the Chrome mirror's viewers, and whether anyone looks at
 * that mirror: the Chrome tab is only followed while it is the shown view, never as a silent fallback.
 */
export function useChromeFollow(once: FollowOnce, send: (m: object) => void, shown: () => boolean = () => true) {
  cdpOnce = once;
  chromeShown = shown;
  senders.add(send);
}
/** Another set of Figma tab viewers (the Figma app) that shows the follow state. */
export const addFollowViewers = (send: (m: object) => void) => senders.add(send);

/** Design Studio moved or reloaded her Figma view itself: the next follow must not read the new view as her move. */
export const forgetView = (fileKey?: string) => follows.forEach((f, k) => { if (!fileKey || k === fileKey) f.last = null; });

let following = false;
let nextFollow: { fileKey: string; ids: string[]; start: boolean } | null = null;
/** At most one move per this many ms, so each screen stays long enough to see. */
export const FOLLOW_GAP = 1500;
/** Edits come in bursts: each move waits this long first, so a newer edit in that window wins over the one before. */
export const FOLLOW_SETTLE = 300;

/**
 * What the Figma tab header shows: whether the setting is on, the files she paused following in, and the files the
 * Design Studio plugin is running in, with the page it shows (key is null until the file is matched by its name).
 */
export function followState() {
  const on = loadedSettings().followClaude;
  const paused = [...follows].filter(([, f]) => f.paused).map(([k]) => k);
  // Following only when the setting is on and she has not paused it in that file.
  const plugins = pluginFiles().map((p) => ({ key: p.key, name: p.name, page: p.page, following: on && !!p.key && !paused.includes(p.key), stalled: p.stalled }));
  return { t: 'follow', on, paused, plugins };
}

export const sendFollowState = () => {
  follows.forEach((_, k) => syncEditing(k));
  broadcast(followState());
};

/** Changes still landing after an edit script ended count as Claude's for this long. */
export const EDIT_TAIL = 4000;
/** An edit that never reports its end stops counting after this long, so her own edits cannot move her view for good. */
export const EDIT_MAX = 180_000;

/**
 * Claude started (on) or finished (off) a Figma edit in this file. While on, the plugin sends the changes it sees land
 * in the file and the view follows them as a long script builds, not once at its end. Off waits EDIT_TAIL first.
 */
export function setEditing(fileKey: string, on: boolean, name?: string) {
  const f = followOf(fileKey);
  if (name) f.name = name;
  clearTimeout(f.editTimer);
  if (on) f.editing = true;
  f.editTimer = setTimeout(() => {
    f.editing = false;
    syncEditing(fileKey);
  }, on ? EDIT_MAX : EDIT_TAIL);
  f.editTimer.unref?.();
  syncEditing(fileKey);
}

/** Tells the file's plugin whether to send its changes: only while Claude edits there and following is on. */
function syncEditing(fileKey: string) {
  const f = follows.get(fileKey);
  if (!f) return;
  const plugin = pluginFor(fileKey, f.name);
  if (plugin) pluginEditing(plugin, f.editing && !f.paused && loadedSettings().followClaude);
}

/** Nodes the plugin saw change in this file. Followed only while Claude edits it, so her own edits never move her view. */
export function followChanged(fileKey: string, ids: string[]) {
  const f = follows.get(fileKey);
  if (!f?.editing || f.paused || !ids.length || !loadedSettings().followClaude) return;
  void followFigma(fileKey, ids, false, f.name);
}

export function pauseFollow(fileKey: string) {
  const f = followOf(fileKey);
  if (f.paused) return;
  f.paused = true;
  if (nextFollow?.fileKey === fileKey) nextFollow = null;
  sendFollowState();
}

/** She clicked Follow Claude: following starts again from where Claude is now, and her own view is not a reason to stop. */
export function resumeFollow(fileKey: string) {
  const f = followOf(fileKey);
  f.paused = false;
  f.last = null;
  const plugin = pluginFor(fileKey, f.name);
  if (plugin) pluginForget(plugin);
  sendFollowState();
  if (f.ids.length) void followFigma(fileKey, f.ids, false, f.name);
}

/**
 * Moves her Figma view to what Claude is editing. Edits come fast, so one move runs at a time, only the newest waits,
 * and moves are at least FOLLOW_GAP apart. Each move waits FOLLOW_SETTLE first, so a burst of edits moves once,
 * to the newest. `start`: the edit is starting, so its section alone is not worth a move.
 * `name`: the file's name, to find the plugin when Figma does not tell it the file's key.
 */
export async function followFigma(fileKey: string, ids: string[], start = false, name?: string) {
  const f = followOf(fileKey);
  f.ids = ids;
  if (name) f.name = name;
  if (f.paused) return;
  nextFollow = { fileKey, ids, start };
  if (following) return;
  following = true;
  try {
    while (nextFollow) {
      await sleep(FOLLOW_SETTLE);
      if (!nextFollow) break;
      const job: { fileKey: string; ids: string[]; start: boolean } = nextFollow;
      nextFollow = null;
      const jf = followOf(job.fileKey);
      if (jf.paused) continue;
      const result = await followOnce(job.fileKey, job.ids, jf.last, job.start, jf.name);
      note(job.fileKey, typeof result === 'string' ? result : result.status === 'moved' ? 'paused, she moved the view' : result.status === 'stalled' ? 'stalled: the plugin runs but Figma does not answer it, the file is not the front tab in Figma' : `${result.status} through the plugin`);
      if (typeof result === 'string') continue;
      if (result.status === 'moved') pauseFollow(job.fileKey);
      else if (result.view) jf.last = result.view;
      if (typeof result !== 'string' && result.status === 'ok') await sleep(FOLLOW_GAP);
    }
  } finally {
    following = false;
  }
}

/** The plugin in the Figma app when it runs in this file, else the Chrome tab while that is the shown view. */
export function followOnce(fileKey: string, ids: string[], last: FollowView | null, start: boolean, name?: string) {
  const plugin = pluginFor(fileKey, name);
  if (plugin) {
    return pluginFollow(plugin, ids, last, start).then((r) => {
      // No answer at all (an older plugin build) counts as stalled too: the plugin is there, Figma is not answering it.
      const stalled = typeof r === 'string' ? r.startsWith('failed: the plugin did not answer') : r.status === 'stalled';
      if (markStalled(plugin, stalled)) sendFollowState();
      return r;
    });
  }
  return chromeShown() ? cdpOnce(fileKey, ids, last, start) : Promise.resolve('noplugin: the Design Studio plugin is not running in this file');
}

/** One log line per change of outcome per file, so edits that follow fine (or keep failing alike) do not fill the log. */
const noted = new Map<string, string>();
function note(fileKey: string, what: string) {
  if (noted.get(fileKey) === what) return;
  noted.set(fileKey, what);
  console.log(`follow in Figma: ${what}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
