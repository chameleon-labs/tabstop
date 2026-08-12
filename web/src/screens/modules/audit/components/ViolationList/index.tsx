import type {Violation} from '@tabstop/contract';
import {useId, useState} from 'react';
import {groupByImpact, startsExpanded} from '../../grouping';
import {crossesFrames, describeTarget, safeHelpUrl} from '../../violation';

export type ViolationListProps = {
  violations: readonly Violation[];
};

export type ViolationItemProps = {
  violation: Violation;
  defaultExpanded: boolean;
};

export const ViolationList = ({violations}: ViolationListProps): React.JSX.Element => {
  const groups = groupByImpact(violations);
  const expanded = startsExpanded(violations.length);

  if (groups.length === 0) {
    return <p>No accessibility violations were found on this page.</p>;
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`impact-${group.key}`}>
          <h3 id={`impact-${group.key}`}>
            {group.label} ({group.violations.length})
          </h3>
          <ul>
            {group.violations.map((violation) => (
              <li key={violation.ruleId}>
                <ViolationItem violation={violation} defaultExpanded={expanded} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};

const ViolationItem = ({violation, defaultExpanded}: ViolationItemProps): React.JSX.Element => {
  const [open, setOpen] = useState(defaultExpanded);
  const panelId = useId();
  // Null when the audited page supplied something that is not a web address.
  const help = safeHelpUrl(violation.helpUrl);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {violation.description}
      </button>
      <div id={panelId} hidden={!open}>
        {!open ? null : (
          <>
            {help === null ? (
              <p>
                Rule <code>{violation.ruleId}</code>
              </p>
            ) : (
              <p>
                <a href={help} target="_blank" rel="noreferrer noopener">
                  How to fix this
                  <span className="visually-hidden"> — {violation.ruleId}</span>
                </a>
              </p>
            )}
            {violation.nodes.length === 0 ? (
              <p>No specific elements were reported for this rule.</p>
            ) : (
              <ul>
                {violation.nodes.map((node, index) => (
                  // oxlint-disable-next-line react/no-array-index-key
                  <li key={`${violation.ruleId}-${index}`}>
                    <p>
                      <code>{describeTarget(node.target)}</code>
                      {crossesFrames(node.target) && <span className="visually-hidden"> (inside a frame)</span>}
                    </p>
                    <pre>
                      <code>{node.html}</code>
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
};
