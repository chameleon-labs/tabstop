import type {Violation} from '@tabstop/contract';
import {Code, CodeBlock, Disclosure, DisclosureContent, DisclosureProvider} from '@chameleon-labs/lattice-react';
import {ChevronRight, ExternalLink} from '@/screens/components/Icons';
import {bySeverity, startsExpanded} from '../../grouping';
import {crossesFrames, describeTarget, safeHelpUrl} from '../../violation';
import {ImpactBadge} from '../ImpactBadge';
import './violation-list.css';

export type ViolationListProps = {
  violations: readonly Violation[];
};

export type ViolationItemProps = {
  violation: Violation;
  defaultExpanded: boolean;
};

export const ViolationList = ({violations}: ViolationListProps): React.JSX.Element => {
  const ordered = bySeverity(violations);
  const expanded = startsExpanded(violations.length);

  if (ordered.length === 0) {
    return <p className="violations__empty">No accessibility violations were found on this page.</p>;
  }

  return (
    <section className="violations" aria-labelledby="violations-heading">
      <p className="violations__heading" id="violations-heading">
        Violations — {ordered.length} total
      </p>
      <ul className="violations__list">
        {ordered.map((violation) => (
          <li key={violation.ruleId} className="violations__item">
            <ViolationItem violation={violation} defaultExpanded={expanded} />
          </li>
        ))}
      </ul>
    </section>
  );
};

const ViolationItem = ({violation, defaultExpanded}: ViolationItemProps): React.JSX.Element => {
  const help = safeHelpUrl(violation.helpUrl);
  return (
    <DisclosureProvider defaultOpen={defaultExpanded}>
      <Disclosure className="violations__trigger">
        <ImpactBadge impact={violation.impact} />{' '}
        <span className="violations__copy">
          <span className="violations__rule">{violation.ruleId}</span>{' '}
          <span className="violations__description">{violation.description}</span>
        </span>{' '}
        <span className="violations__count">{violation.nodes.length}×</span>
        <ChevronRight size="sm" className="violations__chevron" aria-hidden="true" />
      </Disclosure>
      <DisclosureContent className="violations__panel" unmountOnHide>
        <p className="violations__panel-eyebrow">Affected elements</p>
        {violation.nodes.length === 0 ? (
          <p>No specific elements were reported for this rule.</p>
        ) : (
          <ul className="violations__nodes">
            {violation.nodes.map((node, index) => (
              // oxlint-disable-next-line react/no-array-index-key
              <li key={`${violation.ruleId}-${index}`}>
                <p>
                  <Code>{describeTarget(node.target)}</Code>
                  {crossesFrames(node.target) && <span className="visually-hidden"> (inside a frame)</span>}
                </p>
                <CodeBlock
                  code={node.html}
                  copyLabel="Copy HTML"
                  regionLabel={`HTML of affected element ${index + 1}, ${violation.ruleId}`}
                />
              </li>
            ))}
          </ul>
        )}
        {help === null ? (
          <p>
            Rule <code>{violation.ruleId}</code>
          </p>
        ) : (
          <p>
            <a className="violations__help" href={help} target="_blank" rel="noreferrer noopener">
              How to fix this
              <span className="visually-hidden"> — {violation.ruleId}</span>
              <ExternalLink size="sm" aria-hidden="true" />
            </a>
          </p>
        )}
      </DisclosureContent>
    </DisclosureProvider>
  );
};
