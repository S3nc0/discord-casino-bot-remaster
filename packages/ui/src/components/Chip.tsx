import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { CheckIcon } from '../icons.tsx';
import { cx } from '../utils.ts';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state; sets aria-pressed and displays a check icon by default. */
  selected?: boolean;
  /** Optional leading icon. When selected is true and omitted, a check icon is shown. */
  icon?: ReactNode;
  children: ReactNode;
}

export function Chip({
  selected = false,
  icon,
  children,
  className,
  type = 'button',
  ...props
}: ChipProps) {
  const leadingIcon = selected ? (icon ?? <CheckIcon small />) : icon;

  return (
    <button
      type={type}
      className={cx('bb-chip bb-state', className)}
      aria-pressed={selected}
      {...props}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

export interface ChipGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible group label. */
  label: string;
  children: ReactNode;
}

export function ChipGroup({ label, children, className, ...props }: ChipGroupProps) {
  return (
    <div className={cx('bb-chips', className)} role="group" aria-label={label} {...props}>
      {children}
    </div>
  );
}
