import {
  createContext,
  useContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../utils.ts';

const ListContext = createContext<{ selectable: boolean }>({ selectable: false });

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function Avatar({ children, className, ...props }: AvatarProps) {
  return (
    <span className={cx('bb-avatar', className)} {...props}>
      {children}
    </span>
  );
}

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  /** Enables listbox/option semantics for selectable rows. */
  selectable?: boolean;
  /** Accessible list label. */
  label?: string;
  children: ReactNode;
}

export function List({ selectable = false, label, children, className, ...props }: ListProps) {
  return (
    <ListContext.Provider value={{ selectable }}>
      <ul
        className={cx('bb-list', className)}
        role={selectable ? 'listbox' : undefined}
        aria-label={label}
        {...props}
      >
        {children}
      </ul>
    </ListContext.Provider>
  );
}

export interface ListItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'onSelect'> {
  /** Primary row headline. */
  headline: ReactNode;
  /** Supporting line below the headline. */
  supportingText?: ReactNode;
  /** Leading avatar or pixel icon. */
  leading?: ReactNode;
  /** Trailing metadata (tabular numerals recommended). */
  trailing?: ReactNode;
  /** Selected state for selectable lists. */
  selected?: boolean;
  /** Click / keyboard activation handler. */
  onSelect?: () => void;
}

export function ListItem({
  headline,
  supportingText,
  leading,
  trailing,
  selected,
  onSelect,
  onClick,
  onKeyDown,
  className,
  role,
  tabIndex,
  ...props
}: ListItemProps) {
  const { selectable } = useContext(ListContext);
  const interactive = Boolean(onSelect || onClick || selectable);

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    onKeyDown?.(event);
    if (!event.defaultPrevented && interactive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelect?.();
    }
  };

  const resolvedRole = role ?? (selectable ? 'option' : onSelect ? 'button' : undefined);

  return (
    <li
      className={cx('bb-list__item', interactive && 'bb-state', className)}
      role={resolvedRole}
      aria-selected={selectable || selected !== undefined ? Boolean(selected) : undefined}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      onClick={(event) => {
        onClick?.(event);
        onSelect?.();
      }}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {leading ?? <span aria-hidden="true" />}
      <div>
        <span className="bb-list__headline">{headline}</span>
        {supportingText && <span className="bb-list__support">{supportingText}</span>}
      </div>
      {trailing && <span className="bb-list__trail">{trailing}</span>}
    </li>
  );
}
