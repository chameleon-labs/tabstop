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

const isGone = (error: Error): boolean => isApiError(error) && error.status === 404;

const messageFor = (error: Error): string => (isGone(error) ? GONE : error.message);

export const AuditPanel = ({auditId, onClose}: AuditPanelProps): React.JSX.Element => {
  const headingId = useId();
  const {data, error, isPending, refetch} = useAudit(auditId);
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

      {data?.status === 'failed' && (
        <Callout variant="danger" icon={<AlertCircle size="sm" />} title="That audit did not finish">
          <p>{data.error ?? 'Something went wrong.'}</p>
        </Callout>
      )}

      {waiting && data !== undefined && (
        <p className="audit-panel__running">
          {`This audit is still ${data.status}. Its result will appear here when it finishes.`}
        </p>
      )}

      {data?.status === 'done' && <AuditResult audit={data} />}
    </section>
  );
};
