import { resolveLocale, t, type Locale } from '@casino/shared/i18n';
import { Surface } from '@casino/ui';

export interface AppProps {
  locale?: Locale;
}

/** Skeleton root. The Activity shell (auth, routing, socket) replaces this. */
export function App({ locale = resolveLocale({}) }: AppProps) {
  return (
    <Surface label={t(locale, 'app.name')}>
      <h1>{t(locale, 'app.name')}</h1>
    </Surface>
  );
}
