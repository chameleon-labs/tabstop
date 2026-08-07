import type {AuditResultResponse, Impact} from '@tabstop/contract';
import {IMPACT_LABELS} from '../../grouping';
import {ViolationList} from '../ViolationList';

export type AuditResultProps = {
  audit: AuditResultResponse;
};

/** Most severe first, matching the violation list below it. */
const COUNT_ORDER: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

/**
 * A finished audit. Standalone on purpose - the home screen (#19), the share
 * page (#23) and audit detail (#21) all render this same component, so it takes
 * a response and nothing else: no router, no query client, no knowledge of how
 * it was reached.
 *
 * THE SCORE IS NEVER SHOWN ALONE. The counts are not decoration beside it, they
 * are the correction to it: a single number invites "72 is a B-", and the score
 * is explicitly for noticing regressions rather than for grading a site. Two
 * pages can score the same with very different problems, and the counts are
 * what makes that visible. They are rendered together, in one element, so
 * there is no layout in which one survives without the other.
 */
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

/**
 * `settled: false` means the page never finished loading, so everything above
 * was measured against a page still in motion.
 *
 * Surfaced rather than swallowed, and the contract says why: a clean score from
 * an unsettled page is provisional rather than a fact. Publishing it silently
 * would be the product asserting something it does not know - on a share page
 * someone sends to a colleague.
 */
const ProvisionalNotice = (): React.JSX.Element => (
  <p role="note">
    This page had not finished loading when it was audited, so these results are provisional — some content may not have
    been checked.
  </p>
);
