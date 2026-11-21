import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils.ts';

export interface NavigationBarItem {
  id: string;
  /** Always-visible short destination label. */
  label: string;
  /** 24px pixel icon. */
  icon: ReactNode;
  /** Optional numeric badge (>99 displays as 99+) or 'dot' badge. */
  badge?: number | 'dot';
  /** Screen-reader description for the badge (e.g., "3 new items"). */
  badgeLabel?: string;
  disabled?: boolean;
}

export interface NavigationBarProps extends Omit<HTMLAttributes<HTMLElement>, 'onSelect'> {
  /** Navigation destinations (3-5 recommended). */
  items: readonly NavigationBarItem[];
  /** Currently active destination id. */
  activeId: string;
  /** Called when a destination is selected. */
  onSelect: (id: string) => void;
  /** Accessible label for the navigation landmark. */
  label?: string;
}

export function NavigationBar({
  items,
  activeId,
  onSelect,
  label = 'Main',
  className,
  ...props
}: NavigationBarProps) {
  return (
    <nav className={cx('bb-navbar', className)} aria-label={label} {...props}>
      {items.map((item) => {
        const isCurrent = item.id === activeId;
        const badgeText =
          typeof item.badge === 'number' && item.badge > 0
            ? item.badge > 99
              ? '99+'
              : String(item.badge)
            : null;

        return (
          <button
            key={item.id}
            type="button"
            className="bb-nav-item"
            aria-current={isCurrent ? 'page' : undefined}
            disabled={item.disabled}
            onClick={() => onSelect(item.id)}
          >
            <span className="bb-nav-item__ind">
              {item.icon}
              {item.badge === 'dot' && (
                <span className="bb-badge bb-badge--dot" aria-label={item.badgeLabel ?? 'New'} />
              )}
              {badgeText !== null && (
                <span
                  className="bb-badge"
                  aria-label={item.badgeLabel ?? `${item.badge} new items`}
                >
                  {badgeText}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
