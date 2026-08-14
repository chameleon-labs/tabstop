import './score-arc.css';

export interface ScoreArcProps {
  /** 0–100. Drives both the sweep and the threshold colour. */
  score: number;
  /** Pixel size of the (square) SVG viewport. Every other dimension —
   *  radius, stroke, the two text sizes — is a fixed proportion of this. */
  size?: number;
}

/* Strokes are `currentColor`, set by the `score-arc--*` modifiers: an inline
   SVG presentation attribute reading a custom property is not reliable across
   browsers. */
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

  let thresholdClass = 'score-arc--bad';
  if (score >= 80) {
    thresholdClass = 'score-arc--good';
  } else if (score >= 60) {
    thresholdClass = 'score-arc--warn';
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`score-arc ${thresholdClass}`}>
      <path
        d={`M ${p1.x} ${p1.y} A ${r} ${r} 0 ${trackLarge} 1 ${trackP2.x} ${trackP2.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
        className="score-arc-track"
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
        className="score-arc-value"
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
        className="score-arc-suffix"
      >
        / 100
      </text>
    </svg>
  );
}
