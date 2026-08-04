import type { Violation } from '@tabstop/contract'
import { useId, useState } from 'react'
import { groupByImpact, startsExpanded } from '../../audit/grouping'
import { crossesFrames, describeTarget, safeHelpUrl } from '../../audit/violation'

export type ViolationListProps = {
  violations: readonly Violation[]
}

export type ViolationItemProps = {
  violation: Violation
  defaultExpanded: boolean
}

/**
 * The findings, grouped by severity, each expandable to the elements it
 * affects.
 *
 * A REAL `<button>` with `aria-expanded`, not a clickable div. That is house
 * style everywhere; here it is also the product's own claim. A disclosure built
 * from a div is one of the failures axe reports, and shipping one inside an
 * accessibility report would be the most quotable bug this project could have.
 */
export const ViolationList = ({ violations }: ViolationListProps): React.JSX.Element => {
  const groups = groupByImpact(violations)
  const expanded = startsExpanded(violations.length)

  if (groups.length === 0) {
    return <p>No accessibility violations were found on this page.</p>
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
  )
}

const ViolationItem = ({
  violation, defaultExpanded
}: ViolationItemProps): React.JSX.Element => {
  const [open, setOpen] = useState(defaultExpanded)
  const panelId = useId()
  // Null when the audited page supplied something that is not a web address.
  const help = safeHelpUrl(violation.helpUrl)

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { setOpen((was) => !was) }}
      >
        {violation.description}
      </button>

      {/*
        The PANEL is always rendered, so `aria-controls` always points at an
        element that exists - a control referencing a missing id is a broken
        relationship, not a collapsed one.

        Its CONTENTS are not. `hidden` removes a subtree from presentation, not
        from the document: React still builds every node row and every HTML
        snippet inside it. A long report starts collapsed precisely because it
        is long, and axe can return dozens of nodes per rule - so the collapsed
        case was the one paying for thousands of elements nobody had asked to
        see. Mounting on open costs a render that a person just requested.
      */}
      <div id={panelId} hidden={!open}>
        {!open ? null : (
          <>
        {help === null
          ? <p>Rule <code>{violation.ruleId}</code></p>
          : (
            <p>
              <a href={help} target="_blank" rel="noreferrer noopener">
                How to fix this
                {/* The link text alone would read as "How to fix this" out of
                    context, in a list of identical links. The rule names it. */}
                <span className="visually-hidden"> — {violation.ruleId}</span>
              </a>
            </p>
            )}

        {violation.nodes.length === 0
          ? <p>No specific elements were reported for this rule.</p>
          : (
            <ul>
              {violation.nodes.map((node, index) => (
                <li key={`${violation.ruleId}-${index}`}>
                  <p>
                    <code>{describeTarget(node.target)}</code>
                    {crossesFrames(node.target) && (
                      <span className="visually-hidden"> (inside a frame)</span>
                    )}
                  </p>
                  {/*
                    `node.html` IS ATTACKER-CONTROLLED. It is a markup snippet
                    captured from an arbitrary third-party page, and this
                    product's whole job is to visit pages nobody vetted.
                    Rendered as TEXT - React escapes by default, so the entire
                    rule is that `dangerouslySetInnerHTML` never touches this
                    value. The instinct to "show the HTML properly" is exactly
                    the instinct that would introduce stored XSS here, which is
                    why the comment sits at the render site rather than in a doc.
                  */}
                  <pre><code>{node.html}</code></pre>
                </li>
              ))}
            </ul>
              )}
          </>
        )}
      </div>
    </>
  )
}
