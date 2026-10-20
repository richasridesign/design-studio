import type { FollowResult, FollowView } from './follow.js';
import { loadedSettings } from './settings.js';
import { pluginFiles, pluginFollow, pluginFor, pluginForget } from './figmaPlugin.js';

// Follow Claude in Figma, whichever way her Figma is reached: the Design Studio plugin in the Figma app when it runs
// in the chat's file, else a Figma tab in Chrome over CDP (chrome.ts registers that way). One move at a time, only
// the newest waits, moves at least FOLLOW_GAP apart, and each file pauses on its own when she moves the view.

export type FollowOnce = (fileKey: string, ids: string[], last: FollowView | null, start: boolean) => Promise<FollowResult | string>;

type Follow = { paused: boolean; last: FollowView | null; ids: string[]; name?: string };
const follows = new Map<string, Follow>();
const followOf = (fileKey: string) => {
  let f = follows.get(fileKey);
  if (!f) follows.set(fileKey, (f = { paused: false, last: null, ids: [] }));
  return f;
};

let cdpOnce: FollowOnce = async () => 'nochrome';
const senders = new Set<(m: object) => void>();
const broadcast = (m: object) => senders.forEach((send) => send(m));
/** chrome.ts hands over its CDP follow and the way to reach the Chrome mirror's viewers. */
export function useChromeFollow(once: FollowOnce, send: (m: object) => void) {
  cdpOnce = once;
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

/**
 * What the Figma tab header shows: whether the setting is on, the files she paused following in, and the files the
 * Design Studio plugin is running in (key is null when Figma does not give the plugin the file's key).
 */
export function followState() {
  const paused = [...follows].filter(([, f]) => f.paused).map(([k]) => k);
  const plugins = pluginFiles().map((p) => ({ key: p.key, name: p.name, following: !!p.key && !paused.includes(p.key) }));
  return { t: 'follow', on: loadedSettings().followClaude, paused, plugins };
}

export const sendFollowState = () => broadcast(followState());

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
 * and moves are at least FOLLOW_GAP apart. `start`: the edit is starting, so its section alone is not worth a move.
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
      const job: { fileKey: string; ids: string[]; start: boolean } = nextFollow;
      nextFollow = null;
      const jf = followOf(job.fileKey);
      if (jf.paused) continue;
      const result = await followOnce(job.fileKey, job.ids, jf.last, job.start, jf.name);
      if (typeof result === 'string') console.log(`follow in Figma: ${result}`);
      else if (result.status === 'moved') pauseFollow(job.fileKey);
      else if (result.view) jf.last = result.view;
      if (typeof result !== 'string' && result.status === 'ok') await sleep(FOLLOW_GAP);
    }
  } finally {
    following = false;
  }
}

/** The plugin in the Figma app when it runs in this file, else the Chrome tab. */
export function followOnce(fileKey: string, ids: string[], last: FollowView | null, start: boolean, name?: string) {
  const plugin = pluginFor(fileKey, name);
  return plugin ? pluginFollow(plugin, ids, last, start) : cdpOnce(fileKey, ids, last, start);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
