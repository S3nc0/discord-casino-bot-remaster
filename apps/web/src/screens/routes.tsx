import type { ComponentType } from 'react';
import { SCREEN_IDS, type ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from '../shell/i18n.ts';
import { HomeScreen } from '../shell/HomeScreen.tsx';
import { financeRoutes } from './finance/routes.tsx';
import { lazyScreen } from './life/lazy.tsx';
import { casinoRoutes } from './casino/lazy.tsx';

/** Home: the balance hero and the game tiles live in the shell. F2 builds the rest on top. */
export function Home() {
  return <HomeScreen />;
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

/** Built screens, one line each, loaded on first use. Every other id shows the placeholder. */
const implemented: Partial<Record<ScreenId, ComponentType>> = {
  lottery: lazyScreen('lottery', () => import('./life/LotteryScreen.tsx')),
  missions: lazyScreen('missions', () => import('./life/MissionsScreen.tsx')),
  poll: lazyScreen('poll', () => import('./life/PollScreen.tsx')),
  quiz: lazyScreen('quiz', () => import('./life/QuizScreen.tsx')),
  ranking: lazyScreen('ranking', () => import('./life/RankingScreen.tsx')),
  shop: lazyScreen('shop', () => import('./life/ShopScreen.tsx')),
  transfer: lazyScreen('transfer', () => import('./life/TransferScreen.tsx')),
  work: lazyScreen('work', () => import('./life/LaborScreen.tsx')),
  relics: lazyScreen('relics', () => import('./life/RelicsScreen.tsx')),
  inventory: lazyScreen('inventory', () => import('./life/InventoryScreen.tsx')),
  profile: lazyScreen('profile', () => import('./profile/ProfileScreen.tsx')),
  ...financeRoutes,
  horse: lazyScreen('horse', () => import('./horse/HorseScreen.tsx')),
  arena: lazyScreen('arena', () => import('./horse/ArenaScreen.tsx')),
};

function routeFor(screen: ScreenId): ComponentType {
  if (screen === 'home') return Home;
  const built = implemented[screen];
  if (built) return built;
  const Route = () => <GameRoute screen={screen} />;
  Route.displayName = `GameRoute(${screen})`;
  return Route;
}

const placeholders = Object.fromEntries(SCREEN_IDS.map((id) => [id, routeFor(id)])) as Record<
  ScreenId,
  ComponentType
>;

/** One component per screen id. Each slice spreads its own screens over the placeholders. */
export const screenRoutes: Readonly<Record<ScreenId, ComponentType>> = {
  ...placeholders,
  ...casinoRoutes,
};
