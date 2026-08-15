import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Code,
  Eyebrow,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@chameleon-labs/lattice-react';
import {useEffect} from 'react';
import {Link} from 'react-router';
import {AlertTriangle, Info} from '@/screens/components/Icons';
import {ImpactBadge} from '@/screens/modules/audit/components/ImpactBadge';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {DocSection} from '../../components/DocSection';
import {Prose} from '../../components/Prose';
import {SectionNav} from '../../components/SectionNav';
import {SCORE_SECTIONS, SCORE_WEIGHTS, WORKED_EXAMPLE} from './data';
import './score-formula.css';

const SECTION_TITLES = {
  purpose: 'What the score is for',
  formula: 'The formula',
  weights: 'Impact weights',
  cap: 'The per-rule element cap',
  'worked-example': 'Worked example',
  versioning: 'Version comparability',
  'not-measured': 'What the score does not measure',
  'vs-lighthouse': "Why not Lighthouse's accessibility score?",
  limitations: 'Limitations',
} as const;

const Purpose = (): React.JSX.Element => (
  <>
    <Prose>
      The score exists to make accessibility regressions visible over time. It gives a team one stable signal to watch,
      so a harmful deploy stands out without pretending that one number describes the whole experience.
    </Prose>
    <Prose>
      The violation list is for fixing. The score is for noticing. A score of 60 does not mean the page is “60%
      accessible”; it means automated testing found enough weighted violations to deduct 40 points.
    </Prose>
    <Callout
      variant="info"
      icon={<Info size="sm" />}
      title="Use the score to notice regressions"
      className="score-formula__callout"
    >
      Use the violation list to fix them. Do not use the score to judge overall accessibility.
    </Callout>
  </>
);

const Formula = (): React.JSX.Element => (
  <>
    <Prose>
      Each audit produces a violation list from <a href="https://github.com/dequelabs/axe-core">axe-core</a>. Every
      unique rule that fired contributes a penalty.
    </Prose>
    <Card className="score-formula__formula-card">
      <CardHeader label="formula" />
      <CardBody className="score-formula__formula-body">
        <p className="score-formula__formula-line">penalty(rule) = min(affected_element_count, 5) × weight(impact)</p>
        <div className="score-formula__formula-rule" aria-hidden="true" />
        <p className="score-formula__formula-line">score = max(0, 100 − Σ penalty(rule) over unique violated rules)</p>
      </CardBody>
    </Card>
    <Prose>
      Duplicate rule ids are combined defensively before scoring: node counts are added, and the most severe known
      impact is kept before the cap is applied. The score floor is 0 and its ceiling is 100.
    </Prose>
  </>
);

