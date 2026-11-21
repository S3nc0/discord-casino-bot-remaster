import type { HTMLAttributes } from 'react';
import { cx } from '../utils.ts';

export type ProgressVariant = 'primary' | 'success';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** Always-visible progress label. */
  label: string;
  /** Current value. Omit for indeterminate progress. */
  value?: number;
  /** Maximum value for determinate progress (default: 100). */
  max?: number;
  /** Custom numeric text shown at the right (defaults to percentage when determinate). */
  valueLabel?: string;
  /** Role variant; 'success' turns segments green on completion. */
  variant?: ProgressVariant;
}

export function Progress({
  label,
  value,
  max = 100,
  valueLabel,
  variant = 'primary',
  className,
  ...props
}: ProgressProps) {
  const isDeterminate = typeof value === 'number';
  const safeMax = max > 0 ? max : 100;
  const clamped = isDeterminate ? Math.min(Math.max(value, 0), safeMax) : 0;
  const percent = isDeterminate ? Math.round((clamped / safeMax) * 100) : 0;
  const displayValue = isDeterminate ? (valueLabel ?? `${percent}%`) : valueLabel;

  return (
    <div className={cx('bb-progress-wrap', className)} {...props}>
      <div className="bb-progress-wrap__head">
        <span>{label}</span>
        {displayValue !== undefined && <span>{displayValue}</span>}
      </div>
      <div
        className={cx(
          'bb-progress',
          variant === 'success' && 'bb-progress--success',
          !isDeterminate && 'bb-progress--indeterminate',
        )}
        role="progressbar"
        aria-label={label}
        aria-valuenow={isDeterminate ? clamped : undefined}
        aria-valuemin={isDeterminate ? 0 : undefined}
        aria-valuemax={isDeterminate ? safeMax : undefined}
        style={!isDeterminate ? { overflow: 'hidden' } : undefined}
      >
        <div
          className="bb-progress__fill"
          style={isDeterminate ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}
