/**
 * `d3-shape`'s `curveMonotoneX` — the exact algorithm Recharts' `type="monotone"`
 * delegates to — ported point-for-point rather than approximated.
 *
 * A monotone cubic keeps each interpolated segment within the vertical range
 * of its two endpoints: it cannot swing above a local peak or below a local
 * trough the way a natural (Catmull-Rom-ish) cubic spline can. That property
 * is why `ScoreChart` needed this rather than a straight polyline *or* a
 * generic smooth curve — the nine-point score history has a sharp elbow at
 * Jul 21, and a spline unaware of monotonicity would overshoot past 84 or
 * undershoot past 61 drawing through it, misrepresenting the regression's
 * shape. A straight polyline would lose the curve entirely.
 *
 * Ported from d3-shape's `src/curve/monotone.js` (`MonotoneXContext`), which
 * implements the Fritsch–Carlson method: pick a tangent slope at each
 * interior point from a weighted blend of its two neighbouring secant slopes
 * (`slope3`), collapse it to zero wherever the neighbouring secants disagree
 * in sign (a local max or min — the exact condition that would otherwise
 * overshoot), and cap its magnitude at half the harmonic-weighted blend.
 * Endpoints use `slope2`, the one-sided variant, seeded from the interior
 * tangent one step in. Points are fed through the same small state machine
 * d3 streams through a canvas context, except the "context" here appends
 * `M`/`C` commands to a string instead of calling `bezierCurveTo`.
 */
export interface Point {
  x: number;
  y: number;
}

function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

// The one-sided tangent used for the first and last point, where there is
// no second neighbour to blend against — d3's `slope2`.
function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

// The interior tangent: a weighted blend of the two secant slopes either
// side of (x1, y1), zeroed out at a local extremum and capped at the
// harmonic-weighted blend's magnitude — the two mechanisms that keep the
// curve from overshooting. d3's `slope3`.
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

// Appends one cubic Bezier segment from (x0,y0) to (x1,y1) using tangents
// t0 (at the start) and t1 (at the end), control points placed a third of
// the way along dx — d3's `point()`.
function segment(x0: number, y0: number, x1: number, y1: number, t0: number, t1: number): string {
  const dx = (x1 - x0) / 3;
  return `C${x0 + dx},${y0 + dx * t0},${x1 - dx},${y1 - dx * t1},${x1},${y1}`;
}

/**
 * Returns an SVG path `d` string tracing a monotone cubic through `points`,
 * left to right. Points must already be sorted by `x` (the caller's date
 * order); this does not sort them.
 */
export function monotoneLinePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  if (points.length === 2) {
    const [p0, p1] = points as [Point, Point];
    return `M${p0.x},${p0.y}L${p1.x},${p1.y}`;
  }

  const n = points.length;
  const tangents: number[] = new Array(n);

  // Interior tangents first — each needs both neighbours.
  for (let i = 1; i < n - 1; i += 1) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    tangents[i] = slope3(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
  }

  // Endpoints use the one-sided variant, seeded from the interior tangent
  // one step in — d3's `lineEnd` case 3 (`point(this, this._t0, slope2(this,
  // this._t0))`) mirrored at the start.
  const p0 = points[0]!;
  const p1 = points[1]!;
  tangents[0] = slope2(p0.x, p0.y, p1.x, p1.y, tangents[1]!);

  const pLast = points[n - 1]!;
  const pPrev = points[n - 2]!;
  tangents[n - 1] = slope2(pPrev.x, pPrev.y, pLast.x, pLast.y, tangents[n - 2]!);

  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    d += segment(a.x, a.y, b.x, b.y, tangents[i]!, tangents[i + 1]!);
  }

  return d;
}
