import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PRICE_SCALE,
  manualClock,
  createSeededRng,
  type DomainEvent,
  type Rng,
} from '@casino/shared';
import {
  COMPANY_KINDS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  type CompanyDayState,
} from '@casino/domain/finance';
import { IdentityRepo } from '../db/identity.ts';
import { EconomyService } from '../economy/economy-service.ts';
import { EventBus } from '../runtime/bus.ts';
import { GUILD, OTHER_GUILD, memoryStore } from '../runtime/test-kit.ts';
import {
  FINANCE_JOBS,
  InMemoryMarketplaceAssetAdapter,
  createFinanceServices,
  runCompanyMaintenanceTick,
  runKyosaiMinuteTick,
  runLoanMinuteTick,
  runMarketMinuteTick,
  runPlayerMarketSettleTick,
  runTeiaiMinuteTick,
  type CreateFinanceServicesOptions,
} from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '../../../../tests/fixtures/legacy');

function loadFixture<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_ROOT, relPath), 'utf8')) as T;
}

const U1 = '200000000000000001';
const U2 = '200000000000000002';
const U3 = '200000000000000003';
const BASE_SEC = 1_736_121_600; // 2025-01-06T00:00:00Z (09:00 JST)
const BASE_MS = BASE_SEC * 1_000;

function makeTestEnv(
  startMs = BASE_MS,
  seed = 12345,
  options: CreateFinanceServicesOptions = {},
) {
  const store = memoryStore();
  const clock = manualClock(startMs);
  const bus = new EventBus();
  const rng = createSeededRng(seed);
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const assets =
    (options.marketplaceAssets as InMemoryMarketplaceAssetAdapter | undefined) ??
    new InMemoryMarketplaceAssetAdapter();
  const services = createFinanceServices(
    { store, economy, identity, clock, rng, bus, utcOffsetHours: 9 },
    { ...options, marketplaceAssets: assets },
  );
  const domainEvents: DomainEvent[] = [];
  bus.onAnyDomain((ev) => domainEvents.push(ev));

  function seedBalance(guildId: string, userId: string, balance: number) {
    economy.ensureMember(guildId, userId, { initialGrant: false });
    if (balance > 0) {
      economy.credit({
        guildId,
        userId,
        amount: balance,
        reason: 'admin_grant',
      });
    }
  }

  return { store, clock, bus, rng, economy, assets, services, domainEvents, seedBalance };
}

function fixedRng(val: number): Rng {
  return {
    float: () => val,
    int: (min, max) => Math.min(max, Math.max(min, Math.floor(min + val * (max - min + 1)))),
  };
}

// ============================================================================
// 1. Legacy db_flow Parity Tests (all 6 finance fixture suites)
// ============================================================================

