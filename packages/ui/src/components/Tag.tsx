import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils.ts';

export type TagHue =
  | 'neutral'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'magenta'
  | 'pink'
  | 'brown';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** Bitbloom semantic palette hue (uses container, on-container, and accent roles). */
  hue?: TagHue;
  /** Omit the pixel border when placed inside dense containers. */
  solid?: boolean;
  /** Optional leading 16px pixel icon. */
  icon?: ReactNode;
  /** Visible text label (pair hue with a word, never color alone). */
  children: ReactNode;
}

export function Tag({
  hue = 'neutral',
  solid = false,
  icon,
  children,
  className,
  ...props
}: TagProps) {
  return (
    <span
      className={cx(
        'bb-tag',
        hue !== 'neutral' && `bb-tag--${hue}`,
        solid && 'bb-tag--solid',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
