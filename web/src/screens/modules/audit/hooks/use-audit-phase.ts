import {useEffect, useState} from 'react';
import {phaseFor, type ProgressStatus} from '../phase';

export const TICK_MS = 1_000;

export const useAuditPhase = (status: ProgressStatus, startedAt: number | null, active: boolean): string | null => {
  const [now, setNow] = useState(() => Date.now());
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [seenStatus, setSeenStatus] = useState(status);

  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status === 'running') {
      setRunningSince(now);
    }
  }

  const since = runningSince ?? startedAt;

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return (): void => {
      clearInterval(timer);
    };
  }, [active]);

  if (!active || since === null) {
    return null;
  }

  return phaseFor(status, now - since);
};
