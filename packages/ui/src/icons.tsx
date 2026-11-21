import type { SVGProps } from 'react';
import { cx } from './utils.ts';

export interface PixelIconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  /** Small 18px icon variant used in chips/tags. */
  small?: boolean;
}

export function InfoIcon({ className, small, ...props }: PixelIconProps) {
  return (
    <svg
      className={cx('bb-icon', small && 'bb-icon--sm', className)}
      viewBox="0 0 12 12"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="M3 1h6v1h-6zM2 2h8v1h-8zM1 3h4v1h-4zM7 3h4v1h-4zM1 4h10v1h-10zM1 5h4v1h-4zM7 5h4v1h-4zM1 6h4v1h-4zM7 6h4v1h-4zM1 7h4v1h-4zM7 7h4v1h-4zM2 8h8v1h-8zM3 9h6v1h-6z"
      />
    </svg>
  );
}

export function CheckIcon({ className, small, ...props }: PixelIconProps) {
  return (
    <svg
      className={cx('bb-icon', small && 'bb-icon--sm', className)}
      viewBox="0 0 12 12"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="M10 2h1v1h-1zM9 3h2v1h-2zM8 4h2v1h-2zM2 5h1v1h-1zM7 5h2v1h-2zM2 6h2v1h-2zM6 6h2v1h-2zM3 7h4v1h-4zM4 8h2v1h-2z"
      />
    </svg>
  );
}

export function WarningIcon({ className, small, ...props }: PixelIconProps) {
  return (
    <svg
      className={cx('bb-icon', small && 'bb-icon--sm', className)}
      viewBox="0 0 12 12"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="M5 1h2v1h-2zM4 2h4v1h-4zM4 3h1v1h-1zM7 3h1v1h-1zM3 4h2v1h-2zM6 4h1v1h-1zM8 4h2v1h-2zM3 5h2v1h-2zM6 5h1v1h-1zM8 5h2v1h-2zM2 6h3v1h-3zM7 6h3v1h-3zM2 7h3v1h-3zM7 7h3v1h-3zM1 8h4v1h-4zM6 8h1v1h-1zM8 8h4v1h-4zM1 9h11v1h-11z"
      />
    </svg>
  );
}

export function CloseIcon({ className, small, ...props }: PixelIconProps) {
  return (
    <svg
      className={cx('bb-icon', small && 'bb-icon--sm', className)}
      viewBox="0 0 12 12"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="M2 1h2v1h-2zM8 1h2v1h-2zM3 2h2v1h-2zM7 2h2v1h-2zM4 3h4v1h-4zM5 4h2v1h-2zM4 5h4v1h-4zM3 6h2v1h-2zM7 6h2v1h-2zM2 7h2v1h-2zM8 7h2v1h-2z"
      />
    </svg>
  );
}
