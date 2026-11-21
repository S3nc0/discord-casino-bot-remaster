import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils.ts';

export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Emphasis variant. Defaults to 'standard'. */
  variant?: IconButtonVariant;
  /** Required accessible name for the icon-only button. */
  label: string;
  /** Toggle state; sets aria-pressed when provided. */
  pressed?: boolean;
  /** 12x12 pixel icon rendered at 24px. */
  icon?: ReactNode;
  children?: ReactNode;
}

export function IconButton({
  variant = 'standard',
  label,
  pressed,
  icon,
  children,
  className,
  type = 'button',
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'bb-icon-btn',
        variant !== 'standard' && `bb-icon-btn--${variant}`,
        'bb-state',
        className,
      )}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      {...props}
    >
      {icon ?? children}
    </button>
  );
}