const Weights = (): React.JSX.Element => (
  <>
    <Prose>
      axe-core may report one of four impact levels, or it may report no impact. The fixed weights below keep audit
      results inspectable and comparable.
    </Prose>
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A keyboard-scrollable overflow region needs focus. */}
    <div className="score-formula__table-scroll" role="region" aria-label="Impact weights table" tabIndex={0}>
      <Table caption="Score impact weights and per-rule maximum deductions">
        <THead>
          <Tr>
            <Th scope="col">Impact</Th>
            <Th scope="col" className="score-formula__numeric-cell">
              Weight per element
            </Th>
            <Th scope="col" className="score-formula__numeric-cell">
              Max penalty per rule
            </Th>
            <Th scope="col">Rationale</Th>
          </Tr>
        </THead>
        <TBody>
          {SCORE_WEIGHTS.map(({impact, badgeImpact, weight, maximum, rationale}) => (
            <Tr key={impact}>
              <Th scope="row" className="score-formula__impact-cell">
                <ImpactBadge impact={badgeImpact} />
              </Th>
              <Td className="score-formula__numeric-cell">{weight}</Td>
              <Td className="score-formula__numeric-cell">{maximum}</Td>
              <Td>{rationale}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
    <Prose>
      Unrated is not a fifth severity and does not enter the four impact-count buckets. The finding still remains in the
      violation list and deducts at weight 1.
    </Prose>
    <Prose>
      The weights are fixed and not configurable. Fixed inputs are what let two audit scores be compared without
      silently changing the meaning of the scale.
    </Prose>
  </>
);

const Cap = (): React.JSX.Element => (
  <>
    <Prose>
      Each unique rule is capped at five affected elements. Without the cap, one broken component repeated many times
      could dominate the score even though it represents one pattern to repair.
    </Prose>
    <Prose>
      The cap is per rule, not per impact. For example, a page may have 50 elements failing <Code>color-contrast</Code>{' '}
      and one failing <Code>image-alt</Code>; each rule receives its own cap.
    </Prose>
    <Callout
      variant="warning"
      icon={<AlertTriangle size="sm" />}
      title="The cap never hides affected elements"
      className="score-formula__callout"
    >
      Every affected element stays in the violation list. Only that unique rule’s score contribution is capped.
    </Callout>
  </>
);

const WorkedExample = (): React.JSX.Element => (
  <>
    <Prose>A concrete audit ledger makes the notation easier to inspect.</Prose>
    <Card className="score-formula__example-card">
      <CardHeader label="worked example" className="score-formula__example-header">
        <span>{WORKED_EXAMPLE.page}</span>
        <span aria-hidden="true">·</span>
        <span>{WORKED_EXAMPLE.engine}</span>
      </CardHeader>
      <CardBody className="score-formula__example-body">
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A keyboard-scrollable overflow region needs focus. */}
        <div className="score-formula__table-scroll" role="region" aria-label="Worked score example table" tabIndex={0}>
          <Table caption="Worked score calculation for acme.example/checkout">
            <THead>
              <Tr>
                <Th scope="col">Impact</Th>
                <Th scope="col">Rule</Th>
                <Th scope="col" className="score-formula__numeric-cell">
                  Elements
                </Th>
                <Th scope="col" className="score-formula__numeric-cell">
                  Capped
                </Th>
                <Th scope="col" className="score-formula__numeric-cell">
                  Weight
                </Th>
                <Th scope="col" className="score-formula__numeric-cell">
                  Penalty
                </Th>
              </Tr>
            </THead>
            <TBody>
              {WORKED_EXAMPLE.rows.map(({impact, ruleId, elements, cappedElements, weight, penalty}) => (
                <Tr key={ruleId}>
                  <Th scope="row" className={`score-formula__impact-text score-formula__impact-text--${impact}`}>
                    {impact}
                  </Th>
                  <Td className="score-formula__rule-cell">
                    <Code>{ruleId}</Code>
                    {elements > cappedElements ? (
                      <>
                        {' '}
                        <span className="score-formula__cap-note">capped at 5 elements</span>
                      </>
                    ) : null}
                  </Td>
                  <Td className="score-formula__numeric-cell">{elements}</Td>
                  <Td className="score-formula__numeric-cell">{cappedElements}</Td>
                  <Td className="score-formula__numeric-cell">×{weight}</Td>
                  <Td className="score-formula__numeric-cell score-formula__penalty-cell">{penalty}</Td>
                </Tr>
              ))}
              <Tr className="score-formula__total-row">
                <Th scope="row" colSpan={5} className="score-formula__total-label">
                  Total penalties
                </Th>
                <Td className="score-formula__numeric-cell score-formula__penalty-cell">
                  {WORKED_EXAMPLE.totalPenalties}
                </Td>
              </Tr>
              <Tr>
                <Th scope="row" colSpan={5} className="score-formula__total-label">
                  Score
                </Th>
                <Td className="score-formula__numeric-cell score-formula__score-cell">{WORKED_EXAMPLE.score}</Td>
              </Tr>
            </TBody>
          </Table>
        </div>
      </CardBody>
      <div className="score-formula__example-summary">100 − (30 + 5 + 5) = 60</div>
    </Card>
    <Prose>
      The <Code>region</Code> rule fired on eight elements, but only five contribute to its penalty. All eight remain
      visible in the violation list.
    </Prose>
  </>
);

const Versioning = (): React.JSX.Element => (
  <>
    <Prose>
      Scores are only comparable within the same axe-core version. New engine releases can add rules, retire rules, or
      change how existing rules behave, so equal scores across versions do not describe equal measurements.
    </Prose>
    <Prose>
      tabstop stores the axe-core version with each audit. Consumers can distinguish version boundaries and avoid
      treating a rule-set change as a site regression or improvement.
    </Prose>
    <Callout
      variant="info"
      icon={<Info size="sm" />}
      title="Treat an engine upgrade as a measurement boundary"
      className="score-formula__callout"
    >
      Compare audits inside a version. Do not infer a site change from the first score produced by a different version.
    </Callout>
  </>
);

const NotMeasured = (): React.JSX.Element => (
  <>
    <Prose>The automated score does not establish:</Prose>
    {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Explicit role preserves Safari/VoiceOver semantics when list markers are removed. */}
    <ul className="score-formula__list" role="list">
      <li>Whether alt text is meaningful, accurate, or helpful—not merely present</li>
      <li>Whether focus order is logical for keyboard navigation</li>
      <li>Whether the page is actually usable with a screen reader</li>
      <li>Whether touch targets are large enough in practice</li>
      <li>Whether content is readable and understandable</li>
      <li>Whether animations respect prefers-reduced-motion</li>
      <li>Whether the page works without CSS or JavaScript</li>
      <li>Performance and responsiveness under assistive technology</li>
    </ul>
    <Prose>
      These gaps are inherent to automated testing, not specific to tabstop. They are why the score and the violation
      list remain aids to human evaluation rather than substitutes for it.
    </Prose>
  </>
);

const VersusLighthouse = (): React.JSX.Element => (
  <>
    <Prose>
      <a href="https://developer.chrome.com/docs/lighthouse/accessibility/scoring/">
        Lighthouse&apos;s accessibility scoring
      </a>{' '}
      uses a weighted average of pass/fail accessibility audits. tabstop instead weights affected elements per unique
      violated rule and caps each rule at five elements.
    </Prose>
    <Prose>
      Both approaches are opinionated summaries, optimized for different jobs. tabstop’s cap is specifically useful for
      regression monitoring because a repeated component cannot consume the entire score by itself.
    </Prose>
    <Prose>
      A team that already tracks Lighthouse should expect the two scores to diverge. Investigate the underlying audit
      details instead of translating one number into the other.
    </Prose>
  </>
);

const Limitations = (): React.JSX.Element => (
  <>
    <Callout
      variant="danger"
      icon={<AlertTriangle size="sm" />}
      title="Do not use this score to claim a page is accessible"
      className="score-formula__callout score-formula__limitations"
    >
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Explicit role preserves Safari/VoiceOver semantics when list markers are removed. */}
      <ul className="score-formula__list score-formula__list--compact" role="list">
        <li>Automated rules can identify some barriers, but they cannot prove accessibility.</li>
        <li>100 means no automated violations were detected, not that the page is accessible.</li>
        <li>Manual testing and testing with disabled people remain necessary.</li>
        <li>
          One Chromium snapshot with JavaScript enabled at one viewport omits dynamic states, other widths, and other
          browsers.
        </li>
      </ul>
    </Callout>
    <Prose>
      The product’s value is regression detection over time. That value does not require the score to be a complete
      measure of accessibility.
    </Prose>
  </>
);

