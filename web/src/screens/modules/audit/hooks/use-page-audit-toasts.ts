import {useEffect, useRef} from 'react';
import type {PageSummary} from '@tabstop/contract';
import type {ToastInput} from '@/screens/components/ToastRegion';

type Watched = {
  auditId: string;
  status: string;
  /** Whether the run was the page's first when it was last seen in flight. */
  wasFirst: boolean;
};

const inFlight = (status: string): boolean => status === 'queued' || status === 'running';

/**
 * Announces a first audit reaching its end, once.
 *
 * The list is polled, so the finished row arrives again every interval; the
 * previous state is what separates "this just happened" from "this is still
 * true". Pages are tracked by id and audit id rather than by position, since
 * the array reorders whenever the server does.
 */
export const usePageAuditToasts = (
  pages: readonly PageSummary[] | undefined,
  push: (toast: ToastInput) => void,
): void => {
  const watched = useRef<Map<string, Watched> | null>(null);
  const pushRef = useRef(push);

  pushRef.current = push;

  useEffect(() => {
    if (pages === undefined) {
      return;
    }

    // The first list to arrive is a baseline, never news: everything in it
    // finished before this screen was open.
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
