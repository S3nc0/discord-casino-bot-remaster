import type { ComponentType } from 'react';
import { SCREEN_IDS, type ScreenId } from '@casino/shared';
import { formatPelica, screenName, useLocale, useT } from '../shell/i18n.ts';
import { useBalanceStore } from '../shell/stores/balance.ts';

/** Placeholder Home until the real one lands (F2). */
export function Home() {
  const t = useT();
  const locale = useLocale();
  const balance = useBalanceStore((s) => s.balance);
  return (
    <section className="panel" aria-labelledby="home-title">
      <h1 id="home-title">{screenName(locale, 'home')}</h1>
      {balance !== null ? (
        <p>
          {t('shell.balance')}: {formatPelica(locale, balance)}
        </p>
      ) : null}
      <p>{t('shell.placeholder')}</p>
    </section>
  );
}

/** Placeholder for every other screen id. */
export function GameRoute({ screen }: { screen: ScreenId }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="panel" aria-labelledby={`${screen}-title`} data-screen={screen}>
      <h1 id={`${screen}-title`}>{screenName(locale, screen)}</h1>
      <p>{t('shell.placeholder')}</p>
    </section>
  );
}

function routeFor(screen: ScreenId): ComponentType {
  if (screen === 'home') return Home;
  const Route = () => <GameRoute screen={screen} />;
  Route.displayName = `GameRoute(${screen})`;
  return Route;
}

/** One component per screen id. F2 replaces entries as screens are built. */
export const screenRoutes: Readonly<Record<ScreenId, ComponentType>> = Object.fromEntries(
  SCREEN_IDS.map((id) => [id, routeFor(id)]),
) as Record<ScreenId, ComponentType>;
