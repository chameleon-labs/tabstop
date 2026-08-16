import {Button} from '@chameleon-labs/lattice-react';
import type {PageHistoryPoint} from '@tabstop/contract';
import {AUDIT_STATUS_LABELS, historyRows, pointDate} from '../../trend-geometry';
import {AbsentValue} from '../AbsentValue';
import {ScoreDelta} from '../ScoreDelta';
import './audit-list.css';

/** A 365-day window is not a 365-row list. */
export const AUDIT_LIST_LIMIT = 30;

export type AuditListProps = {
  points: readonly PageHistoryPoint[];
  /** The uuid currently open, so the row can mark itself. */
  selectedAuditId: string | null;
  onSelect: (auditId: string) => void;
};

const rowDate = (timestamp: string): string =>
  new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short', year: 'numeric'}).format(Date.parse(timestamp));

export const AuditList = ({points, selectedAuditId, onSelect}: AuditListProps): React.JSX.Element => {
  if (points.length === 0) {
    return <p className="audit-list__empty">No audits in this window yet.</p>;
  }

  // Rows are built across the whole window and capped afterwards, so the
  // oldest one shown still compares against the run that really preceded it.
  const shown = historyRows(points).slice(0, AUDIT_LIST_LIMIT);

  return (
    <div className="audit-list">
      <ul className="audit-list__rows">
        {shown.map(({point, previousScore}) => (
          <li key={point.auditId} className="audit-list__row" data-status={point.status}>
            <time className="audit-list__date" dateTime={point.createdAt}>
              {rowDate(point.createdAt)}
            </time>
            <span className="audit-list__score">{point.score ?? <AbsentValue />}</span>
            <span className="audit-list__change">
              {point.score === null ? (
                <AbsentValue />
              ) : (
                <ScoreDelta score={point.score} previousScore={previousScore} />
              )}
            </span>
            <span className="audit-list__status">{AUDIT_STATUS_LABELS[point.status]}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-current={point.auditId === selectedAuditId ? 'true' : undefined}
              aria-label={
                point.status === 'failed'
                  ? `Why the audit failed on ${pointDate(point)}`
                  : `View result for ${pointDate(point)}`
              }
              onClick={() => {
                onSelect(point.auditId);
              }}
            >
              {point.status === 'failed' ? 'Why' : 'View result'}
            </Button>
          </li>
        ))}
      </ul>
      {points.length > AUDIT_LIST_LIMIT && (
        <p className="audit-list__note">{`Showing the ${AUDIT_LIST_LIMIT} most recent audits of ${points.length}.`}</p>
      )}
    </div>
  );
};
