import {useRef, useState} from 'react';
import type {PageHistoryPoint} from '@tabstop/contract';
import {
  pointDescription,
  trendBounds,
  trendPositions,
  trendSegments,
  trendSummary,
  versionBoundaries,
  type TrendBox,
} from '../../trend-geometry';
import './trend-chart.css';

/**
 * A fixed coordinate space scaled by the viewBox, so the chart resizes with its
 * container and never has to measure one.
 */
const BOX: TrendBox = {width: 720, height: 220, padding: {top: 16, right: 16, bottom: 34, left: 44}};
const PLOT_TOP = BOX.padding.top;
const PLOT_LEFT = BOX.padding.left;
const PLOT_RIGHT = BOX.width - BOX.padding.right;
const PLOT_BOTTOM = BOX.height - BOX.padding.bottom;
const POINT_RADIUS = 4.5;
const MARKER_SIZE = 5;

export type TrendChartProps = {
  points: readonly PageHistoryPoint[];
  /** Called when the reader moves to a point, so the screen can announce it. */
  onFocusPoint?: (description: string) => void;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const diamond = (x: number, y: number): string =>
  `M ${round(x)} ${y - MARKER_SIZE} L ${round(x + MARKER_SIZE)} ${y} L ${round(x)} ${y + MARKER_SIZE} L ${round(x - MARKER_SIZE)} ${y} Z`;

const nextIndex = (key: string, current: number, last: number): number | null => {
  switch (key) {
    case 'ArrowRight':
      return current + 1;
    case 'ArrowLeft':
      return current - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
};

const shortDate = (timestamp: string): string =>
  new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'}).format(Date.parse(timestamp));

export const TrendChart = ({points, onFocusPoint}: TrendChartProps): React.JSX.Element => {
  const [active, setActive] = useState(0);
  const [tip, setTip] = useState<number | null>(null);
  const markers = useRef<(SVGGraphicsElement | null)[]>([]);

  if (points.length === 0) {
    return <p className="trend-chart trend-chart__empty">No audits in this window yet.</p>;
  }

  const last = points.length - 1;
  const activeIndex = Math.min(active, last);
  const bounds = trendBounds(points);
  const positioned = trendPositions(points, BOX, bounds);
  const segments = trendSegments(positioned);
  const boundaries = versionBoundaries(points);
  const endpoint = positioned.findLastIndex((entry) => entry.y !== null);
  const tipEntry = tip === null ? undefined : positioned[tip];
  const failures = points.filter(({status}) => status === 'failed').length;

  const focusMarker = (index: number): void => {
    markers.current[Math.min(last, Math.max(0, index))]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    const target = nextIndex(event.key, activeIndex, last);
    if (target === null) {
      return;
    }

    event.preventDefault();
    focusMarker(target);
  };

  const clearTip = (index: number): void => {
    setTip((current) => (current === index ? null : current));
  };

  return (
    <div className="trend-chart">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The points are what the reader focuses; arrow-key routing has to sit on the element they share. */}
      <svg
        className="trend-chart__plot"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        role="group"
        aria-label={trendSummary(points)}
        onKeyDown={onKeyDown}
      >
        <g className="trend-chart__grid" aria-hidden="true">
          <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_RIGHT} y2={PLOT_TOP} vectorEffect="non-scaling-stroke" />
          <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} vectorEffect="non-scaling-stroke" />
          <text className="trend-chart__axis-label" x={PLOT_LEFT - 8} y={PLOT_TOP} dy="0.32em">
            {bounds.hi}
          </text>
          <text className="trend-chart__axis-label" x={PLOT_LEFT - 8} y={PLOT_BOTTOM} dy="0.32em">
            {bounds.lo}
          </text>
          <text className="trend-chart__axis-date" x={PLOT_LEFT} y={BOX.height - 8}>
            {shortDate(points[0]!.createdAt)}
          </text>
          {points.length > 1 && (
            <text className="trend-chart__axis-date trend-chart__axis-date--end" x={PLOT_RIGHT} y={BOX.height - 8}>
              {shortDate(points[last]!.createdAt)}
            </text>
          )}
        </g>

        {boundaries.map((index) => (
          <line
            key={`version-${points[index]!.auditId}`}
            className="trend-chart__version"
            x1={round(positioned[index]!.x)}
            y1={PLOT_TOP}
            x2={round(positioned[index]!.x)}
            y2={PLOT_BOTTOM}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {segments.map((segment) => (
          <polygon
            key={`area-${segment[0]!.point.auditId}`}
            className="trend-chart__area"
            points={[
              `${round(segment[0]!.x)},${PLOT_BOTTOM}`,
              ...segment.map((entry) => `${round(entry.x)},${round(entry.y ?? PLOT_BOTTOM)}`),
              `${round(segment[segment.length - 1]!.x)},${PLOT_BOTTOM}`,
            ].join(' ')}
          />
        ))}

        {segments.map((segment) => (
          <polyline
            key={`line-${segment[0]!.point.auditId}`}
            className="trend-chart__line"
            points={segment.map((entry) => `${round(entry.x)},${round(entry.y ?? PLOT_BOTTOM)}`).join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {positioned.map((entry, index) => {
          const description = pointDescription(entry.point);
          const shared = {
            className: 'trend-chart__point',
            'data-status': entry.point.status,
            ...(index === endpoint ? {'data-endpoint': 'true'} : {}),
            role: 'img',
            'aria-label': description,
            tabIndex: index === activeIndex ? 0 : -1,
            ref: (node: SVGGraphicsElement | null): void => {
              markers.current[index] = node;
            },
            onFocus: (): void => {
              setActive(index);
              setTip(index);
              onFocusPoint?.(description);
            },
            onBlur: (): void => {
              clearTip(index);
            },
            onPointerEnter: (): void => {
              setTip(index);
            },
            onPointerLeave: (): void => {
              clearTip(index);
            },
          };

          return entry.y === null ? (
            <path key={entry.point.auditId} {...shared} d={diamond(entry.x, PLOT_BOTTOM)} />
          ) : (
            <circle
              key={entry.point.auditId}
              {...shared}
              cx={round(entry.x)}
              cy={round(entry.y)}
              r={index === endpoint ? POINT_RADIUS + 1.5 : POINT_RADIUS}
            />
          );
        })}
      </svg>

      {tipEntry !== undefined && (
        <p
          className="trend-chart__tooltip"
          aria-hidden="true"
          style={{
            left: `${(tipEntry.x / BOX.width) * 100}%`,
            top: `${((tipEntry.y ?? PLOT_BOTTOM) / BOX.height) * 100}%`,
          }}
        >
          {pointDescription(tipEntry.point)}
        </p>
      )}

      <ul className="trend-chart__legend">
        <li className="trend-chart__key">
          <span className="trend-chart__swatch trend-chart__swatch--score" aria-hidden="true" />
          Score
        </li>
        {failures > 0 && (
          <li className="trend-chart__key">
            <span className="trend-chart__swatch trend-chart__swatch--failed" aria-hidden="true" />
            Audit failed
          </li>
        )}
        {boundaries.length > 0 && (
          <li className="trend-chart__key">
            <span className="trend-chart__swatch trend-chart__swatch--version" aria-hidden="true" />
            axe-core version change
          </li>
        )}
      </ul>
    </div>
  );
};
