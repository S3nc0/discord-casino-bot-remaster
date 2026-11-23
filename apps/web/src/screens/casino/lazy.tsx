import { lazy, Suspense, type ComponentType } from 'react';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';

/** While a screen's chunk loads, its title and a loading line show, marked busy. */
function Loading({ screen }: { screen: ScreenId }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section data-screen={screen} aria-busy="true">
      <h1 className="cc-head__title">{screenName(locale, screen)}</h1>
      <p className="cc-status" role="status">
        {t('common.loading')}
      </p>
    </section>
  );
}

function route(screen: ScreenId, load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Screen = lazy(load);
  return function CasinoRoute() {
    return (
      <Suspense fallback={<Loading screen={screen} />}>
        <Screen />
      </Suspense>
    );
  };
}

/** The casino slice's screens. Each loads on first visit, so Home stays small. */
export const casinoRoutes: Partial<Record<ScreenId, ComponentType>> = {
  chinchiro: route('chinchiro', () => import('./ChinchiroScreen.tsx')),
  slots: route('slots', () => import('./SlotsScreen.tsx')),
  roulette: route('roulette', () => import('./RouletteScreen.tsx')),
  pachinko: route('pachinko', () => import('./PachinkoScreen.tsx')),
  blackjack: route('blackjack', () => import('./BlackjackScreen.tsx')),
  daily: route('daily', () => import('./DailyScreen.tsx')),
  history: route('history', () => import('./HistoryScreen.tsx')),
};
