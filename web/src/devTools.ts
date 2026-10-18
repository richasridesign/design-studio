import { useEffect, useState } from 'react';
import { getJson } from './store';

/** Whether the Developer tools setting is on. Updates when Settings saves. */
export function useDevTools() {
  const [dev, setDev] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => getJson<{ devTools?: boolean }>('/api/settings').then((s) => { if (live) setDev(!!s?.devTools); }).catch(() => {});
    void load();
    window.addEventListener('designstudio:settings', load);
    return () => { live = false; window.removeEventListener('designstudio:settings', load); };
  }, []);
  return dev;
}
