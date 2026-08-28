import {useEffect, useState} from 'react';

export const NOW_TICK_MS = 30_000;

export const useNow = (tickMs: number = NOW_TICK_MS): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, tickMs);

    return (): void => {
      clearInterval(timer);
    };
  }, [tickMs]);

  return now;
};
