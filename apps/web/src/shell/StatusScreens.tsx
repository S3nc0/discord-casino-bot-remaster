import { errorMessageKey } from '@casino/shared/i18n';
import type { ErrorCode } from '@casino/shared';
import { Button, Dialog, Progress } from '@casino/ui';
import { useT } from './i18n.ts';
import type { ShellError } from './stores/session.ts';

export function LoadingScreen() {
  const t = useT();
  return (
    <div className="status">
      <Progress label={t('shell.loading')} />
    </div>
  );
}

export function messageKeyFor(error: ShellError): string {
  if (error === 'not_in_discord') return 'shell.notInDiscord';
  if (error === 'no_guild') return 'shell.noGuild';
  return errorMessageKey(error as ErrorCode);
}

/** Sign-in failed: a blocking dialog with the reason and, when it can help, a retry. */
export function ErrorScreen({
  error,
  onRetry,
}: {
  error: ShellError;
  onRetry?: (() => void) | undefined;
}) {
  const t = useT();
  const canRetry = onRetry !== undefined && error !== 'not_in_discord' && error !== 'no_guild';
  return (
    <div className="status">
      <Dialog
        open
        role="alertdialog"
        title={t('app.name')}
        description={t(messageKeyFor(error))}
        onClose={() => undefined}
        closeOnEscape={false}
        closeOnScrimClick={false}
        actions={canRetry ? <Button onClick={onRetry}>{t('shell.retry')}</Button> : undefined}
      />
    </div>
  );
}