const SECTION_CONTENT = {
  purpose: <Purpose />,
  formula: <Formula />,
  weights: <Weights />,
  cap: <Cap />,
  'worked-example': <WorkedExample />,
  versioning: <Versioning />,
  'not-measured': <NotMeasured />,
  'vs-lighthouse': <VersusLighthouse />,
  limitations: <Limitations />,
} as const;

export const ScoreFormula = (): React.JSX.Element => {
  useDocumentTitle('Score formula');

  useEffect(() => {
    const sectionId = window.location.hash.slice(1);
    if (SCORE_SECTIONS.some(({id}) => id === sectionId)) {
      document.getElementById(sectionId)?.scrollIntoView();
    }
  }, []);

  return (
    <div className="score-formula">
      <div className="score-formula__container">
        <header className="score-formula__header">
          <Link className="score-formula__back-link" to="/">
            ← tabstop
          </Link>
          <Eyebrow rule tone="accent">
            Documentation
          </Eyebrow>
          <h1 className="score-formula__title">How the score is calculated</h1>
          <p className="score-formula__lede">
            The score is opinionated. This page exists so it can be defended once rather than repeatedly. Every number
            below is fixed and public.
          </p>
        </header>
        <div className="score-formula__layout">
          <SectionNav sections={SCORE_SECTIONS} />
          <div className="score-formula__content">
            {SCORE_SECTIONS.map(({id}) => (
              <DocSection key={id} id={id} title={SECTION_TITLES[id]}>
                {SECTION_CONTENT[id]}
              </DocSection>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
