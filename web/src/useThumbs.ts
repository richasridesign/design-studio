import { useEffect, useState } from 'react';
import { getJson } from './store';

const cache = new Map<string, { rev: number; url: string | null }>();

export function useThumbs(file: string | undefined, want: Array<[string, number]>) {
  const [, bump] = useState(0);
  const sig = want.map(([id, rev]) => `${id}@${rev}`).join(',');
  useEffect(() => {
    if (!file) return;
    const stale = want.filter(([id, rev]) => (cache.get(`${file}|${id}`)?.rev ?? -1) < rev);
    if (!stale.length) return;
    let live = true;
    const ids = encodeURIComponent(stale.map(([id]) => id).join(','));
    const rev = Math.max(...stale.map(([, r]) => r));
    getJson<Record<string, string | null>>(`/api/figma/thumbs?ids=${ids}&r=${rev}`)
      .then((urls) => {
        for (const [id, r] of stale) cache.set(`${file}|${id}`, { rev: r, url: urls[id] ?? null });
        if (live) bump((n) => n + 1);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [file, sig]);
  return (id: string) => (file ? cache.get(`${file}|${id}`)?.url ?? null : null);
}
