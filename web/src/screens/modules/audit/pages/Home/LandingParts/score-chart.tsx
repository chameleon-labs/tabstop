import {useLayoutEffect, useRef, useState} from 'react';
import {monotoneLinePath} from './monotone-path';

export interface ScoreChartPoint {
  date: string;
  score: number;
}

export interface ScoreChartProps {
  data: readonly ScoreChartPoint[];
  referenceDate: string;
}

const HEIGHT = 180;
const MARGIN = {top: 8, right: 8, bottom: 0, left: -24};

const Y_AXIS_WIDTH = 60;
const X_AXIS_HEIGHT = 30;
const TICK_GAP = 8;

const DOMAIN: readonly [number, number] = [50, 100];

const Y_TICKS = [50, 65, 80, 100];

function dotToneClass(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 80) {
    return 'good';
  }
  if (score >= 60) {
    return 'warn';
  }
  return 'bad';
}

export function ScoreChart({data, referenceDate}: ScoreChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) {
        setWidth(measured);
      }
    });
    observer.observe(el);
    return (): void => observer.disconnect();
  }, []);

  const plotLeft = MARGIN.left + Y_AXIS_WIDTH;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom - X_AXIS_HEIGHT;
  const ready = width > 0 && plotRight > plotLeft;

  const xFor = (index: number): number =>
    data.length <= 1 ? plotLeft : plotLeft + (index / (data.length - 1)) * (plotRight - plotLeft);
  const yFor = (score: number): number =>
    plotBottom - ((score - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * (plotBottom - plotTop);

  const plotted = data.map((point, index) => ({point, x: xFor(index), y: yFor(point.score)}));
  const linePath = ready ? monotoneLinePath(plotted.map(({x, y}) => ({x, y}))) : '';
  const referenceX = data.some((point) => point.date === referenceDate)
    ? xFor(data.findIndex((point) => point.date === referenceDate))
    : null;

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

            {plotted.map(({point, x}) => (
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

            {plotted.map(({point, x, y}) => (
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
  );
}
