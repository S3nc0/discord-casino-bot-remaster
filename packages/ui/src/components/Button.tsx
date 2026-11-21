import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils.ts';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Emphasis variant. Defaults to 'filled'. */
  variant?: ButtonVariant;
  /** Optional leading pixel icon. */
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = 'filled',
  icon,
  children,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('bb-btn', variant !== 'filled' && `bb-btn--${variant}`, 'bb-state', className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
