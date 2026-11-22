import { useId } from 'react';

const ROWS = 16;

export interface PixelChartProps {
  /** Prices, oldest first. Any unit: only the shape matters. */
  points: readonly number[];
  /** Spoken description, e.g. "GOLD, last 48 minutes, up 2.1%". */
  label: string;
  className?: string;
}

/**
 * A small chart drawn in whole pixels: one column per price, a one-pixel line over a soft fill.
 * Colour follows the move (green up, red down). `crispEdges` keeps the squares sharp.
 */
export function PixelChart({ points, label, className }: PixelChartProps) {
  const id = useId();
  const n = Math.max(points.length, 2);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const rows = points.map((p) =>
    span === 0 ? Math.floor(ROWS / 2) : Math.round(((p - min) / span) * (ROWS - 1)),
  );
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const tone = last > first ? 'up' : last < first ? 'down' : 'flat';
  return (
    <svg
      className={['fin-chart', `fin-chart--${tone}`, className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${n} ${ROWS}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-labelledby={id}
      data-tone={tone}
    >
      <title id={id}>{label}</title>
      {rows.map((row, i) => {
        const top = ROWS - 1 - row;
        return (
          <g key={i}>
            <rect className="fin-chart__fill" x={i} y={top + 1} width={1} height={row} />
            <rect className="fin-chart__line" x={i} y={top} width={1} height={1} />
          </g>
        );
      })}
    </svg>
  );
}
