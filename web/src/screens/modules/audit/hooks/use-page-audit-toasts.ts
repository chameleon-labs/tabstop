import {useEffect, useRef} from 'react';
import type {PageSummary} from '@tabstop/contract';
import type {ToastInput} from '@/screens/components/ToastRegion';

type Watched = {
  auditId: string;
  status: string;
  wasFirst: boolean;
};

const inFlight = (status: string): boolean => status === 'queued' || status === 'running';

export const usePageAuditToasts = (
  pages: readonly PageSummary[] | undefined,
  push: (toast: ToastInput) => void,
): void => {
  const watched = useRef<Map<string, Watched> | null>(null);
  const pushRef = useRef(push);

  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  useEffect(() => {
    if (pages === undefined) {
      return;
    }

    const previous = watched.current;
    const next = new Map<string, Watched>();

    for (const page of pages) {
      const latest = page.latestAudit;
      if (latest === null) {
        continue;
      }

      const before = previous?.get(page.id);
      const wasFirst =
        before !== undefined && before.auditId === latest.auditId ? before.wasFirst : page.history.length === 0;

      next.set(page.id, {auditId: latest.auditId, status: latest.status, wasFirst});

      if (previous === null || before === undefined) {
        continue;
      }
      if (before.auditId !== latest.auditId || !inFlight(before.status) || !before.wasFirst) {
        continue;
      }

      if (latest.status === 'done') {
        pushRef.current({
          variant: 'success',
          message:
            page.score === null
              ? `First audit complete for ${page.url}.`
              : `First audit complete for ${page.url}. Score ${page.score}.`,
        });
      } else if (latest.status === 'failed') {
        pushRef.current({variant: 'warning', message: `First audit failed for ${page.url}.`});
      }
    }

    watched.current = next;
  }, [pages]);
};
