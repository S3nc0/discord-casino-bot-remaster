import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cx } from '../utils.ts';

export interface DialogProps {
  /** Controls visibility of the modal dialog. */
  open: boolean;
  /** Called on Esc, scrim click, or explicit dismiss. */
  onClose: () => void;
  /** Clear verb-led heading. */
  title: ReactNode;
  /** Plain-language summary of what will and won't happen. */
  description?: ReactNode;
  /** Optional leading icon rendered in secondary role color. */
  icon?: ReactNode;
  /** Action buttons rendered bottom-right (dismissive first, confirming last). */
  actions?: ReactNode;
  /** Optional extra body content. */
  children?: ReactNode;
  /** Semantic dialog role. Use 'alertdialog' for destructive confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** Allow closing on Escape key (default: true). */
  closeOnEscape?: boolean;
  /** Allow closing when clicking the scrim backdrop (default: true). */
  closeOnScrimClick?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  actions,
  children,
  role = 'dialog',
  closeOnEscape = true,
  closeOnScrimClick = true,
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      const dialogEl = dialogRef.current;
      if (dialogEl) {
        const focusables = dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const firstFocusable = focusables[0];
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          dialogEl.focus();
        }
      }
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        previousFocusRef.current?.focus();
        previousFocusRef.current = null;
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && closeOnEscape) {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'Tab') {
      const dialogEl = dialogRef.current;
      if (!dialogEl) return;
      const focusables = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        dialogEl.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;

      if (event.shiftKey) {
        if (document.activeElement === first || document.activeElement === dialogEl) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnScrimClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  const hasBody = Boolean(description || children);

  return (
    <div className="bb-scrim bb-scrim--modal" onClick={handleScrimClick} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className={cx('bb-dialog', className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasBody ? descId : undefined}
        tabIndex={-1}
      >
        {icon && <div className="bb-dialog__icon">{icon}</div>}
        <h2 className="bb-dialog__title" id={titleId}>
          {title}
        </h2>
        {hasBody && (
          <div className="bb-dialog__body" id={descId}>
            {description && <p className="bb-dialog__body">{description}</p>}
            {children}
          </div>
        )}
        {actions && <div className="bb-dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}
