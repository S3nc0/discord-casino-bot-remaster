import type { Store } from '../db/store.ts';
import type { CompaniesService, CompanyBankruptcyNotice } from './companies-service.ts';
import type { KyosaiAuctionTickEvent, KyosaiMotionRow, KyosaiService } from './kyosai-service.ts';
import type { LoanRow, MaturityCollectionEntry, P2pLoanService } from './p2p-loan-service.ts';
import type { PlayerMarketService, SettledListingEntry } from './player-market-service.ts';
import type { BondRow, MarketTickSummary, OptionRow, StocksService } from './stocks-service.ts';
import type { TeiaiService } from './teiai-service.ts';
import { listKnownGuildIds } from './types.ts';

/** Standard JST UTC offset (`UTC_OFFSET_HOURS` default). */
export const FINANCE_JOB_UTC_OFFSET_HOURS = 9;
export const FINANCE_JOB_TIMEZONE = 'Asia/Tokyo';

/** Bundled finance services passed into plain scheduled job functions. */
export interface FinanceServices {
  readonly store: Store;
  readonly teiai: TeiaiService;
  readonly loans: P2pLoanService;
  readonly kyosai: KyosaiService;
  readonly stocks: StocksService;
  readonly companies: CompaniesService;
  readonly playerMarket: PlayerMarketService;
}

export interface MarketMinuteTickReport {
  readonly marketTick: MarketTickSummary;
  readonly marginInterestCharged: Record<string, number>;
  readonly lossCutUsers: Record<string, string[]>;
  readonly settledOptions: Record<string, OptionRow[]>;
  readonly settledBonds: Record<
    string,
    { readonly matured: BondRow[]; readonly defaulted: BondRow[] }
  >;
}

/**
 * 1-minute market loop:
 * - advances global correlated prices, daily limits, volatility events, and weekly earnings;
 * - accrues cross-margin interest (CODE behaviour), runs loss-cuts, settles expired options and bonds.
 */
export function runMarketMinuteTick(
  services: FinanceServices,
  nowMs?: number,
): MarketMinuteTickReport {
  const guilds = listKnownGuildIds(services.store);
  const marketTick = services.stocks.tickMarket(nowMs);
  const marginInterestCharged: Record<string, number> = {};
  const lossCutUsers: Record<string, string[]> = {};
  const settledOptions: Record<string, OptionRow[]> = {};
  const settledBonds: Record<
    string,
    { readonly matured: BondRow[]; readonly defaulted: BondRow[] }
  > = {};

  for (const guildId of guilds) {
    marginInterestCharged[guildId] = services.stocks.accrueAllMarginInterest(guildId, nowMs);
    lossCutUsers[guildId] = services.stocks.enforceLossCuts(guildId, nowMs);
    settledOptions[guildId] = services.stocks.settleExpiredOptions(guildId, nowMs);
    settledBonds[guildId] = services.stocks.settleBonds(guildId, nowMs);
  }

  return {
    marketTick,
    marginInterestCharged,
    lossCutUsers,
    settledOptions,
    settledBonds,
  };
}

export interface TeiaiMinuteTickReport {
  readonly expiredGraceBankruptcies: Record<string, string[]>;
  readonly expiredCdsCount: Record<string, number>;
  readonly trustInterestPaid: Record<string, number>;
  readonly riskFreeRates: Record<string, number>;
}

/**
 * 1-minute Teiai Bank loop:
 * - expires 24h bankruptcy grace periods (forced bankruptcy) and 7-day CDS policies;
 * - steps per-guild CIR risk-free rate `r_f` (every 60m);
 * - accrues trust-deposit interest (every 24h).
 */
export function runTeiaiMinuteTick(
  services: FinanceServices,
  nowMs?: number,
): TeiaiMinuteTickReport {
  const guilds = listKnownGuildIds(services.store);
  const expiredGraceBankruptcies: Record<string, string[]> = {};
  const expiredCdsCount: Record<string, number> = {};
  const trustInterestPaid: Record<string, number> = {};
  const riskFreeRates: Record<string, number> = {};

  for (const guildId of guilds) {
    const grace = services.teiai.settleExpiredGraceAndCds(guildId, nowMs);
    expiredGraceBankruptcies[guildId] = grace.forcedBankruptcies.map((b) => b.userId);
    expiredCdsCount[guildId] = grace.expiredCds;
    riskFreeRates[guildId] = services.teiai.tickRiskFreeRate(guildId, nowMs);
    trustInterestPaid[guildId] = services.teiai.accrueTrustInterest(guildId, nowMs);
  }

  return {
    expiredGraceBankruptcies,
    expiredCdsCount,
    trustInterestPaid,
    riskFreeRates,
  };
}

export interface LoanMinuteTickReport {
  readonly collected: Record<string, MaturityCollectionEntry[]>;
  readonly reminded: Record<string, LoanRow[]>;
  readonly expiredOffers: Record<string, number>;
}

/**
 * 1-minute P2P loan loop:
 * - auto-collects matured loans (or transitions to overdue);
 * - emits `LoanDue` reminders within 24h of maturity;
 * - expires pending offers/requests past 24h.
 */
export function runLoanMinuteTick(services: FinanceServices, nowMs?: number): LoanMinuteTickReport {
  const guilds = listKnownGuildIds(services.store);
  const collected: Record<string, MaturityCollectionEntry[]> = {};
  const reminded: Record<string, LoanRow[]> = {};
  const expiredOffers: Record<string, number> = {};

  for (const guildId of guilds) {
    collected[guildId] = services.loans.collectDue(guildId, nowMs);
    reminded[guildId] = services.loans.emitDueReminders(guildId, nowMs);
    expiredOffers[guildId] = services.loans.expireOffers(guildId, nowMs);
  }

  return { collected, reminded, expiredOffers };
}

