import {TBody, THead, Table, Td, Th, Tr} from '@chameleon-labs/lattice-react';
import type {PageHistoryPoint} from '@tabstop/contract';
import {AUDIT_STATUS_LABELS, historyRows} from '../../trend-geometry';
import {AbsentValue} from '../AbsentValue';
import {ScoreDelta} from '../ScoreDelta';
import './history-table.css';

export type HistoryTableProps = {
  points: readonly PageHistoryPoint[];
  domain: string;
  days: number;
};

const rowDate = (timestamp: string): string =>
  new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short', year: 'numeric'}).format(Date.parse(timestamp));

export const HistoryTable = ({points, domain, days}: HistoryTableProps): React.JSX.Element => {
  if (points.length === 0) {
    return <p className="history-table__empty">No audits in this window yet.</p>;
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A keyboard-scrollable overflow region needs focus.
    <div className="history-table" role="region" aria-label="Score history table" tabIndex={0}>
      <Table caption={`Score history for ${domain}, last ${days} days`}>
        <THead>
          <Tr>
            <Th scope="col">Date</Th>
            <Th scope="col">Score</Th>
            <Th scope="col">Change</Th>
            <Th scope="col">Status</Th>
            <Th scope="col">axe-core</Th>
          </Tr>
        </THead>
        <TBody>
          {historyRows(points).map(({point, previousScore}) => (
            <Tr key={point.auditId}>
              <Th scope="row">
                <time dateTime={point.createdAt}>{rowDate(point.createdAt)}</time>
              </Th>
              <Td className="history-table__numeric">{point.score ?? <AbsentValue />}</Td>
              <Td>
                {point.score === null ? (
                  <AbsentValue />
                ) : (
                  <ScoreDelta score={point.score} previousScore={previousScore} />
                )}
              </Td>
              <Td>{AUDIT_STATUS_LABELS[point.status]}</Td>
              <Td className="history-table__engine">{point.axeVersion ?? <AbsentValue />}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
};
