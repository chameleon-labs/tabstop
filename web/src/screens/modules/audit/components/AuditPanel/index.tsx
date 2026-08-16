import {Button, Callout} from '@chameleon-labs/lattice-react';
import {useId} from 'react';
import {isApiError} from '@/api/client';
import {AlertCircle} from '@/screens/components/Icons';
import {useAudit} from '../../audits';
import {exactTime} from '../../page-time';
import {AuditResult} from '../AuditResult';
import './audit-panel.css';

export type AuditPanelProps = {
  auditId: string;
  onClose: () => void;
};

const GONE = 'That result is no longer available.';

/** The one permanent poll failure. Everything else is worth another attempt. */
const isGone = (error: Error): boolean => isApiError(error) && error.status === 404;

const messageFor = (error: Error): string => (isGone(error) ? GONE : error.message);

export const AuditPanel = ({auditId, onClose}: AuditPanelProps): React.JSX.Element => {
  const headingId = useId();
  const {data, error, isPending, refetch} = useAudit(auditId);
  // Only while something is actually coming. `useAudit` stops its interval on
  // error but keeps the last queued body, so an errored panel still has an
  // unfinished audit in hand and nothing left that will ever finish it.
  const waiting = (data?.status === 'queued' || data?.status === 'running') && error === null;

  return (
    <section className="audit-panel" aria-labelledby={headingId} aria-busy={isPending || waiting}>
      <div className="audit-panel__header">
        <h2 className="audit-panel__heading" id={headingId}>
          {data === undefined ? 'Audit result' : `Audit on ${exactTime(data.createdAt)}`}
        </h2>
        <Button variant="ghost" size="sm" aria-label="Close the audit result" onClick={onClose}>
          Close
        </Button>
      </div>

      {isPending && <p className="audit-panel__loading">{`Loading the result for audit ${auditId}…`}</p>}

      {error !== null && (
        <div className="audit-panel__failure">
          <p className="audit-panel__gone">{messageFor(error)}</p>
          {!isGone(error) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {/* A failed run has no score and no violations to show, only the sentence saying why. */}
      {data?.status === 'failed' && (
        <Callout variant="danger" icon={<AlertCircle size="sm" />} title="That audit did not finish">
          <p>{data.error ?? 'Something went wrong.'}</p>
        </Callout>
      )}

      {/* An unfinished run has no score, no counts and no violations either,
          so `AuditResult` would draw it as a clean audit. `useAudit` is already
          polling it; this waits for the answer rather than inventing one. */}
      {waiting && data !== undefined && (
        <p className="audit-panel__running">
          {`This audit is still ${data.status}. Its result will appear here when it finishes.`}
        </p>
      )}

      {data?.status === 'done' && <AuditResult audit={data} />}
    </section>
  );
};
