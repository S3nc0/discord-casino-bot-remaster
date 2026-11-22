import { lazy, Suspense, type ComponentType } from 'react';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale } from '../../shell/i18n.ts';

/**
 * A screen loaded on first use, so its code stays out of the first bundle. While it loads the
 * screen's title is already there.
 */
export function lazyScreen(
  screen: ScreenId,
  load: () => Promise<{ default: ComponentType }>,
): ComponentType {
  const Screen = lazy(load);
  function Loading() {
    const locale = useLocale();
    return (
      <section className="panel" data-screen={screen} aria-busy="true">
        <h1>{screenName(locale, screen)}</h1>
      </section>
    );
  }
  function LazyScreen() {
    return (
      <Suspense fallback={<Loading />}>
        <Screen />
      </Suspense>
    );
  }
  LazyScreen.displayName = `LazyScreen(${screen})`;
  return LazyScreen;
}
