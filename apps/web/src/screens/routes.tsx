import type { ComponentType } from 'react';
import { SCREEN_IDS, type ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from '../shell/i18n.ts';
import { HomeScreen } from '../shell/HomeScreen.tsx';

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
