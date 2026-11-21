import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { CloseIcon } from '../icons.tsx';
import { cx } from '../utils.ts';

export interface SnackbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Controls visibility (default: true). */
  open?: boolean;
  /** Short one-line feedback message. */
  message: ReactNode;
  /** Optional single action label (e.g., "Undo"). */
  actionLabel?: string;
  /** Called when the action button is clicked. */
  onAction?: () => void;
  /** Called when dismissed via button or auto-dismiss timer. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. */
  dismissLabel?: string;
  /** Auto-dismiss delay in ms when no action is present (enforces minimum 6000ms). */
  durationMs?: number;
}

export function Snackbar({
  open = true,
  message,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel = 'Dismiss',
  durationMs,
  className,
  ...props
}: SnackbarProps) {
  useEffect(() => {
    if (!open || durationMs === undefined || actionLabel || !onDismiss) {
      return;
    }
    const timer = setTimeout(onDismiss, Math.max(durationMs, 6000));
    return () => clearTimeout(timer);
  }, [open, durationMs, actionLabel, onDismiss]);

  if (!open) {
    return null;
  }

  return (
    <div className={cx('bb-snackbar', className)} role="status" aria-live="polite" {...props}>
      <span className="bb-snackbar__text">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="bb-btn bb-btn--text bb-state" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {!actionLabel && onDismiss && (
        <button
          type="button"
          className="bb-icon-btn bb-state"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
