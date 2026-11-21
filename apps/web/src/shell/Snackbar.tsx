import { useEffect } from 'react';
import { useT } from './i18n.ts';
import { useToastStore, type ToastEntry } from './stores/toasts.ts';

export const TOAST_LIFETIME_MS = 5_000;

function ToastItem({ toast }: { toast: ToastEntry }) {
  const t = useT();
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const handle = setTimeout(() => dismiss(toast.id), TOAST_LIFETIME_MS);
    return () => clearTimeout(handle);
  }, [toast.id, dismiss]);
  return (
    <li className="snackbar__item" data-tone={toast.tone}>
      <span>{t(toast.messageKey, toast.params)}</span>
      <button type="button" className="snackbar__close" onClick={() => dismiss(toast.id)}>
        <span aria-hidden="true">×</span>
        <span className="sr-only">{t('toast.dismiss')}</span>
      </button>
    </li>
  );
}

/** Live toasts (socket `toast` and `inbox:new`, save errors). Minimal until packages/ui has Snackbar. */
export function Snackbar() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <ul className="snackbar" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ul>
  );
}
