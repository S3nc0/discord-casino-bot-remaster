import { Banner } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';

/** A failed call, in words, announced to screen readers. */
export function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useT();
  if (!errorKey) return null;
  return <Banner variant="error" title={t(errorKey)} role="alert" />;
}