describe('legacy db_flow parity', () => {
  it('replays teiai/bank_debt.json db_flow to exact Pelica parity', () => {
    interface TeiaiFixture {
      db_flow: {
        deposit_40k: [boolean, number];
        bank_status_initial: {
          cash: number;
          loaned: number;
          deposits: number;
          available: number;
          ratio: number;
          level: string;
          thermostat: { capacity: number; load: number; room: number; enforce: boolean };
        };
        trust_accrue_24h: number;
        withdraw_10k: [boolean, number];
        user1_deposit_after: number;
        borrow_seed: [boolean, number];
        cds_quote: { status: string; debt: number; grace: boolean; odds: number };
        cds_buy: [boolean, number];
        debt_before_interest: number;
        interest_3d: number;
        escape_attempt: [boolean, { escaped: boolean; fine: number; debt: number }];
        forced_bankruptcy: [
          boolean,
          {
            forced: boolean;
            seized: number;
            senior_paid: number;
            junior_paid: number;
            compressed: number;
            forgiven: number;
            seed: number;
            debt: number;
            cds_paid: number;
            shop_value: number;
          },
        ];
        user2_balance_after: number;
        user2_debt_after: number;
        user3_balance_after_cds: number;
      };
    }

    const fx = loadFixture<TeiaiFixture>('teiai/bank_debt.json').db_flow;
    const { economy, services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);

    seedBalance(GUILD, U1, 100_000);
    seedBalance(GUILD, U2, 0);
    seedBalance(GUILD, U3, 50_000);

    const dep = services.teiai.bankDeposit(GUILD, U1, 40_000, BASE_MS);
    expect(dep.ok).toBe(fx.deposit_40k[0]);
    if (dep.ok) expect(dep.data).toBe(fx.deposit_40k[1]);

    const st = services.teiai.getBankStatus(GUILD, BASE_MS);
    expect(st.cash).toBe(fx.bank_status_initial.cash);
    expect(st.loaned).toBe(fx.bank_status_initial.loaned);
    expect(st.deposits).toBe(fx.bank_status_initial.deposits);
    expect(st.available).toBe(fx.bank_status_initial.available);
    expect(st.ratio).toBeCloseTo(fx.bank_status_initial.ratio, 10);
    expect(st.level).toBe(fx.bank_status_initial.level);
    expect(st.thermostat.capacity).toBe(fx.bank_status_initial.thermostat.capacity);
    expect(st.thermostat.enforce).toBe(fx.bank_status_initial.thermostat.enforce);

    // First accrual initializes trust_at and pays 0
    expect(services.teiai.accrueTrustInterest(GUILD, BASE_MS + MS_PER_DAY)).toBe(
      fx.trust_accrue_24h,
    );

    const wd = services.teiai.bankWithdraw(GUILD, U1, 10_000, BASE_MS + MS_PER_DAY);
    expect(wd.ok).toBe(fx.withdraw_10k[0]);
    if (wd.ok) expect(wd.data).toBe(fx.withdraw_10k[1]);
    expect(services.teiai.getDeposit(GUILD, U1)).toBe(fx.user1_deposit_after);

    const seed = services.teiai.borrowSeed(GUILD, U2, BASE_MS + MS_PER_DAY);
    expect(seed.ok).toBe(fx.borrow_seed[0]);
    if (seed.ok) expect(seed.data).toBe(fx.borrow_seed[1]);

    // Add 7,000 deficit -> forced execution seizes 3,000 cash + 4,000 debt + 3,000 auto-seed = 10,000 debt
    services.teiai.owe(GUILD, U2, 7_000, { refType: 'test_deficit', nowMs: BASE_MS + MS_PER_DAY });
    const quote = services.teiai.quoteCds(GUILD, U2);
    expect(quote.status).toBe(fx.cds_quote.status);
    expect(quote.debt).toBe(fx.cds_quote.debt);
    expect(quote.grace).toBe(fx.cds_quote.grace);
    expect(quote.odds).toBeCloseTo(fx.cds_quote.odds, 10);

    const buy = services.teiai.buyCds(GUILD, U3, U2, 5_000, BASE_MS + MS_PER_DAY);
    expect(buy.ok).toBe(fx.cds_buy[0]);
    if (buy.ok) expect(buy.data.odds).toBeCloseTo(fx.cds_buy[1], 10);

    // Add 9,000 deficit -> debt reaches 19,000 and enters 24h bankruptcy grace
    services.teiai.owe(GUILD, U2, 9_000, {
      refType: 'test_deficit_2',
      nowMs: BASE_MS + MS_PER_DAY,
    });
    expect(services.teiai.getDebt(GUILD, U2)).toBe(fx.debt_before_interest);
    expect(services.teiai.isInGrace(GUILD, U2)).toBe(true);
    expect(domainEvents.some((e) => e.type === 'BankruptcyGraceStarted' && e.userId === U2)).toBe(
      true,
    );

    // Interest ceiling 14,999 -> 0 additional interest while debt >= 14,999
    expect(services.teiai.accrueDebtInterest(GUILD, U2, BASE_MS + 4 * MS_PER_DAY)).toBe(
      fx.interest_3d,
    );

    // Failed escape attempt (roll = 0.99 >= 0.05) -> 10% fine (1,900) -> debt 20,900
    const esc = services.teiai.escapeAttempt(
      GUILD,
      U2,
      BASE_MS + 4 * MS_PER_DAY,
      fixedRng(0.99),
    );
    expect(esc.ok).toBe(fx.escape_attempt[0]);
    if (esc.ok) {
      expect(esc.data.escaped).toBe(fx.escape_attempt[1].escaped);
      expect(esc.data.fine).toBe(fx.escape_attempt[1].fine);
      expect(esc.data.debt).toBe(fx.escape_attempt[1].debt);
    }

    // Forced bankruptcy -> exact waterfall + CDS payout
    const br = services.teiai.declareBankruptcy(GUILD, U2, {
      forced: true,
      nowMs: BASE_MS + 4 * MS_PER_DAY,
    });
    expect(br.ok).toBe(fx.forced_bankruptcy[0]);
    if (br.ok) {
      expect(br.data.forced).toBe(fx.forced_bankruptcy[1].forced);
      expect(br.data.seized).toBe(fx.forced_bankruptcy[1].seized);
      expect(br.data.seniorPaid).toBe(fx.forced_bankruptcy[1].senior_paid);
      expect(br.data.juniorPaid).toBe(fx.forced_bankruptcy[1].junior_paid);
      expect(br.data.compressed).toBe(fx.forced_bankruptcy[1].compressed);
      expect(br.data.forgiven).toBe(fx.forced_bankruptcy[1].forgiven);
      expect(br.data.seed).toBe(fx.forced_bankruptcy[1].seed);
      expect(br.data.debt).toBe(fx.forced_bankruptcy[1].debt);
      expect(br.data.cdsPaid).toBe(fx.forced_bankruptcy[1].cds_paid);
      expect(br.data.shopValue).toBe(fx.forced_bankruptcy[1].shop_value);
    }
    expect(economy.getBalance(GUILD, U2)).toBe(fx.user2_balance_after);
    expect(services.teiai.getDebt(GUILD, U2)).toBe(fx.user2_debt_after);
    expect(economy.getBalance(GUILD, U3)).toBe(fx.user3_balance_after_cds);
    expect(
      domainEvents.some(
        (e) => e.type === 'BankruptcyDeclared' && e.userId === U2 && e.cause === 'forced',
      ),
    ).toBe(true);
  });

  it('replays p2p-loans/loans.json db_flow to exact Pelica parity', () => {
    interface LoanFixture {
      db_flow: {
        offer: [boolean, number];
        accept: [boolean, string];
        repay_partial_3000: [boolean, number];
        remaining_after_partial: number;
        collect_due_day6: {
          collected: number;
          left: number;
          paid: number;
          status: string;
        }[];
        lender_balance_after: number;
        borrower_balance_after: number;
      };
    }

    const fx = loadFixture<LoanFixture>('p2p-loans/loans.json').db_flow;
    const { economy, services, seedBalance } = makeTestEnv(BASE_MS);

    seedBalance(GUILD, U1, 50_000);
    seedBalance(GUILD, U2, 5_000);

    // 1.5%/day = 150 bps, 5 days
    const offer = services.loans.offerLoan({
      guildId: GUILD,
      lenderId: U1,
      borrowerId: U2,
      principal: 10_000,
      rateBps: 150,
      termDays: 5,
      channelId: '111',
      nowMs: BASE_MS,
    });
    expect(offer.ok).toBe(fx.offer[0]);
    const loanId = offer.ok ? offer.data : 0;
    expect(loanId).toBe(fx.offer[1]);

    const acceptAt = BASE_MS + 60_000;
    const acc = services.loans.acceptOffer(GUILD, loanId, U2, acceptAt);
    expect(acc.ok).toBe(fx.accept[0]);

    const repayAt = acceptAt + 2 * MS_PER_DAY;
    const rep = services.loans.repayLoan(GUILD, loanId, U2, 3_000, repayAt);
    expect(rep.ok).toBe(fx.repay_partial_3000[0]);
    if (rep.ok) expect(rep.data).toBe(fx.repay_partial_3000[1]);

    const loanMid = services.loans.getLoan(loanId)!;
    expect(services.loans.remainingOf(loanMid, repayAt)).toBe(fx.remaining_after_partial);

    const dueResults = services.loans.collectDue(GUILD, acceptAt + 6 * MS_PER_DAY);
    expect(dueResults).toHaveLength(1);
    expect(dueResults[0]!.collected).toBe(fx.collect_due_day6[0]!.collected);
    expect(dueResults[0]!.left).toBe(fx.collect_due_day6[0]!.left);
    expect(dueResults[0]!.loan.paid).toBe(fx.collect_due_day6[0]!.paid);
    expect(dueResults[0]!.loan.status).toBe(fx.collect_due_day6[0]!.status);

    expect(economy.getBalance(GUILD, U1)).toBe(fx.lender_balance_after);
    expect(economy.getBalance(GUILD, U2)).toBe(fx.borrower_balance_after);
  });

  it('replays kyosai/operations.json db_flow to exact parity', () => {
    interface KyosaiFixture {
      db_flow: {
        auction_open: { event: string; id: number; units: number; ends: number }[];
        bid1: [boolean, { top_bid: number }];
        bid2: [boolean, { top_bid: number }];
        auction_settle: { event: string; id: number; top_bid: number; units: number }[];
        u2_units_after_auction: number;
        u2_status: {
          units: number;
          house: number;
          circulating: number;
          holders: number;
          pool: number;
          locked: boolean;
        };
        p2p_offer: [boolean, number];
        p2p_accept: [boolean, { fee: number; price: number; units: number }];
        u1_units_after: number;
        u2_units_after: number;
      };
    }

    const fx = loadFixture<KyosaiFixture>('kyosai/operations.json').db_flow;
    const { services, seedBalance } = makeTestEnv(BASE_MS);

    seedBalance(GUILD, U1, 200_000);
    seedBalance(GUILD, U2, 200_000);
    seedBalance(GUILD, U3, 200_000);

    const openEvents = services.kyosai.tickAuctions(GUILD, BASE_MS);
    expect(openEvents).toHaveLength(1);
    expect(openEvents[0]!.event).toBe(fx.auction_open[0]!.event);
    expect(openEvents[0]!.id).toBe(fx.auction_open[0]!.id);
    expect(openEvents[0]!.units).toBe(fx.auction_open[0]!.units);
    expect(openEvents[0]!.endsAtMs).toBe(fx.auction_open[0]!.ends * 1_000);

    const b1 = services.kyosai.bidAuction(GUILD, U1, 5_000, BASE_MS + 60_000);
    expect(b1.ok).toBe(fx.bid1[0]);
    if (b1.ok) expect(b1.data.top_bid).toBe(fx.bid1[1].top_bid);

    const b2 = services.kyosai.bidAuction(GUILD, U2, 6_000, BASE_MS + 120_000);
    expect(b2.ok).toBe(fx.bid2[0]);
    if (b2.ok) expect(b2.data.top_bid).toBe(fx.bid2[1].top_bid);

    const settleAt = BASE_MS + 72 * MS_PER_HOUR;
    const settleEvents = services.kyosai.tickAuctions(GUILD, settleAt);
    expect(settleEvents.map((e) => e.event)).toEqual(fx.auction_settle.map((e) => e.event));
    expect(settleEvents[0]!.topBid).toBe(fx.auction_settle[0]!.top_bid);
    expect(services.kyosai.getUserUnits(GUILD, U2)).toBe(fx.u2_units_after_auction);

    const st = services.kyosai.getStatus(GUILD, U2, settleAt);
    expect(st.units).toBe(fx.u2_status.units);
    expect(st.house).toBe(fx.u2_status.house);
    expect(st.circulating).toBe(fx.u2_status.circulating);
    expect(st.holders).toBe(fx.u2_status.holders);
    expect(st.pool).toBe(fx.u2_status.pool);
    expect(st.locked).toBe(fx.u2_status.locked);

    const offer = services.kyosai.createOffer(GUILD, U2, U1, 1, 8_000, settleAt + 60_000);
    expect(offer.ok).toBe(fx.p2p_offer[0]);
    const offerId = offer.ok ? offer.data : 0;
    expect(offerId).toBe(fx.p2p_offer[1]);

    const accepted = services.kyosai.acceptOffer(GUILD, U1, offerId, settleAt + 120_000);
    expect(accepted.ok).toBe(fx.p2p_accept[0]);
    if (accepted.ok) {
      expect(accepted.data.fee).toBe(fx.p2p_accept[1].fee);
      expect(accepted.data.price).toBe(fx.p2p_accept[1].price);
      expect(accepted.data.units).toBe(fx.p2p_accept[1].units);
    }
    expect(services.kyosai.getUserUnits(GUILD, U1)).toBe(fx.u1_units_after);
    expect(services.kyosai.getUserUnits(GUILD, U2)).toBe(fx.u2_units_after);
  });

  it('replays crypto/spot.json db_flow to exact Pelica parity', () => {
    interface CryptoFixture {
      db_flow: {
        buy1: { ok: boolean; units: number; money: number; fee: number; balance: number };
        buy2: { ok: boolean; units: number; money: number; fee: number; balance: number };
        holdings_mid: [string, number, number][];
        sell_partial: {
          ok: boolean;
          units: number;
          money: number;
          fee: number;
          tax: number;
          profit: number;
          balance: number;
        };
        holdings_after: [string, number, number][];
        balance_after: number;
      };
    }

    const fx = loadFixture<CryptoFixture>('crypto/spot.json').db_flow;
    const { economy, services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);

    seedBalance(GUILD, U1, 100_000);
    services.stocks.setPrice('cs', 100 * PRICE_SCALE, BASE_MS);

    const b1 = services.stocks.buySpot(GUILD, U1, 'cs', 30_000, BASE_MS);
    expect(b1.ok).toBe(fx.buy1.ok);
    if (b1.ok) {
      expect(b1.data.unitsMilli).toBe(fx.buy1.units);
      expect(b1.data.money).toBe(fx.buy1.money);
      expect(b1.data.fee).toBe(fx.buy1.fee);
      expect(b1.data.balance).toBe(fx.buy1.balance);
    }

    services.stocks.setPrice('cs', 125 * PRICE_SCALE, BASE_MS + MS_PER_MINUTE);
    const b2 = services.stocks.buySpot(GUILD, U1, 'cs', 20_000, BASE_MS + MS_PER_MINUTE);
    expect(b2.ok).toBe(fx.buy2.ok);
    if (b2.ok) {
      expect(b2.data.unitsMilli).toBe(fx.buy2.units);
      expect(b2.data.money).toBe(fx.buy2.money);
      expect(b2.data.balance).toBe(fx.buy2.balance);
    }

    const mid = services.stocks.getSpotHoldings(GUILD, U1);
    expect(mid.map((h) => [h.symbol, h.units_milli, h.cost])).toEqual(fx.holdings_mid);

    services.stocks.setPrice('cs', 200 * PRICE_SCALE, BASE_MS + 2 * MS_PER_MINUTE);
    const s1 = services.stocks.sellSpot(GUILD, U1, 'cs', 200_000, BASE_MS + 2 * MS_PER_MINUTE);
    expect(s1.ok).toBe(fx.sell_partial.ok);
    if (s1.ok) {
      expect(s1.data.unitsMilli).toBe(fx.sell_partial.units);
      expect(s1.data.money).toBe(fx.sell_partial.money);
      expect(s1.data.tax).toBe(fx.sell_partial.tax);
      expect(s1.data.profit).toBe(fx.sell_partial.profit);
      expect(s1.data.balance).toBe(fx.sell_partial.balance);
    }

    const after = services.stocks.getSpotHoldings(GUILD, U1);
    expect(after.map((h) => [h.symbol, h.units_milli, h.cost])).toEqual(fx.holdings_after);
    expect(economy.getBalance(GUILD, U1)).toBe(fx.balance_after);
    expect(domainEvents.filter((e) => e.type === 'OrderFilled')).toHaveLength(3);
  });

  it('replays companies/operations.json db_flow to exact Pelica parity', () => {
    interface CompanyFixture {
      db_flow: {
        found: [
          boolean,
          {
            budget: number;
            daily_output: number;
            invested: number;
            stake_cap: number;
            storage_cap: number;
            upkeep: number;
            upkeep_day: string;
          },
        ];
        owner_invest: [boolean, number];
        stake_invest: [boolean, { amount: number; total: number }];
        set_dividend: [boolean, number];
        ship_12h: [boolean, { paid: number; pinhane: number; dividends: number; left: number }];
        state_after_ship: {
          budget: number;
          funds: number;
          withdrawable: number;
          sold_total: number;
          stakes_total: number;
          investors: number;
        };
        settle_36h: unknown[];
        u1_balance_after: number;
        u2_balance_after: number;
      };
    }

    const fx = loadFixture<CompanyFixture>('companies/operations.json').db_flow;
    // Pin the exact day state recorded in the fixture (drought: 0.5x yield, 1.46 Pelica/unit)
    const droughtCond = COMPANY_KINDS.farm.conditions.find((c) => c.key === 'drought')!;
    const pinnedDayState: CompanyDayState = {
      condition: droughtCond,
      priceMicros: Math.round(1.46 * PRICE_SCALE),
    };
    const { economy, services, seedBalance } = makeTestEnv(BASE_MS, 12345, {
      companyDayStateResolver: () => pinnedDayState,
    });

    seedBalance(GUILD, U1, 300_000);
    seedBalance(GUILD, U2, 200_000);

    const found = services.companies.foundCompany(GUILD, U1, '帝愛商事', 'farm', BASE_MS);
    expect(found.ok).toBe(fx.found[0]);
    if (found.ok) {
      expect(found.data.budget).toBe(fx.found[1].budget);
      expect(found.data.dailyOutput).toBe(fx.found[1].daily_output);
      expect(found.data.invested).toBe(fx.found[1].invested);
      expect(found.data.stakeCap).toBe(fx.found[1].stake_cap);
      expect(found.data.storageCap).toBe(fx.found[1].storage_cap);
      expect(found.data.upkeep).toBe(fx.found[1].upkeep);
      expect(found.data.upkeepDay).toBe(fx.found[1].upkeep_day);
    }

    const inv = services.companies.ownerInvest(GUILD, U1, 20_000);
    expect(inv.ok).toBe(fx.owner_invest[0]);
    if (inv.ok) expect(inv.data).toBe(fx.owner_invest[1]);

    const stake = services.companies.stakeInvest(GUILD, U2, U1, 10_000, BASE_MS);
    expect(stake.ok).toBe(fx.stake_invest[0]);
    if (stake.ok) {
      expect(stake.data.amount).toBe(fx.stake_invest[1].amount);
      expect(stake.data.total).toBe(fx.stake_invest[1].total);
    }

    const div = services.companies.setDividendRate(GUILD, U1, 3_000);
    expect(div.ok).toBe(fx.set_dividend[0]);
    if (div.ok) expect(div.data).toBeCloseTo(fx.set_dividend[1], 10);

    const ship = services.companies.ship(GUILD, U1, BASE_MS + 12 * MS_PER_HOUR);
    expect(ship.ok).toBe(fx.ship_12h[0]);
    if (ship.ok) {
      expect(ship.data.paid).toBe(fx.ship_12h[1].paid);
      expect(ship.data.pinhane).toBe(fx.ship_12h[1].pinhane);
      expect(ship.data.dividends).toBe(fx.ship_12h[1].dividends);
      expect(ship.data.leftStock).toBe(fx.ship_12h[1].left);
    }

    const stateAfter = services.companies.getCompanyState(GUILD, U1, BASE_MS + 12 * MS_PER_HOUR)!;
    expect(stateAfter.budget).toBe(fx.state_after_ship.budget);
    expect(stateAfter.funds).toBe(fx.state_after_ship.funds);
    expect(stateAfter.withdrawable).toBe(fx.state_after_ship.withdrawable);
    expect(stateAfter.soldTotal).toBe(fx.state_after_ship.sold_total);
    expect(stateAfter.stakesTotal).toBe(fx.state_after_ship.stakes_total);
    expect(stateAfter.investors).toBe(fx.state_after_ship.investors);

    const bankruptcies = services.companies.settleAll(GUILD, BASE_MS + 36 * MS_PER_HOUR);
    expect(bankruptcies).toEqual(fx.settle_36h);

    expect(economy.getBalance(GUILD, U1)).toBe(fx.u1_balance_after);
    expect(economy.getBalance(GUILD, U2)).toBe(fx.u2_balance_after);
  });

  it('replays player-market/listings.json db_flow to exact Pelica parity', () => {
    interface MarketFixture {
      db_flow: {
        list_fixed: [boolean, number];
        buy_fixed: [boolean, number];
        list_auction: [boolean, number];
        bid_u2: [boolean, number];
        bid_u3: [boolean, number];
        settled: [{ id: number; bid: number }, string][];
        balances_after: { u1: number; u2: number; u3: number };
      };
    }

    const fx = loadFixture<MarketFixture>('player-market/listings.json').db_flow;
    const { economy, assets, services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);

    // Mirror fixture setup: u1 starts 100k and buys 2x daily_double @ 3,000 -> u1=94,000
    seedBalance(GUILD, U1, 94_000);
    seedBalance(GUILD, U2, 100_000);
    seedBalance(GUILD, U3, 100_000);
    assets.grantItem(GUILD, U1, 'daily_double', 2);

    const l1 = services.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: U1,
      kind: 'item',
      ref: 'daily_double',
      qty: 1,
      mode: 'fixed',
      price: 3_000,
      nowMs: BASE_MS,
    });
    expect(l1.ok).toBe(fx.list_fixed[0]);
    const id1 = l1.ok ? l1.data : 0;
    expect(id1).toBe(fx.list_fixed[1]);

    const b1 = services.playerMarket.buyFixed(GUILD, U2, id1, BASE_MS + 60_000);
    expect(b1.ok).toBe(fx.buy_fixed[0]);
    if (b1.ok) expect(b1.data).toBe(fx.buy_fixed[1]);

    const l2 = services.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: U1,
      kind: 'item',
      ref: 'daily_double',
      qty: 1,
      mode: 'auction',
      price: 3_000,
      hours: 6,
      nowMs: BASE_MS,
    });
    expect(l2.ok).toBe(fx.list_auction[0]);
    const id2 = l2.ok ? l2.data : 0;
    expect(id2).toBe(fx.list_auction[1]);

    const bid2 = services.playerMarket.placeBid(GUILD, U2, id2, 3_000, BASE_MS + 120_000);
    expect(bid2.ok).toBe(fx.bid_u2[0]);
    if (bid2.ok) expect(bid2.data.endAtMs).toBe(fx.bid_u2[1] * 1_000);

    const bid3 = services.playerMarket.placeBid(GUILD, U3, id2, 3_500, BASE_MS + 180_000);
    expect(bid3.ok).toBe(fx.bid_u3[0]);
    if (bid3.ok) expect(bid3.data.endAtMs).toBe(fx.bid_u3[1] * 1_000);

    // Outbid event emitted for U2
    expect(
      domainEvents.some(
        (e) =>
          e.type === 'MarketplaceOutbid' &&
          e.userId === U2 &&
          e.listingId === id2 &&
          e.newBid === 3_500,
      ),
    ).toBe(true);

    const settled = services.playerMarket.settleExpired(GUILD, BASE_MS + 7 * MS_PER_HOUR);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.outcome).toBe(fx.settled[0]![1]);
    expect(settled[0]!.listing.id).toBe(fx.settled[0]![0].id);
    expect(settled[0]!.listing.bid).toBe(fx.settled[0]![0].bid);

    expect(economy.getBalance(GUILD, U1)).toBe(fx.balances_after.u1);
    expect(economy.getBalance(GUILD, U2)).toBe(fx.balances_after.u2);
    expect(economy.getBalance(GUILD, U3)).toBe(fx.balances_after.u3);
    expect(assets.getItemQty(GUILD, U2, 'daily_double')).toBe(1);
    expect(assets.getItemQty(GUILD, U3, 'daily_double')).toBe(1);
  });
});

