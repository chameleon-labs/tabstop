import {useEffect, useState} from 'react';
import {useNavigation} from 'react-router';

export const ROUTE_BUSY_DELAY_MS = 200;

export const useRouteBusy = (delayMs: number = ROUTE_BUSY_DELAY_MS): boolean => {
  const {state} = useNavigation();
  const navigating = state !== 'idle';
  const [busy, setBusy] = useState(false);
  const [tracked, setTracked] = useState(navigating);

  if (tracked !== navigating) {
    setTracked(navigating);
    setBusy(false);
  }

  useEffect(() => {
    if (!navigating) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setBusy(true);
    }, delayMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [navigating, delayMs]);

  return busy && navigating;
};
