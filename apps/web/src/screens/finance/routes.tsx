import { lazy, Suspense, type ComponentType } from 'react';
import type { ScreenId } from '@casino/shared';

const Bank = lazy(() => import('./BankScreen.tsx'));
const Loans = lazy(() => import('./LoansScreen.tsx'));
const Kyosai = lazy(() => import('./KyosaiScreen.tsx'));
const Market = lazy(() => import('./MarketScreen.tsx'));
const Companies = lazy(() => import('./CompaniesScreen.tsx'));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="fin__loading">
          …
        </p>
      }
    >
      {children}
    </Suspense>
  );
}

const wrap = (name: string, element: () => React.ReactNode): ComponentType => {
  const Screen = () => <Lazy>{element()}</Lazy>;
  Screen.displayName = name;
  return Screen;
};

/** Finance screens. Each loads its own chunk the first time the screen opens. */
export const financeRoutes: Partial<Record<ScreenId, ComponentType>> = {
  bank: wrap('Bank', () => <Bank />),
  loans: wrap('Loans', () => <Loans />),
  kyosai: wrap('Kyosai', () => <Kyosai />),
  market: wrap('Market', () => <Market />),
  stocks: wrap('Stocks', () => <Market screen="stocks" initialTab="trade" initialSymbol="teio" />),
  crypto: wrap('Crypto', () => <Market screen="crypto" initialTab="trade" initialSymbol="cs" />),
  companies: wrap('Companies', () => <Companies />),
};
