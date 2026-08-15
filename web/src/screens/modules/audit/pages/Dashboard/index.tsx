import {Button, Callout, Eyebrow} from '@chameleon-labs/lattice-react';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import type {PageSummary} from '@tabstop/contract';
import {pageConflictOf} from '@/api/client';
import {AlertCircle} from '@/screens/components/Icons';
import {ToastRegion, useToastQueue} from '@/screens/components/ToastRegion';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {AddPageForm} from '../../components/AddPageForm';
import {DeletePageDialog} from '../../components/DeletePageDialog';
import {PageRow} from '../../components/PageRow';
import {usePageAuditToasts} from '../../hooks/use-page-audit-toasts';
import {useAddMonitoredPage, useDeleteMonitoredPage, useMonitoredPages} from '../../monitored-pages';
import './dashboard.css';

type RemovalTarget = {page: PageSummary; trigger: HTMLElement | null};
type FocusTarget = 'list-heading' | 'empty-input' | null;

export const Dashboard = (): React.JSX.Element => {
  useDocumentTitle('Dashboard');

  const pages = useMonitoredPages();
  const addPage = useAddMonitoredPage();
  const deletePage = useDeleteMonitoredPage();
  const toasts = useToastQueue();
  const navigate = useNavigate();

  const [removal, setRemoval] = useState<RemovalTarget | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const emptyInputRef = useRef<HTMLInputElement>(null);
  const listHeadingId = useId();
  const reportedFailures = useRef(0);
  const now = Date.now();

  const {data, error, errorUpdateCount, refetch} = pages;
  const {push} = toasts;

  usePageAuditToasts(data?.pages, push);

  /**
   * A refresh that fails behind rows already on screen reports nothing by
   * itself: the observer keeps saying success while it still has something to
   * show, and polling has stopped. One toast per failure episode, counted so a
   * repeated failure of the same kind is not repeated on every render.
   */
  useEffect(() => {
    if (data === undefined || error === null || errorUpdateCount <= reportedFailures.current) {
      return;
    }

    reportedFailures.current = errorUpdateCount;
    push({
      variant: 'danger',
      message: `Could not refresh your pages. ${error.message}`,
      action: {
        label: 'Retry',
        onClick: () => {
          void refetch();
        },
      },
    });
  }, [data, error, errorUpdateCount, push, refetch]);

  /**
   * Runs after the new list has rendered, keyed on its length: the button that
   * removal was triggered from no longer exists, and the destination depends
   * on whether a list or the empty state replaced it.
   */
  useLayoutEffect(() => {
    if (pendingFocus === null) {
      return;
    }

    const target = pendingFocus === 'list-heading' ? listHeadingRef.current : emptyInputRef.current;
    if (target === null) {
      return;
    }

    target.focus();
    setPendingFocus(null);
  }, [pendingFocus, data?.pages.length]);

  const submitPage = async (url: string): Promise<boolean> => {
    try {
      const response = await addPage.mutateAsync(url);
      push({variant: 'success', message: `Page added: ${url}`});

      if (response.firstAuditId === null) {
        push({
          variant: 'warning',
          message: `Monitoring is on for ${url}, but its first audit could not start. It will retry on the normal schedule.`,
        });
      }

      return true;
    } catch (caught) {
      const conflict = pageConflictOf(caught);

      if (conflict?.code === 'page_already_tracked') {
        const existing = data?.pages.find((page) => page.url === url);
        push({
          variant: 'info',
          message: conflict.error,
          ...(existing === undefined
            ? {}
            : {
                action: {
                  label: 'View page',
                  onClick: (): void => {
                    void navigate(`/pages/${encodeURIComponent(existing.id)}`);
                  },
                },
              }),
        });
      } else if (conflict?.code === 'page_limit_reached') {
        // The cached count said there was room, so it is stale - another tab
        // filled the last slot. Refresh it before repeating the server's
        // sentence, so the form disables itself for the right reason.
        await refetch();
        push({variant: 'warning', message: conflict.error});
      } else {
        push({
          variant: 'danger',
          message: caught instanceof Error ? caught.message : 'Could not add that page',
        });
      }

      return false;
    }
  };

  const confirmRemoval = async (page: PageSummary): Promise<boolean> => {
    const wasLast = (data?.pages.length ?? 0) <= 1;
    setRemovalError(null);

    try {
      await deletePage.mutateAsync({pageId: page.id});
      push({variant: 'success', message: `Page removed: ${page.url}`});
      setPendingFocus(wasLast ? 'empty-input' : 'list-heading');

      return true;
    } catch (caught) {
      const message = `Could not remove ${page.url}. ${caught instanceof Error ? caught.message : ''}`.trim();
      // Shown inside the dialog as well: it stays open on failure, and a modal
      // aria-hides the toast region behind it.
      setRemovalError(message);
      push({variant: 'danger', message});

      return false;
    }
  };

  const used = data?.used ?? 0;
  const limit = data?.limit ?? 0;

  return (
    <section className="dashboard">
      <header className="dashboard__header">
        <Eyebrow tone="accent">Monitoring</Eyebrow>
        <div className="dashboard__title-row">
          <h1 className="dashboard__title">Your pages</h1>
          {data !== undefined && <p className="dashboard__count">{`${used} of ${limit} pages`}</p>}
        </div>
        <p className="dashboard__lede">See what changed since the last audit, and what needs attention first.</p>
      </header>

      {data === undefined && pages.isPending && (
        <p className="dashboard__loading" aria-busy="true">
          Loading monitored pages…
        </p>
      )}

      {data === undefined && !pages.isPending && (
        <Callout variant="danger" icon={<AlertCircle size="sm" />} title="Could not load your pages">
          <p>{error?.message ?? 'Something went wrong.'}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </Callout>
      )}

      {data !== undefined && data.pages.length === 0 && (
        <div className="dashboard__empty">
          <h2 className="dashboard__empty-heading">No pages monitored yet</h2>
          <p className="dashboard__empty-lede">
            Add a page and tabstop audits it daily, keeping the score history that makes a regression visible.
          </p>
          <AddPageForm mode="empty" used={used} limit={limit} inputRef={emptyInputRef} onSubmit={submitPage} />
        </div>
      )}

      {data !== undefined && data.pages.length > 0 && (
        <>
          <AddPageForm mode="compact" used={used} limit={limit} onSubmit={submitPage} />
          <div className="dashboard__list-header">
            <h2 className="dashboard__list-heading" id={listHeadingId} ref={listHeadingRef} tabIndex={-1}>
              Monitored pages
            </h2>
            <p className="dashboard__list-note">Updated automatically</p>
          </div>
          <ul className="dashboard__list" aria-labelledby={listHeadingId}>
            {data.pages.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                now={now}
                onToast={push}
                onRequestRemove={(target, trigger) => {
                  setRemoval({page: target, trigger});
                }}
              />
            ))}
          </ul>
        </>
      )}

      <DeletePageDialog
        open={removal !== null}
        target={removal?.page ?? null}
        trigger={removal?.trigger ?? null}
        error={removalError}
        onOpenChange={(next) => {
          if (!next) {
            setRemoval(null);
            setRemovalError(null);
          }
        }}
        onConfirm={confirmRemoval}
      />
      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </section>
  );
};
