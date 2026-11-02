import { useEffect, useState } from 'react';

/** Goes to another screen and keeps the scenario. */
export function navigate(route: string) {
  history.pushState(null, '', route + location.search);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return path;
}
