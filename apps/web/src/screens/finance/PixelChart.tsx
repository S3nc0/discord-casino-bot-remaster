import { useEffect, useId, useRef, useState } from 'react';

const ROWS = 20;
const MAX_CANDLES = 10;
/** CSS pixels per art pixel: whole pixels only, so the candles stay crisp. */
const PX = 3;

export interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
}

/** Prices, oldest first, cut into at most `max` candles of equal runs (the last may be shorter). */
export function toCandles(points: readonly number[], max = MAX_CANDLES): Candle[] {
  if (points.length === 0) return [];
  const run = Math.max(1, Math.ceil(points.length / max));
  const out: Candle[] = [];
  for (let i = 0; i < points.length; i += run) {
    const seg = points.slice(i, i + run);
    // each candle opens where the last one closed, so the bodies join up
    const open = i === 0 ? (seg[0] as number) : (points[i - 1] as number);
    out.push({
      open,
      close: seg[seg.length - 1] as number,
      high: Math.max(open, ...seg),
      low: Math.min(open, ...seg),
    });
  }
  return out;
}

export interface PixelChartProps {
  /** Prices, oldest first. Any unit: only the shape matters, `format` writes the axis values. */
  points: readonly number[];
  /** Spoken description, e.g. "GOLD, last prices, now 2,038.66, +0.76%". */
  label: string;
  /** Axis text for the highest and lowest price, e.g. "High 2,191.96". Leave out for no axis. */
  high?: string;
  low?: string;
  className?: string;
}

/**
 * Pixel candlesticks: each candle a 3 pixel body with a 1 pixel wick, green when it closed up and
 * red when down, over a dotted grid. The latest candle flashes when a new price comes in.
 */
export function PixelChart({ points, label, high, low, className }: PixelChartProps) {
  const id = useId();
  const candles = toCandles(points);
  const cols = Math.max(1, candles.length * 4 - 1);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const y = (p: number) => (span === 0 ? ROWS / 2 : Math.round(((max - p) / span) * (ROWS - 1)));
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const tone = last > first ? 'up' : last < first ? 'down' : 'flat';

  // flash the latest candle when the latest price changes (not on the first draw)
  const seen = useRef(last);
  const [flash, setFlash] = useState<{ n: number; dir: 'up' | 'down' }>({ n: 0, dir: 'up' });
  useEffect(() => {
    if (last === seen.current) return;
    const dir = last > seen.current ? 'up' : 'down';
    seen.current = last;
    setFlash((f) => ({ n: f.n + 1, dir }));
  }, [last]);

  const grid: number[] = [];
  for (let x = 0; x < cols; x += 2) grid.push(x);
  const lastCandle = candles[candles.length - 1];
  const svg = (
    <svg
      className={['fin-chart', `fin-chart--${tone}`, className].filter(Boolean).join(' ')}
      width={cols * PX}
      height={ROWS * PX}
      viewBox={`0 0 ${cols} ${ROWS}`}
      shapeRendering="crispEdges"
      role="img"
      aria-labelledby={id}
      data-tone={tone}
      data-flash={flash.n > 0 ? flash.dir : undefined}
    >
      <title id={id}>{label}</title>
      {[5, 10, 15].map((row) => (
        <path
          key={row}
          className="fin-chart__grid"
          d={grid.map((x) => `M${x} ${row}h1v1h-1z`).join('')}
        />
      ))}
      {candles.map((c, i) => {
        const x = i * 4;
        const up = c.close >= c.open;
        const top = y(Math.max(c.open, c.close));
        const bottom = y(Math.min(c.open, c.close));
        const wickTop = y(c.high);
        return (
          <g
            key={i}
            className={up ? 'fin-chart__up' : 'fin-chart__down'}
            data-candle={up ? 'up' : 'down'}
          >
            <rect x={x + 1} y={wickTop} width={1} height={y(c.low) - wickTop + 1} />
            <rect x={x} y={top} width={3} height={bottom - top + 1} />
          </g>
        );
      })}
      {lastCandle ? (
        <rect
          key={flash.n}
          className="fin-chart__last"
          x={(candles.length - 1) * 4 - 0.5}
          y={y(lastCandle.high) - 0.5}
          width={4}
          height={y(lastCandle.low) - y(lastCandle.high) + 2}
          style={{ stroke: `var(--${flash.dir === 'up' ? 'success' : 'error'})` }}
        />
      ) : null}
    </svg>
  );
  if (high === undefined && low === undefined) return svg;
  return (
    <div className="fin-candles">
      {high !== undefined ? <p className="fin-candles__axis">{high}</p> : null}
      {svg}
      {low !== undefined ? <p className="fin-candles__axis">{low}</p> : null}
    </div>
  );
}
