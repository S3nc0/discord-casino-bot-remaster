import { Snackbar } from '@casino/ui';
import { useT } from './i18n.ts';
import { useToastStore } from './stores/toasts.ts';

export const TOAST_LIFETIME_MS = 6_000;

/** Live toasts (socket `toast` and `inbox:new`, save errors), rendered with the kit's Snackbar. */
export function Toasts() {
  const t = useT();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <Snackbar
          key={toast.id}
          message={t(toast.messageKey, toast.params)}
          dismissLabel={t('toast.dismiss')}
          durationMs={TOAST_LIFETIME_MS}
          onDismiss={() => dismiss(toast.id)}
          data-tone={toast.tone}
        />
      ))}
    </div>
  );
}
