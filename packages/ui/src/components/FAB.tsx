import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils.ts';

export type FABVariant = 'primary' | 'secondary' | 'tertiary';

export interface FABProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Role fill variant. Defaults to 'primary'. */
  variant?: FABVariant;
  /** 24px pixel icon. */
  icon: ReactNode;
  /** Accessible action label. Shown visually when extended is true. */
  label: string;
  /** Render as an extended FAB with visible label text. */
  extended?: boolean;
}

export function FAB({
  variant = 'primary',
  icon,
  label,
  extended = false,
  className,
  type = 'button',
  ...props
}: FABProps) {
  return (
    <button
      type={type}
      className={cx('bb-fab', variant !== 'primary' && `bb-fab--${variant}`, 'bb-state', className)}
      aria-label={extended ? undefined : label}
      title={extended ? undefined : label}
      {...props}
    >
      {icon}
      {extended && <span>{label}</span>}
    </button>
  );
}
