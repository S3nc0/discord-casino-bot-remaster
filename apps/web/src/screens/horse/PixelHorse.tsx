import { useEffect, useState } from 'react';
import { isReducedMotionActive, rowsToPaths } from '@casino/ui';
import { coatKey, silksKey } from './format.ts';
import { HORSE_ART_HEIGHT, HORSE_ART_WIDTH, HORSE_FRAMES, HORSE_STILL_FRAME } from './horse-art.ts';

/*
 * A racehorse in profile with a rider, 48 by 32 art pixels, eight frames of one gallop stride
 * (art in horse-art.ts, made from a public domain photo series; see CREDITS.md). The coat and the
 * silks pick the colours through classes, so nothing here carries a colour value.
 */
const FRAME_MS = 80;
const PATHS = new Map<number, ReturnType<typeof rowsToPaths>>();
const pathsOf = (frame: number) => {
  let paths = PATHS.get(frame);
  if (!paths) {
    paths = rowsToPaths(HORSE_FRAMES[frame] as readonly string[]);
    PATHS.set(frame, paths);
  }
  return paths;
};

export interface PixelHorseProps {
  coat: string;
  silks: string;
  /** Play the gallop. Off when still or under reduced motion (then the still frame shows). */
  running?: boolean;
  /** Start the stride at another frame, so a field of horses does not move in step. */
  phase?: number;
  className?: string;
}

export function PixelHorse({
  coat,
  silks,
  running = false,
  phase = 0,
  className,
}: PixelHorseProps) {
  const animate = running && !isReducedMotionActive();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), FRAME_MS);
    return () => clearInterval(id);
  }, [animate]);
  const frame = animate ? (tick + phase) % HORSE_FRAMES.length : HORSE_STILL_FRAME;
  return (
    <svg
      className={`hr-horse hr-coat-${coatKey(coat)} hr-silks-${silksKey(silks)}${animate ? ' is-running' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${HORSE_ART_WIDTH} ${HORSE_ART_HEIGHT}`}
      aria-hidden="true"
    >
      {pathsOf(frame).map(([key, d]) => (
        <path key={key} className={`hr-px-${key}`} d={d} />
      ))}
    </svg>
  );
}
