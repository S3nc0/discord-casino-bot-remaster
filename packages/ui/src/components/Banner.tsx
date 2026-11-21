import type { HTMLAttributes, ReactNode } from 'react';
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from '../icons.tsx';
import { cx } from '../utils.ts';

export type BannerVariant = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Semantic status role for the banner. */
  variant?: BannerVariant;
  /** Bold summary title (always shown so status is never color-only). */
  title: ReactNode;
  /** Optional custom 12x12 pixel icon; defaults to the variant icon. */
  icon?: ReactNode;
  /** Plain-language explanation and next action. */
  children?: ReactNode;
}

const DEFAULT_ICONS: Record<BannerVariant, ReactNode> = {
  info: <InfoIcon />,
  success: <CheckIcon />,
  warning: <WarningIcon />,
  error: <CloseIcon />,
};

export function Banner({
  variant = 'info',
  title,
  icon,
  children,
  className,
  role,
  ...props
}: BannerProps) {
  const resolvedRole = role ?? (variant === 'error' ? 'alert' : 'status');

  return (
    <div
      className={cx('bb-banner', `bb-banner--${variant}`, className)}
      role={resolvedRole}
      {...props}
    >
      {icon ?? DEFAULT_ICONS[variant]}
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}
