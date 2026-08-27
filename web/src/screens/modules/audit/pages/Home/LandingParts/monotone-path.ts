export interface Point {
  x: number;
  y: number;
}

function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

function segment(x0: number, y0: number, x1: number, y1: number, t0: number, t1: number): string {
  const dx = (x1 - x0) / 3;
  return `C${x0 + dx},${y0 + dx * t0},${x1 - dx},${y1 - dx * t1},${x1},${y1}`;
}

export function monotoneLinePath(points: readonly Point[]): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M${points[0]!.x},${points[0]!.y}`;
  }
  if (points.length === 2) {
    const [p0, p1] = points as [Point, Point];
    return `M${p0.x},${p0.y}L${p1.x},${p1.y}`;
  }

  const n = points.length;
  const tangents: number[] = Array.from({length: n}, () => 0);

  for (let i = 1; i < n - 1; i += 1) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    tangents[i] = slope3(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
  }

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
