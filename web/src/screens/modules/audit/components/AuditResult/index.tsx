import type {AuditResultResponse, Impact} from '@tabstop/contract';
import {IMPACT_LABELS} from '../../grouping';
import {ScoreArc} from '../ScoreArc';
import {ViolationList} from '../ViolationList';
import './audit-result.css';

export type AuditResultProps = {
  audit: AuditResultResponse;
};

const COUNT_ORDER: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

export const AuditResult = ({audit}: AuditResultProps): React.JSX.Element => (
  <section className="audit-result" aria-labelledby="audit-result-heading">
    <h2 id="audit-result-heading" className="visually-hidden">
      Result for {audit.url}
    </h2>
    {audit.settled ? null : <ProvisionalNotice />}
    <div className="audit-result__score report-card">
      {audit.score === null ? (
        <p className="audit-result__unscored">Not scored</p>
      ) : (
        <ScoreArc score={audit.score} size={110} />
      )}
      <div>
        <p className="report-card__eyebrow">Score</p>
        <dl className="audit-result__counts">
          {COUNT_ORDER.map((impact) => (
            <div key={impact} className="audit-result__count" data-impact={impact}>
              <dt>{IMPACT_LABELS[impact]}</dt>
              <dd>{audit.countsByImpact[impact]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
    <div className="report-card">
      <ViolationList violations={audit.violations} />
    </div>
  </section>
);

const ProvisionalNotice = (): React.JSX.Element => (
  <p role="note" className="audit-result__provisional">
    This page had not finished loading when it was audited, so these results are provisional — some content may not have
    been checked.
  </p>
);