// ============================================================================
// 2. Domain Events & Spec-Conflict CODE Behaviour Tests
// ============================================================================

describe('domain events and CODE behaviour for spec conflicts', () => {
  it('emits MarketTick and MarketMove on >=5% 15-minute move', () => {
    const { services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 10_000); // register guild in known guilds

    services.stocks.setPrice('cs', 1_000 * PRICE_SCALE, BASE_MS - 15 * MS_PER_MINUTE);
    services.stocks.setPrice('cs', 1_120 * PRICE_SCALE, BASE_MS - MS_PER_MINUTE);
    services.stocks.tickMarket(BASE_MS);

    expect(domainEvents.some((e) => e.type === 'MarketTick' && e.guildId === GUILD)).toBe(true);
    expect(
      domainEvents.some(
        (e) =>
          e.type === 'MarketMove' &&
          e.guildId === GUILD &&
          e.ticker === 'cs' &&
          e.direction === 'spike',
      ),
    ).toBe(true);
  });

  it('emits LoanDue reminder once within 24h of maturity', () => {
    const { services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 50_000);
    seedBalance(GUILD, U2, 10_000);

    const offer = services.loans.offerLoan({
      guildId: GUILD,
      lenderId: U1,
      borrowerId: U2,
      principal: 5_000,
      rateBps: 100,
      termDays: 3,
      nowMs: BASE_MS,
    });
    expect(offer.ok).toBe(true);
    const id = offer.ok ? offer.data : 0;
    services.loans.acceptOffer(GUILD, id, U2, BASE_MS);

    // 12 hours before due (within 24h window)
    const dueSoon = BASE_MS + 3 * MS_PER_DAY - 12 * MS_PER_HOUR;
    const reminded1 = services.loans.emitDueReminders(GUILD, dueSoon);
    const reminded2 = services.loans.emitDueReminders(GUILD, dueSoon + MS_PER_MINUTE);
    expect(reminded1).toHaveLength(1);
    expect(reminded2).toHaveLength(0);
    expect(
      domainEvents.filter((e) => e.type === 'LoanDue' && e.userId === U2 && e.loanId === id),
    ).toHaveLength(1);
  });

  it('emits CompanyBankrupt after 3 consecutive unpaid upkeep days', () => {
    const { services, domainEvents, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 250_000);

    const found = services.companies.foundCompany(GUILD, U1, '黒服農園', 'farm', BASE_MS);
    expect(found.ok).toBe(true);

    // Zero funds and 3+ JST days elapsed -> 3 unpaid days -> CompanyBankrupt
    const notices = services.companies.settleAll(GUILD, BASE_MS + 4 * MS_PER_DAY);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.ownerId).toBe(U1);
    expect(
      domainEvents.some(
        (e) =>
          e.type === 'CompanyBankrupt' &&
          e.guildId === GUILD &&
          e.ownerId === U1 &&
          e.companyName === '黒服農園',
      ),
    ).toBe(true);
    expect(services.companies.getCompanyState(GUILD, U1, BASE_MS + 4 * MS_PER_DAY)).toBeNull();
  });

  it('CODE behaviour: cross-margin interest IS actively charged on open positions', () => {
    const { services, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 100_000);
    services.stocks.setPrice('cs', 1_000 * PRICE_SCALE, BASE_MS);

    const opened = services.stocks.openMargin(GUILD, U1, 'long', 'cs', 20_000, 3, BASE_MS);
    expect(opened.ok).toBe(true);

    // 2 days elapsed -> 0.10%/day on 40,000 borrowed (notional 60,000 - margin 20,000) = 80 Pelica charged
    const charged = services.stocks.accrueAllMarginInterest(GUILD, BASE_MS + 2 * MS_PER_DAY);
    expect(charged).toBeGreaterThanOrEqual(80);
  });

  it('CODE behaviour: escaping overseas while already in grace DOES settle third-party CDS', () => {
    const { economy, services, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 100_000);
    seedBalance(GUILD, U2, 0);
    seedBalance(GUILD, U3, 50_000);

    services.teiai.bankDeposit(GUILD, U1, 40_000, BASE_MS);
    services.teiai.borrowSeed(GUILD, U2, BASE_MS);
    services.teiai.owe(GUILD, U2, 7_000, { refType: 'deficit_1', nowMs: BASE_MS });
    const cds = services.teiai.buyCds(GUILD, U3, U2, 4_000, BASE_MS);
    expect(cds.ok).toBe(true);
    const balAfterBuy = economy.getBalance(GUILD, U3);

    // Push into 24h grace (debt >= 15,000)
    services.teiai.owe(GUILD, U2, 9_000, { refType: 'deficit_2', nowMs: BASE_MS });
    expect(services.teiai.isInGrace(GUILD, U2)).toBe(true);

    // Succeed escape roll (0.0 < 0.05) -> CDS MUST settle in favour of U3 per CODE behaviour
    const esc = services.teiai.escapeAttempt(GUILD, U2, BASE_MS + MS_PER_HOUR, fixedRng(0.0));
    expect(esc.ok).toBe(true);
    if (esc.ok) {
      expect(esc.data.escaped).toBe(true);
      expect(esc.data.bankrupt).not.toBeNull();
      expect(esc.data.bankrupt!.cdsPaid).toBe(6_000); // 4,000 * 1.5
    }
    expect(economy.getBalance(GUILD, U3)).toBe(balAfterBuy + 6_000);
  });
});

