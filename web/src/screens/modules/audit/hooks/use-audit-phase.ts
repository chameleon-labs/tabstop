import {useEffect, useState} from 'react';
import {phaseFor, type ProgressStatus} from '../phase';

export const TICK_MS = 1_000;

export const useAuditPhase = (status: ProgressStatus, startedAt: number | null, active: boolean): string | null => {
  const [now, setNow] = useState(() => Date.now());
  const [ticks, setTicks] = useState(0);
  const [seenStatus, setSeenStatus] = useState(status);
  const [observedStart, setObservedStart] = useState(false);

  if (status !== seenStatus) {
    setSeenStatus(status);
    setTicks(0);
    setObservedStart(status === 'running');
  }

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timer = setInterval(() => {
      setTicks((current) => current + 1);
      setNow(Date.now());
    }, TICK_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [active]);

  const elapsedMs = elapsedFor({observedStart, ticks, now, startedAt});

  if (!active || elapsedMs === null) {
    return null;
  }

  return phaseFor(status, elapsedMs);
};

const elapsedFor = ({
  observedStart,
  ticks,
  now,
  startedAt,
}: {
  observedStart: boolean;
  ticks: number;
  now: number;
  startedAt: number | null;
}): number | null => {
  if (observedStart) {
    return ticks * TICK_MS;
  }

  return startedAt === null ? null : now - startedAt;
};
