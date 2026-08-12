import type {AuditResultResponse, Impact} from '@tabstop/contract';
import {IMPACT_LABELS} from '../../grouping';
import {ViolationList} from '../ViolationList';

export type AuditResultProps = {
  audit: AuditResultResponse;
};

/** Most severe first, matching the violation list below it. */
const COUNT_ORDER: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

export const AuditResult = ({audit}: AuditResultProps): React.JSX.Element => (
  <section aria-labelledby="audit-result-heading">
    <h2 id="audit-result-heading">Result for {audit.url}</h2>
    {audit.settled ? null : <ProvisionalNotice />}
    <dl>
      <dt>Score</dt>
      <dd>{audit.score === null ? 'Not scored' : audit.score}</dd>
      {COUNT_ORDER.map((impact) => (
        <div key={impact}>
          <dt>{IMPACT_LABELS[impact]}</dt>
          <dd>{audit.countsByImpact[impact]}</dd>
        </div>
      ))}
    </dl>
    <ViolationList violations={audit.violations} />
  </section>
);

const ProvisionalNotice = (): React.JSX.Element => (
  <p role="note">
    This page had not finished loading when it was audited, so these results are provisional — some content may not have
    been checked.
  </p>
);
