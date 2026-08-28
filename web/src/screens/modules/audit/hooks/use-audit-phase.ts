import {useEffect, useRef, useState} from 'react';
import {phaseFor, type ProgressStatus} from '../phase';

export const TICK_MS = 1_000;

export const useAuditPhase = (status: ProgressStatus, startedAt: number | null, active: boolean): string | null => {
  const [now, setNow] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [seenStatus, setSeenStatus] = useState(status);
  const [observedStart, setObservedStart] = useState(false);
  const runningFrom = useRef<number | null>(null);

  if (status !== seenStatus) {
    setSeenStatus(status);
    setElapsed(0);
    setObservedStart(status === 'running');
  }

  useEffect(() => {
    runningFrom.current = status === 'running' ? Date.now() : null;
  }, [status]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timer = setInterval(() => {
      const stamp = Date.now();
      const from = runningFrom.current;

      setNow(stamp);
      if (from !== null) {
        setElapsed(stamp - from);
      }
    }, TICK_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [active]);

  const elapsedMs = elapsedFor({observedStart, elapsed, now, startedAt});

  if (!active || elapsedMs === null) {
    return null;
  }

  return phaseFor(status, elapsedMs);
};

const elapsedFor = ({
  observedStart,
  elapsed,
  now,
  startedAt,
}: {
  observedStart: boolean;
  elapsed: number;
  now: number;
  startedAt: number | null;
}): number | null => {
  if (observedStart) {
    return elapsed;
  }

  return startedAt === null ? null : now - startedAt;
};
