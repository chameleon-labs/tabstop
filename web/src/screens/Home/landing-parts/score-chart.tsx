import { useLayoutEffect, useRef, useState } from 'react'
import { monotoneLinePath } from './monotone-path'

export interface ScoreChartPoint {
  date: string
  score: number
}

export interface ScoreChartProps {
  /** Nine (date, score) points, oldest first — `ScoreHistory`'s own data,
   *  the same array the hidden `Table` renders. */
  data: readonly ScoreChartPoint[]
  /** The date the dashed reference line marks. Must match one of `data`'s
   *  `date` values; if it doesn't, no reference line is drawn. */
  referenceDate: string
}

// The container height is fixed — the source's `ResponsiveContainer
// width="100%" height={180}` — while width tracks the container via
// `ResizeObserver` below: the same "redraw at the real pixel width"
// behaviour `ResponsiveContainer` gives Recharts, rather than drawing once
// at a fixed logical width and letting the SVG's `viewBox` stretch to fit.
// The `viewBox` is set to the *measured* width every render, so its ratio
// to the rendered box is always 1:1 and nothing is actually stretched —
// `preserveAspectRatio="none"` below only matters for the single frame
// between a resize firing and this component's next paint, where it stops
// the browser's default letterboxing rather than introducing any stretch
// of its own. Geometry (stroke widths, dot radii) is computed in these same
// real pixel units throughout, so it is never scaled non-uniformly.
const HEIGHT = 180
const MARGIN = { top: 8, right: 8, bottom: 0, left: -24 }

// Recharts' `XAxis`/`YAxis` auto-reserve room for their own tick labels
// beyond whatever `margin` says — a column sized from the Y tick text's
// width, a row sized from the X tick text's height — which is how the
// source's `left: -24` still leaves room for two/three-digit Y labels
// instead of drawing under them: the auto-reserved column absorbs it. Both
// constants, and the 8px tick-to-plot gap used below, are read directly off
// the rendered source (`.recharts-yAxis`/`.recharts-xAxis` tick and dot
// positions in the original design bundle) rather than
// recomputed: `firstDotCx` (36) minus `margin.left` (-24) gives 60; the
// container-bottom-to-plot-bottom gap measured the same way gives 30. Both
// are pixel constants independent of container width, so copying the
// measured values reproduces the source's layout at any width.
const Y_AXIS_WIDTH = 60
const X_AXIS_HEIGHT = 30
const TICK_GAP = 8

const DOMAIN: readonly [number, number] = [50, 100]

// Recharts' own tick values for this exact domain and default tickCount,
// via `recharts-scale`'s `getNiceTickValues` — not an evenly-stepped 50-60
// -70-80-90-100, which is what a generic "nice ticks" algorithm would
// produce and what a from-scratch reimplementation would have shipped.
// Read directly off `.recharts-yAxis .recharts-cartesian-axis-tick` in the
// source rather than reverse-engineered, for the same reason as the two
// constants above.
const Y_TICKS = [50, 65, 80, 100]

// The dot-fill threshold from the source's inline `dot` render prop —
// primary at 80+, the serious severity colour at 60+, critical below that.
function dotToneClass(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

/**
 * The "Score history — acme.example" section's line chart.
 *
 * Page-local, not a library component — see the module docs on
 * `landing.tsx`:
 * charting is product surface, not a design-system concern, so this reaches
 * for no charting dependency and ships nothing under `../index.js`. It
 * exists at all because a `Table` (this section's original substitution)
 * cannot show the *shape* of a regression, which is what the section's own
 * copy — "−20 pts since Jul 21" — is pointing at.
 *
 * Ported from Lattice's `ScoreChart` (`packages/react/src/pages
 * (1)/src/app/App.tsx`) as inline SVG rather than Recharts: same margins,
 * same 50–100 Y domain, same monotone interpolation (`./monotone-path.ts`,
 * a direct port of d3-shape's `curveMonotoneX` — see that file for why a
 * straight polyline or a non-monotone spline both misrepresent this precise
 * data), same dot-fill thresholds, same dashed reference line at Jul 21.
 * Every colour is a `fill`/`stroke` declaration on a `landing-page__chart-*`
 * class in `pages.css`, each reading a `--lat-*` token — never a literal
 * hex, and never a `var(...)` written as a raw JSX/SVG attribute string
 * (`ScoreArc`'s `stroke="currentColor"` convention exists to dodge exactly
 * that: an inline presentation attribute reading a custom property directly
 * is not reliably supported across browsers). Colour-bearing properties are
 * set from the external stylesheet instead, which resolves `var()` like any
 * other CSS property — no `currentColor` indirection is needed here, since
 * unlike `ScoreArc`'s single reused SVG, every element below already has
 * its own class naming exactly which token it reads.
 *
 * The `<svg>` itself is `aria-hidden` — a line chart has no text
 * alternative that reads well point-by-point — so the accessible
 * equivalent is the same nine-row `Table` this component replaces, kept
 * alongside it in a `VisuallyHidden` wrapper by this component's caller
 * (`ScoreHistory`, in `landing.tsx`) rather than removed.
 */
export function ScoreChart({ data, referenceDate }: ScoreChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return undefined

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured !== undefined) setWidth(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotLeft = MARGIN.left + Y_AXIS_WIDTH
  const plotRight = width - MARGIN.right
  const plotTop = MARGIN.top
  const plotBottom = HEIGHT - MARGIN.bottom - X_AXIS_HEIGHT
  const ready = width > 0 && plotRight > plotLeft

  const xFor = (index: number): number =>
    data.length <= 1 ? plotLeft : plotLeft + (index / (data.length - 1)) * (plotRight - plotLeft)
  const yFor = (score: number): number =>
    plotBottom - ((score - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * (plotBottom - plotTop)

  const plotted = data.map((point, index) => ({ point, x: xFor(index), y: yFor(point.score) }))
  const linePath = ready ? monotoneLinePath(plotted.map(({ x, y }) => ({ x, y }))) : ''
  const referenceX = data.some((point) => point.date === referenceDate)
    ? xFor(data.findIndex((point) => point.date === referenceDate))
    : null

  return (
    <div ref={containerRef} className="landing-page__chart">
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${Math.max(width, 1)} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="landing-page__chart-svg"
      >
        {ready && (
          <>
            {Y_TICKS.map((tick) => (
              <text
                key={tick}
                x={plotLeft - TICK_GAP}
                y={yFor(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="landing-page__chart-tick"
              >
                {tick}
              </text>
            ))}

            {plotted.map(({ point, x }) => (
              <text
                key={point.date}
                x={x}
                y={plotBottom + TICK_GAP}
                textAnchor="middle"
                className="landing-page__chart-tick"
              >
                {point.date}
              </text>
            ))}

            {referenceX !== null && (
              <line
                x1={referenceX}
                y1={plotTop}
                x2={referenceX}
                y2={plotBottom}
                className="landing-page__chart-refline"
              />
            )}

            <path d={linePath} className="landing-page__chart-line" />

            {plotted.map(({ point, x, y }) => (
              <circle
                key={point.date}
                cx={x}
                cy={y}
                r={3}
                className={`landing-page__chart-dot landing-page__chart-dot--${dotToneClass(point.score)}`}
              />
            ))}
          </>
        )}
      </svg>
    </div>
  )
}
