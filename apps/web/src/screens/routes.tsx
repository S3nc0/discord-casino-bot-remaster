import type { ComponentType } from 'react';
import { SCREEN_IDS, type ScreenId } from '@casino/shared';
import { Card } from '@casino/ui';
import { screenName, useLocale, useT } from '../shell/i18n.ts';
import { useBalanceStore } from '../shell/stores/balance.ts';

/** Placeholder Home until the real one lands (F2). The balance is the hero. */
export function Home() {
  const t = useT();
  const locale = useLocale();
  const balance = useBalanceStore((s) => s.balance);
  return (
    <Card variant="elevated" title={screenName(locale, 'home')}>
      <div className="home">
        <p className="home__balance">
          <span className="home__amount">
            {balance !== null ? new Intl.NumberFormat(locale).format(balance) : '—'}
          </span>
          <span className="home__unit">{t('currency.name')}</span>
        </p>
        <p className="home__label">{t('shell.balance')}</p>
      </div>
      <p>{t('shell.placeholder')}</p>
    </Card>
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
