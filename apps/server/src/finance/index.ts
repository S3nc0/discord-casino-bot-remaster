import { CompaniesService, type DayStateResolver } from './companies-service.ts';
import type { FinanceServices } from './jobs.ts';
import { KyosaiService } from './kyosai-service.ts';
import { P2pLoanService } from './p2p-loan-service.ts';
import { InMemoryMarketplaceAssetAdapter, PlayerMarketService } from './player-market-service.ts';
import { StocksService } from './stocks-service.ts';
import { TeiaiService } from './teiai-service.ts';
import type { FinanceDeps, MarketplaceAssetAdapter, TeiaiCrossHooks } from './types.ts';

export * from './types.ts';
export * from './teiai-service.ts';
export * from './p2p-loan-service.ts';
export * from './kyosai-service.ts';
export * from './stocks-service.ts';
export * from './companies-service.ts';
export * from './player-market-service.ts';
export * from './jobs.ts';

export interface CreateFinanceServicesOptions {
  /** Player market item/horse ownership adapter (defaults to an in-memory adapter for standalone/tests). */
  readonly marketplaceAssets?: MarketplaceAssetAdapter;
  /** Optional custom company day-state resolver (defaults to deterministic SHA-256 resolver). */
  readonly companyDayStateResolver?: DayStateResolver;
  /** Optional external liquidation hook for shop items / horses owned by B2-B. */
  readonly liquidateExternalAssets?: TeiaiCrossHooks['liquidateExternalAssets'];
  /** Relics Teiai lists per guild per UTC day on the player market (0 = off, the default). */
  readonly relicAuctionPerDay?: number;
}

/**
 * Instantiate all six finance server services and wire their cross-service Teiai Bank hooks
 * (garnishment, forced execution seizures, bankruptcy liquidation, grace pull-backs, and excess-loss charges).
 */
export function createFinanceServices(
  deps: FinanceDeps,
  options: CreateFinanceServicesOptions = {},
): FinanceServices {
  const teiai = new TeiaiService(deps);
  const loans = new P2pLoanService(deps, teiai);
  const kyosai = new KyosaiService(deps, teiai);
  const stocks = new StocksService(deps, teiai);
  const companies = new CompaniesService(deps, teiai, {
    resolveDayState: options.companyDayStateResolver,
  });
  const assets = options.marketplaceAssets ?? new InMemoryMarketplaceAssetAdapter();
  const playerMarket = new PlayerMarketService(deps, teiai, assets, {
    relicAuctionPerDay: options.relicAuctionPerDay ?? 0,
  });

  teiai.registerHooks({
    getActiveBondPrincipal: (guildId) => stocks.getActiveBondPrincipal(guildId),
    getMarginRatio: (guildId, userId) => {
      const status = stocks.getPortfolioMarginStatus(guildId, userId);
      return status.required > 0 ? status.ratio : null;
    },
    hasOverdueLoan: (guildId, userId) => loans.hasOverdueLoan(guildId, userId),
    garnishOverdueLoans: (guildId, userId, budget, nowMs) =>
      loans.garnishOverdue(guildId, userId, budget, nowMs),
    chargeKyosaiExcess: (guildId, amount, nowMs) => kyosai.chargeExcess(guildId, amount, nowMs),
    seizeCompanyFunds: (guildId, userId, need) => companies.seizeFunds(guildId, userId, need),
    seizeSecurities: (guildId, userId, need, nowMs) =>
      stocks.seizeSecurities(guildId, userId, need, nowMs),
    onGraceOrBankruptcyPullBack: (guildId, userId, nowMs) => {
      kyosai.pullBackBids(guildId, userId);
      playerMarket.pullBackForUser(guildId, userId, nowMs);
    },
    liquidateSecuritiesForBankruptcy: (guildId, userId, nowMs) =>
      stocks.liquidateAllForBankruptcy(guildId, userId, nowMs),
    liquidateCompanyForBankruptcy: (guildId, userId, nowMs) =>
      companies.liquidateForBankruptcy(guildId, userId, nowMs),
    recoverKyosaiOnBankruptcy: (guildId, userId) =>
      kyosai.recoverUnitsOnBankruptcy(guildId, userId),
    liquidateExternalAssets: options.liquidateExternalAssets,
    listJuniorLoansForBankruptcy: (guildId, userId, nowMs) =>
      loans.listJuniorLoansForBankruptcy(guildId, userId, nowMs),
    applyJuniorLoanSettlements: (guildId, settlements, nowMs) =>
      loans.applyJuniorLoanSettlements(guildId, settlements, nowMs),
  });

  return {
    store: deps.store,
    teiai,
    loans,
    kyosai,
    stocks,
    companies,
    playerMarket,
  };
}