export interface KyosaiMinuteTickReport {
  readonly dividendsPaid: Record<string, number>;
  readonly closedMotions: Record<string, KyosaiMotionRow[]>;
  readonly auctionEvents: Record<string, KyosaiAuctionTickEvent[]>;
}

/**
 * 1-minute Kyosai loop:
 * - distributes daily Hamilton dividends (once per JST day);
 * - closes expired governance motions and applies enacted changes;
 * - opens / settles 24h unit auctions.
 */
export function runKyosaiMinuteTick(
  services: FinanceServices,
  nowMs?: number,
): KyosaiMinuteTickReport {
  const guilds = listKnownGuildIds(services.store);
  const dividendsPaid: Record<string, number> = {};
  const closedMotions: Record<string, KyosaiMotionRow[]> = {};
  const auctionEvents: Record<string, KyosaiAuctionTickEvent[]> = {};

  for (const guildId of guilds) {
    const div = services.kyosai.runDailyDividend(guildId, nowMs);
    dividendsPaid[guildId] = div.dividendPaid;
    closedMotions[guildId] = services.kyosai.closeExpiredMotions(guildId, nowMs);
    auctionEvents[guildId] = services.kyosai.tickAuctions(guildId, nowMs);
  }

  return { dividendsPaid, closedMotions, auctionEvents };
}

export interface CompanyMaintenanceTickReport {
  readonly bankruptcies: Record<string, CompanyBankruptcyNotice[]>;
}

/**
 * Company daily state / upkeep maintenance job:
 * - advances company production and daily JST upkeep settlement;
 * - emits `CompanyBankrupt` after 3 consecutive unpaid days.
 */
export function runCompanyMaintenanceTick(
  services: FinanceServices,
  nowMs?: number,
): CompanyMaintenanceTickReport {
  const guilds = listKnownGuildIds(services.store);
  const bankruptcies: Record<string, CompanyBankruptcyNotice[]> = {};

  for (const guildId of guilds) {
    bankruptcies[guildId] = services.companies.settleAll(guildId, nowMs);
  }

  return { bankruptcies };
}

export interface PlayerMarketSettleTickReport {
  readonly settled: Record<string, SettledListingEntry[]>;
}

/**
 * 1-minute Player Market loop:
 * - settles expired timed auctions (winner payout + 5% fee) and expired fixed/no-bid listings.
 */
export function runPlayerMarketSettleTick(
  services: FinanceServices,
  nowMs?: number,
): PlayerMarketSettleTickReport {
  const guilds = listKnownGuildIds(services.store);
  const settled: Record<string, SettledListingEntry[]> = {};

  for (const guildId of guilds) {
    settled[guildId] = services.playerMarket.settleExpired(guildId, nowMs);
  }

  return { settled };
}

/** Descriptor for B1's croner scheduler runner (all cron expressions in JST / `UTC_OFFSET_HOURS = 9`). */
export interface FinanceScheduledJobSpec {
  readonly id: string;
  /** Standard 5-field cron expression evaluated in JST (`UTC_OFFSET_HOURS = 9`). */
  readonly cron: string;
  readonly timezone: typeof FINANCE_JOB_TIMEZONE;
  readonly utcOffsetHours: typeof FINANCE_JOB_UTC_OFFSET_HOURS;
  readonly description: string;
  readonly run: (services: FinanceServices, nowMs?: number) => unknown;
}

/**
 * Scheduled job manifest for the finance module.
 * B1 wires these descriptors into the `croner` scheduler; B3 exposes pure exported functions only.
 */
export const FINANCE_JOBS: readonly FinanceScheduledJobSpec[] = [
  {
    id: 'finance:market-minute',
    cron: '* * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Advance correlated stock/crypto prices, volatility events, earnings, margin interest, loss-cuts, options, and bonds every minute.',
    run: runMarketMinuteTick,
  },
  {
    id: 'finance:teiai-minute',
    cron: '* * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Settle expired 24h bankruptcy grace periods and 7d CDS, step hourly CIR risk-free rate, and accrue 24h trust interest.',
    run: runTeiaiMinuteTick,
  },
  {
    id: 'finance:loans-minute',
    cron: '* * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Auto-collect matured P2P loans, emit 24h LoanDue reminders, and expire unaccepted offers/requests.',
    run: runLoanMinuteTick,
  },
  {
    id: 'finance:kyosai-minute',
    cron: '* * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Distribute daily JST Kyosai Hamilton dividends, close expired governance motions, and settle/open 72h unit auctions.',
    run: runKyosaiMinuteTick,
  },
  {
    id: 'finance:companies-daily',
    cron: '0 0 * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Settle daily JST company states, production output, upkeep deductions, and 3-day upkeep bankruptcies.',
    run: runCompanyMaintenanceTick,
  },
  {
    id: 'finance:companies-maintenance',
    cron: '*/10 * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Periodic catch-up company settlement every 10 minutes in case of process restarts across JST midnight.',
    run: runCompanyMaintenanceTick,
  },
  {
    id: 'finance:player-market-settle',
    cron: '* * * * *',
    timezone: FINANCE_JOB_TIMEZONE,
    utcOffsetHours: FINANCE_JOB_UTC_OFFSET_HOURS,
    description:
      'Settle expired Player Market timed auctions and fixed-price listings every minute.',
    run: runPlayerMarketSettleTick,
  },
];
