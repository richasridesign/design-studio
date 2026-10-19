import { useEffect, useState } from 'react';
import { getJson } from '../store';
import type { Task } from '../../../shared/tasks';

// The tasks the sidebar and the task card show. Loaded on open and when a task changes; polled every 3 seconds
// while one is running, since a task moves on its own when its chats finish.

export type TaskList = { tasks: Task[]; weeklyPct: number | null; cap: number; parallel: number };

export const TASKS_CHANGED = 'designstudio:tasks';
export const tasksChanged = () => window.dispatchEvent(new Event(TASKS_CHANGED));

const POLL_MS = 3000;
const EMPTY: TaskList = { tasks: [], weeklyPct: null, cap: 70, parallel: 3 };

export function useTasks(): TaskList {
  const [list, setList] = useState<TaskList>(EMPTY);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      getJson<TaskList>('/api/tasks')
        .then((r) => {
          if (!alive) return;
          setList(r);
          if (r.tasks.some((t) => t.state === 'running')) timer = setTimeout(load, POLL_MS);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(TASKS_CHANGED, load);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener(TASKS_CHANGED, load);
    };
  }, []);
  return list;
}

/** Weekly usage as the dialogs say it. */
export function weeklyLine(pct: number | null, cap: number): { text: string; blocked: boolean } {
  if (pct === null) return { text: `Weekly usage: not known yet. Runs pause at ${cap}%.`, blocked: false };
  const p = Math.round(pct);
  if (p >= cap) return { text: `Weekly usage is at ${p}%, at or above the ${cap}% cap. Runs across flows wait until it drops.`, blocked: true };
  return { text: `Weekly usage: ${p}%. Runs pause at ${cap}%.`, blocked: false };
}
