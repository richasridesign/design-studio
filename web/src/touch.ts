import { useEffect, useState } from 'react';

export const touch = () => matchMedia('(pointer: coarse)').matches;

const NARROW = '(max-width: 900px)';
export const narrowNow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches;

/** Phone layout: the same 900px break as mobile.css. Updates when the window crosses it. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    const m = matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
