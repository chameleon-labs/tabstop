import {TBody, THead, Table, Td, Th, Tr, VisuallyHidden} from '@chameleon-labs/lattice-react';
import type {PageHistoryPoint} from '@tabstop/contract';
import {AUDIT_STATUS_LABELS} from '../../trend-geometry';
import {ScoreDelta} from '../ScoreDelta';
import './history-table.css';

export type HistoryTableProps = {
  points: readonly PageHistoryPoint[];
  domain: string;
  days: number;
};

type HistoryRow = {point: PageHistoryPoint; previousScore: number | null};

/**
 * Each row is compared with the last run that produced a score, not the last
 * run. A failure between two audits would otherwise blank a comparison the
 * reader can still make.
 */
const rowsOf = (points: readonly PageHistoryPoint[]): HistoryRow[] => {
  const rows: HistoryRow[] = [];
  let previousScore: number | null = null;

  for (const point of points) {
    rows.push({point, previousScore});
    if (point.score !== null) {
      previousScore = point.score;
    }
  }

  return rows.toReversed();
};

const Absent = (): React.JSX.Element => (
  <>
    <VisuallyHidden>Not recorded</VisuallyHidden>
    <span aria-hidden="true">—</span>
  </>
);

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
          {rowsOf(points).map(({point, previousScore}) => (
            <Tr key={point.auditId}>
              <Th scope="row">
                <time dateTime={point.createdAt}>{rowDate(point.createdAt)}</time>
              </Th>
              <Td className="history-table__numeric">{point.score ?? <Absent />}</Td>
              <Td>
                {point.score === null ? <Absent /> : <ScoreDelta score={point.score} previousScore={previousScore} />}
              </Td>
              <Td>{AUDIT_STATUS_LABELS[point.status]}</Td>
              <Td className="history-table__engine">{point.axeVersion ?? <Absent />}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
};