// ============================================================================
// 3. Cross-System Services, Jobs & Guild Isolation
// ============================================================================

describe('cross-system services, scheduled jobs, and guild isolation', () => {
  it('supports options lifecycle, bonds DCF sale & maturity, and Kyosai governance motions', () => {
    const { economy, services, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 200_000);
    seedBalance(GUILD, U2, 200_000);
    services.teiai.bankDeposit(GUILD, U1, 50_000, BASE_MS);
    services.stocks.setPrice('cs', 1_000 * PRICE_SCALE, BASE_MS);
    services.stocks.setPrice('teio', 500 * PRICE_SCALE, BASE_MS);

    // Buy a call option and settle in-the-money at expiry
    const opt = services.stocks.buyOption({
      guildId: GUILD,
      userId: U2,
      kind: 'call',
      symbol: 'cs',
      premium: 1_000,
      hours: 6,
      nowMs: BASE_MS,
    });
    expect(opt.ok).toBe(true);
    services.stocks.setPrice('cs', 1_250 * PRICE_SCALE, BASE_MS + 6 * MS_PER_HOUR);
    const settledOpts = services.stocks.settleExpiredOptions(GUILD, BASE_MS + 6 * MS_PER_HOUR);
    expect(settledOpts).toHaveLength(1);
    expect(settledOpts[0]!.payout).toBeGreaterThan(0);

    // Buy normal bond, sell another early via DCF, let first mature
    const b1 = services.stocks.buyBond(GUILD, U2, 'normal', 5_000, BASE_MS);
    const b2 = services.stocks.buyBond(GUILD, U2, 'normal', 5_000, BASE_MS);
    expect(b1.ok && b2.ok).toBe(true);
    const earlySale = services.stocks.sellBondEarly(
      GUILD,
      U2,
      b2.ok ? b2.data.id : 0,
      BASE_MS + 24 * MS_PER_HOUR,
    );
    expect(earlySale.ok).toBe(true);
    if (earlySale.ok) expect(earlySale.data).toBeGreaterThan(0);

    const settledBonds = services.stocks.settleBonds(GUILD, BASE_MS + 73 * MS_PER_HOUR);
    expect(settledBonds.matured).toHaveLength(1);
    expect(settledBonds.matured[0]!.payout).toBeGreaterThan(5_000);

    // Kyosai: U1 wins 100u auction, proposes a trust-premium governance motion, votes yes, closes -> enacted
    services.kyosai.tickAuctions(GUILD, BASE_MS);
    services.kyosai.bidAuction(GUILD, U1, 10_000, BASE_MS + MS_PER_MINUTE);
    services.kyosai.tickAuctions(GUILD, BASE_MS + 25 * MS_PER_HOUR);
    expect(services.kyosai.getUserUnits(GUILD, U1)).toBe(100);

    const motion = services.kyosai.proposeMotion(
      GUILD,
      U1,
      2_000_000, // 0.2%/day in nano-units
      BASE_MS + 26 * MS_PER_HOUR,
    );
    expect(motion.ok).toBe(true);
    const motionId = motion.ok ? motion.data.id : 0;
    const vote = services.kyosai.voteMotion(GUILD, U1, motionId, true, BASE_MS + 27 * MS_PER_HOUR);
    expect(vote.ok).toBe(true);

    const closed = services.kyosai.closeExpiredMotions(GUILD, BASE_MS + 51 * MS_PER_HOUR);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.status).toBe('passed');
    expect(economy.getBalance(GUILD, U1)).toBeGreaterThan(0);
  });

  it('runs all scheduled job functions cleanly and enforces JST cron manifest + guild isolation', () => {
    const { services, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 50_000);
    seedBalance(OTHER_GUILD, U1, 50_000);

    services.teiai.bankDeposit(GUILD, U1, 20_000, BASE_MS);
    expect(services.teiai.getDeposit(GUILD, U1)).toBe(20_000);
    expect(services.teiai.getDeposit(OTHER_GUILD, U1)).toBe(0);

    expect(FINANCE_JOBS.length).toBeGreaterThanOrEqual(6);
    for (const job of FINANCE_JOBS) {
      expect(job.timezone).toBe('Asia/Tokyo');
      expect(job.utcOffsetHours).toBe(9);
      expect(job.cron.split(' ')).toHaveLength(5);
    }

    const t = BASE_MS + MS_PER_MINUTE;
    expect(runMarketMinuteTick(services, t).marketTick.pricesMicros.cs).toBeGreaterThan(0);
    expect(runTeiaiMinuteTick(services, t).riskFreeRates[GUILD]).toBeGreaterThan(0);
    expect(runLoanMinuteTick(services, t).collected[GUILD]).toEqual([]);
    expect(runKyosaiMinuteTick(services, t).auctionEvents[GUILD]).toHaveLength(1);
    expect(runCompanyMaintenanceTick(services, t).bankruptcies[GUILD]).toEqual([]);
    expect(runPlayerMarketSettleTick(services, t).settled[GUILD]).toEqual([]);
  });

  it('enforces cross-margin loss-cut, short option write/buyback, and overdue P2P garnishment + junior bankruptcy waterfall', () => {
    const { economy, services, assets, seedBalance } = makeTestEnv(BASE_MS);
    seedBalance(GUILD, U1, 100_000);
    seedBalance(GUILD, U2, 50_000);
    seedBalance(GUILD, U3, 100_000);

    services.teiai.bankDeposit(GUILD, U1, 50_000, BASE_MS);
    services.stocks.setPrice('cs', 1_000 * PRICE_SCALE, BASE_MS);

    // 1. Short option write & early buyback
    const written = services.stocks.writeOption({
      guildId: GUILD,
      userId: U3,
      kind: 'call',
      symbol: 'cs',
      unitsMilli: 1_000,
      hours: 6,
      nowMs: BASE_MS,
    });
    expect(written.ok).toBe(true);
    const boughtBack = services.stocks.buybackOption(
      GUILD,
      U3,
      written.ok ? written.data.id : 0,
      BASE_MS + MS_PER_HOUR,
    );
    expect(boughtBack.ok).toBe(true);

    // 2. Cross-margin loss-cut on severe price crash
    const open = services.stocks.openMargin(GUILD, U2, 'long', 'cs', 5_000, 5, BASE_MS);
    expect(open.ok).toBe(true);
    services.stocks.setPrice('cs', 750 * PRICE_SCALE, BASE_MS + MS_PER_HOUR);
    const cut = services.stocks.enforceLossCuts(GUILD, BASE_MS + MS_PER_HOUR);
    expect(cut).toContain(U2);

    // 3. Overdue P2P loan garnishment (30% withholding) + grace pull-back of marketplace auction bid
    assets.grantItem(GUILD, U3, 'daily_double', 1);
    const lId = services.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: U3,
      kind: 'item',
      ref: 'daily_double',
      qty: 1,
      mode: 'auction',
      price: 3_000,
      hours: 6,
      nowMs: BASE_MS + MS_PER_HOUR,
    });
    expect(lId.ok).toBe(true);

    // Give U2 clean katagi state on OTHER_GUILD for clean P2P overdue + bankruptcy waterfall
    seedBalance(OTHER_GUILD, U1, 50_000);
    seedBalance(OTHER_GUILD, U2, 0);
    seedBalance(OTHER_GUILD, U3, 50_000);
    assets.grantItem(OTHER_GUILD, U3, 'daily_double', 1);

    const loanOffer = services.loans.offerLoan({
      guildId: OTHER_GUILD,
      lenderId: U1,
      borrowerId: U2,
      principal: 5_000,
      rateBps: 100,
      termDays: 1,
      nowMs: BASE_MS,
    });
    expect(loanOffer.ok).toBe(true);
    const loanId = loanOffer.ok ? loanOffer.data : 0;
    services.loans.acceptOffer(OTHER_GUILD, loanId, U2, BASE_MS);
    // U2 spends the 5,000 so maturity leaves loan overdue
    economy.debit({ guildId: OTHER_GUILD, userId: U2, amount: 5_000, reason: 'shop_buy' });
    const due = services.loans.collectDue(OTHER_GUILD, BASE_MS + 2 * MS_PER_DAY);
    expect(due[0]!.loan.status).toBe('overdue');

    // Credit 1,000 to U2 via Teiai withholding -> 30% (300) garnishes overdue P2P loan to U1
    const u1Before = economy.getBalance(OTHER_GUILD, U1);
    services.teiai.creditWithWithholding(OTHER_GUILD, U2, 1_000, 'work_earnings', {
      nowMs: BASE_MS + 2 * MS_PER_DAY + MS_PER_MINUTE,
    });
    expect(economy.getBalance(OTHER_GUILD, U1)).toBe(u1Before + 300);

    // Declare voluntary bankruptcy with remaining cash -> junior P2P lender receives waterfall payout
    const br = services.teiai.declareBankruptcy(OTHER_GUILD, U2, {
      forced: false,
      nowMs: BASE_MS + 2 * MS_PER_DAY + 2 * MS_PER_MINUTE,
    });
    expect(br.ok).toBe(true);
    if (br.ok) {
      expect(br.data.juniorPaid).toBe(700);
    }
    expect(economy.getBalance(OTHER_GUILD, U1)).toBe(u1Before + 1_000);
    expect(services.loans.getLoan(loanId)!.status).toBe('discharged');
  });
});

