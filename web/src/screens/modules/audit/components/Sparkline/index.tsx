import type {PageScorePoint} from '@tabstop/contract';
import './sparkline.css';

const WIDTH = 120;
const HEIGHT = 36;
const INSET = 2;
const MAX_POINTS = 30;
const DOMAIN = 100;

export type SparklineProps = {
  points: readonly PageScorePoint[];
  className?: string;
};

export type SparklinePoint = {x: number; y: number};

const bounded = (points: readonly PageScorePoint[]): readonly PageScorePoint[] => points.slice(-MAX_POINTS);

const clampScore = (score: number): number => Math.min(DOMAIN, Math.max(0, score));

const round = (value: number): number => Math.round(value * 100) / 100;

export const sparklineCoordinates = (input: readonly PageScorePoint[]): readonly SparklinePoint[] => {
  const points = bounded(input);
  const drawableWidth = WIDTH - INSET * 2;
  const drawableHeight = HEIGHT - INSET * 2;

  return points.map(({score}, index) => ({
    x: points.length === 1 ? WIDTH / 2 : round(INSET + (index / (points.length - 1)) * drawableWidth),
    y: round(INSET + ((DOMAIN - clampScore(score)) / DOMAIN) * drawableHeight),
  }));
};

export const sparklineLabel = (input: readonly PageScorePoint[]): string => {
  const points = bounded(input);
  const first = points.at(0);
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return 'No completed score history';
  }

  if (points.length === 1) {
    return `Score trend: ${first.score} from 1 audit`;
  }

  const delta = last.score - first.score;
  const magnitude = Math.abs(delta);
  const movement =
    delta === 0 ? 'unchanged' : `${delta < 0 ? 'down' : 'up'} ${magnitude} ${magnitude === 1 ? 'point' : 'points'}`;

  return `Score trend: ${first.score} to ${last.score} over ${points.length} audits, ${movement}`;
};

type Trend = 'down' | 'up' | 'flat' | 'single' | 'empty';

const trendOf = (points: readonly PageScorePoint[]): Trend => {
  const first = points.at(0);
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return 'empty';
  }
  if (points.length === 1) {
    return 'single';
  }
  if (last.score === first.score) {
    return 'flat';
  }

  return last.score < first.score ? 'down' : 'up';
};

export const Sparkline = ({points, className}: SparklineProps): React.JSX.Element => {
  const drawn = bounded(points);
  const coordinates = sparklineCoordinates(points);
  const end = coordinates.at(-1);

  return (
    <svg
      className={className === undefined ? 'sparkline' : `sparkline ${className}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={sparklineLabel(points)}
      focusable="false"
      data-trend={trendOf(drawn)}
    >
      <line
        className="sparkline__baseline"
        x1={INSET}
        y1={HEIGHT - INSET}
        x2={WIDTH - INSET}
        y2={HEIGHT - INSET}
        vectorEffect="non-scaling-stroke"
      />
      {coordinates.length > 1 && (
        <polyline
          className="sparkline__line"
          points={coordinates.map(({x, y}) => `${x},${y}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {end !== undefined && <circle className="sparkline__end" cx={end.x} cy={end.y} r={2.5} />}
    </svg>
  );
};
