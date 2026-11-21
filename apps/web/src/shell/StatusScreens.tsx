import { errorMessageKey } from '@casino/shared/i18n';
import type { ErrorCode } from '@casino/shared';
import { useT } from './i18n.ts';
import type { ShellError } from './stores/session.ts';

export function LoadingScreen() {
  const t = useT();
  return (
    <div className="status" role="status">
      <p>{t('shell.loading')}</p>
    </div>
  );
}

export function messageKeyFor(error: ShellError): string {
  if (error === 'not_in_discord') return 'shell.notInDiscord';
  if (error === 'no_guild') return 'shell.noGuild';
  return errorMessageKey(error as ErrorCode);
}

export function ErrorScreen({
  error,
  onRetry,
}: {
  error: ShellError;
  onRetry?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <div className="status" role="alert">
      <p>{t(messageKeyFor(error))}</p>
      {onRetry && error !== 'not_in_discord' ? (
        <button type="button" onClick={onRetry}>
          {t('shell.retry')}
        </button>
      ) : null}
    </div>
  );
}
