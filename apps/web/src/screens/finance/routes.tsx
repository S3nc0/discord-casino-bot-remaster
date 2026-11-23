import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';

const Bank = lazy(() => import('./BankScreen.tsx'));
const Loans = lazy(() => import('./LoansScreen.tsx'));
const Kyosai = lazy(() => import('./KyosaiScreen.tsx'));
const Market = lazy(() => import('./MarketScreen.tsx'));
const Companies = lazy(() => import('./CompaniesScreen.tsx'));

/**
 * While a screen's chunk loads, the title and a loading line show instead of a blank page, marked
 * busy so assistive tech (and the route test) know the screen is not in yet.
 */
function Loading({ screen }: { screen: ScreenId }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="fin" data-screen={screen} aria-busy="true">
      <h1 className="fin__title">{screenName(locale, screen)}</h1>
      <p role="status" className="fin__loading">
        {t('common.loading')}
      </p>
    </section>
  );
}

const wrap = (screen: ScreenId, element: () => ReactNode): ComponentType => {
  const Screen = () => <Suspense fallback={<Loading screen={screen} />}>{element()}</Suspense>;
  Screen.displayName = `Finance(${screen})`;
  return Screen;
};

/** Finance screens. Each loads its own chunk the first time the screen opens. */
export const financeRoutes: Partial<Record<ScreenId, ComponentType>> = {
  bank: wrap('bank', () => <Bank />),
  loans: wrap('loans', () => <Loans />),
  kyosai: wrap('kyosai', () => <Kyosai />),
  market: wrap('market', () => <Market />),
  stocks: wrap('stocks', () => <Market screen="stocks" initialTab="trade" initialSymbol="teio" />),
  crypto: wrap('crypto', () => <Market screen="crypto" initialTab="trade" initialSymbol="cs" />),
  companies: wrap('companies', () => <Companies />),
};
