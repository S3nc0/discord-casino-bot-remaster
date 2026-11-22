import { lazy, Suspense, type ComponentType } from 'react';
import type { ScreenId } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';

function Loading() {
  const t = useT();
  return (
    <p className="cc-status" role="status">
      {t('common.loading')}
    </p>
  );
}

function route(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Screen = lazy(load);
  return function CasinoRoute() {
    return (
      <Suspense fallback={<Loading />}>
        <Screen />
      </Suspense>
    );
  };
}

/** The casino slice's screens. Each loads on first visit, so Home stays small. */
export const casinoRoutes: Partial<Record<ScreenId, ComponentType>> = {
  chinchiro: route(() => import('./ChinchiroScreen.tsx')),
  slots: route(() => import('./SlotsScreen.tsx')),
  roulette: route(() => import('./RouletteScreen.tsx')),
  pachinko: route(() => import('./PachinkoScreen.tsx')),
  blackjack: route(() => import('./BlackjackScreen.tsx')),
  daily: route(() => import('./DailyScreen.tsx')),
  history: route(() => import('./HistoryScreen.tsx')),
};
