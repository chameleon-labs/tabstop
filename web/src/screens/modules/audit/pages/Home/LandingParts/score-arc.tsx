export interface ScoreArcProps {
  /** 0–100. Drives both the sweep and the threshold colour. */
  score: number;
  /** Pixel size of the (square) SVG viewport. Every other dimension —
   *  radius, stroke, the two text sizes — is a fixed proportion of this. */
  size?: number;
}

/**
 * The hero audit card's circular score gauge.
 *
 * Page-local by design, not a library component: one consumer (the landing
 * page's mock audit card), one arrangement, no guarantee a caller would
 * otherwise have to remember — the same admission test that keeps
 * `EmptyState` out of the library. See the design spec's §7.3 and the gap
 * list's "Deliberate omissions" section.
 *
 * Ported from Lattice's `ScoreArc` (`packages/react/src/pages/score-arc.tsx`)
 * with its geometry untouched — the −210°→30° sweep, the `size * 0.38`
 * radius, the `size * 0.22` / `size * 0.09` text sizes are all proportional
 * to the `size` prop, not CSS roles, so they stay inline rather than moving
 * to `pages.css`. Colour is the one thing that changes: every stroke here is
 * `currentColor`, set by a `color` declaration on a `landing-page__score-arc--*`
 * modifier class in `pages.css`, rather than the source's literal hex —
 * `stroke="var(--lat-...)"` was avoided because an inline SVG presentation
 * attribute reading a custom property is not reliable across browsers,
 * while `currentColor` inheritance is universally supported.
 */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function ScoreArc({score, size = 120}: ScoreArcProps): React.JSX.Element {
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = -210;
  const endAngle = 30;
  const range = endAngle - startAngle;
  const filled = (score / 100) * range;

  const arc = (angle: number): {x: number; y: number} => ({
    x: cx + r * Math.cos(toRad(angle)),
    y: cy + r * Math.sin(toRad(angle)),
  });

  const p1 = arc(startAngle);
  const p2 = arc(startAngle + filled);
  const largeArc = filled > 180 ? 1 : 0;

  const trackP2 = arc(endAngle);
  const trackLarge = range > 180 ? 1 : 0;

  let thresholdClass = 'landing-page__score-arc--bad';
  if (score >= 80) {
    thresholdClass = 'landing-page__score-arc--good';
  } else if (score >= 60) {
    thresholdClass = 'landing-page__score-arc--warn';
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`landing-page__score-arc ${thresholdClass}`}
    >
      <path
        d={`M ${p1.x} ${p1.y} A ${r} ${r} 0 ${trackLarge} 1 ${trackP2.x} ${trackP2.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
        className="landing-page__score-arc-track"
      />
      {score > 0 && (
        <path
          d={`M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeLinecap="round"
        />
      )}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={size * 0.22}
        className="landing-page__score-arc-value"
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + size * 0.14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={size * 0.09}
        className="landing-page__score-arc-suffix"
      >
        / 100
      </text>
    </svg>
  );
}
