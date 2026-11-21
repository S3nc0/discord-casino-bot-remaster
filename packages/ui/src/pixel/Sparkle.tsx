import type { SVGProps } from 'react';
import { cx } from '../utils.ts';

export interface SparkleProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> {
  /** Fade between two frames. Off under reduced motion. */
  twinkle?: boolean;
}

/** 3 by 3 plus-shaped sparkle in the reward colour (`tertiary`), 9px by default. */
export function Sparkle({ twinkle = true, className, ...props }: SparkleProps) {
  return (
    <svg
      className={cx('bb-spark', twinkle && 'bb-spark--twinkle', className)}
      viewBox="0 0 3 3"
      aria-hidden="true"
      {...props}
    >
      <path d="M1 0h1v1h1v1h-1v1h-1v-1h-1v-1h1z" />
    </svg>
  );
}
