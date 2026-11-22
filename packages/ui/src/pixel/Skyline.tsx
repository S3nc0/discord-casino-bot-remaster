import { useId } from 'react';
import type { HTMLAttributes } from 'react';
import { cx } from '../utils.ts';
import { SKYLINE_COLUMNS, SKYLINE_ROWS } from './art.ts';
import { rowsToPaths } from './paths.ts';

export interface SkylineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Night or day. Leave out to follow the active theme (dark = night, light = day). */
  variant?: 'night' | 'day';
}

const PATHS = rowsToPaths(SKYLINE_ROWS);
const ROWS = SKYLINE_ROWS.length;

/**
 * Pixel-art city strip for the top of a hero. Fills its container's width at 4px per art pixel and
 * repeats every 96 columns on wide screens. Decorative.
 */
export function Skyline({ variant, className, ...props }: SkylineProps) {
  const id = `bb-sky-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div
      className={cx('bb-skyline', variant && `bb-skyline--${variant}`, className)}
      aria-hidden="true"
      {...props}
    >
      <svg width="100%" height="100%" focusable="false">
        <defs>
          <pattern
            id={id}
            width={SKYLINE_COLUMNS}
            height={ROWS}
            patternUnits="userSpaceOnUse"
            patternTransform="scale(4)"
          >
            {PATHS.map(([key, d]) => (
              <path key={key} className={`bb-sky-${key}`} d={d} />
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}
