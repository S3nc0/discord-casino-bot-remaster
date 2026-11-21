import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededRng, PRICE_SCALE } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { microsToPrice, priceToMicros } from '../math.ts';
import {
  accrueMarginInterest,
  avgPriceMicros,
  BOND_CONSTANTS,
  bondDefaultProbability,
  bondInterest,
  bondMaturityPayout,
  bondRateBps,
  bondRatePct,
  bondSaleDiscountPerHour,
  bondSaleValue,
  buildEarningsMemo,
  capitalGainsTax,
  CHOLESKY_L,
  COVARIANCE_MATRIX,
  earningsFactor,
  earningsJumpVariance,
  limitToDay,
  marginInterestBaseMicros,
  marginPnl,
  MARKET_SYMBOLS,
  nextMarketPrices,
  optionAskPerUnit,
  optionBidPerUnit,
  optionIntrinsic,
  optionStrikeMicros,
  pairAskRate,
  pairBidRate,
  pairIntrinsic,
  pinStates,
  planVolatilityEvent,
  planWeeklyEarnings,
  removedCostBasis,
  requiredMargin,
  rfStep,
  rfTarget,
  shortOptionMarginRequired,
  spotBuyQuote,
  spotPnlPercent,
  spotSellQuote,
  volatilityMultiplier,
  type SymbolKey,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const BASE_MS = 1_736_121_600_000;

interface StocksFixture {
  readonly symbols: readonly {
    readonly key: SymbolKey;
    readonly name: string;
    readonly emoji: string;
    readonly start: number;
    readonly sigma: number;
    readonly drift: number;
  }[];
  readonly covariance_matrix: readonly (readonly number[])[];
  readonly cholesky: readonly (readonly number[])[];
  readonly daily_limits: {
    readonly extreme_limited: Record<SymbolKey, number>;
    readonly pins: Record<SymbolKey, -1 | 0 | 1>;
  };
  readonly capital_gains_tax: Record<string, number>;
  readonly margin: {
    readonly required_margin_cs_100k: number;
    readonly required_margin_multi: number;
    readonly long_pnl_gain: number;
    readonly short_pnl_gain: number;
    readonly interest_base_long: number;
    readonly interest_base_short: number;
  };
  readonly options: {
    readonly call_strike: number;
    readonly put_strike: number;
    readonly call_ask_24h: number;
    readonly call_bid_24h: number;
    readonly put_ask_24h: number;
    readonly intrinsic_call_itm: number;
    readonly pair_ask_rate_24h: number;
    readonly pair_bid_rate_24h: number;
    readonly pair_intrinsic: number;
  };
  readonly earnings: {
    readonly factor_pos: number;
    readonly factor_neg: number;
    readonly jump_variance: number;
    readonly memo: {
      readonly symbol_name: string;
      readonly hint: -1 | 1;
      readonly release_at: number;
      readonly truth: number;
    };
  };
  readonly market_events: {
    readonly multiplier_during: number;
  };
  readonly rates_and_bonds: {
    readonly rf_target_theta_0_15: number;
    readonly rf_step_1d_z_0_5: number;
    readonly bonds: Record<
      'normal' | 'junk',
      {
        readonly rate_pct: number;
        readonly interest_10000: number;
        readonly maturity_payout_10000: number;
        readonly default_prob_24h: number;
        readonly sale_value_halfway: number;
      }
    >;
  };
}

interface CryptoFixture {
  readonly quotes: {
    readonly buy_10000_at_100: readonly [number, number, number];
    readonly buy_10000_at_33_3: readonly [number, number, number];
    readonly sell_50000_at_120: readonly [number, number];
    readonly avg_price_50000_cost_4000: number;
    readonly pnl_percent: number;
  };
}

const stocksFixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/stocks/market.json'), 'utf8'),
) as StocksFixture;

const cryptoFixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/crypto/spot.json'), 'utf8'),
) as CryptoFixture;

describe('stocks & crypto domain parity', () => {
  it('matches symbols, covariance matrix, and Cholesky factor to 1e-10', () => {
    expect(MARKET_SYMBOLS.map((s) => s.key)).toEqual(stocksFixture.symbols.map((s) => s.key));
    for (let i = 0; i < MARKET_SYMBOLS.length; i++) {
      const s = MARKET_SYMBOLS[i]!;
      const f = stocksFixture.symbols[i]!;
      expect(s.name).toBe(f.name);
      expect(s.emoji).toBe(f.emoji);
      expect(microsToPrice(s.startMicros)).toBe(f.start);
      expect(s.sigma).toBe(f.sigma);
      expect(s.drift).toBe(f.drift);
      for (let j = 0; j < MARKET_SYMBOLS.length; j++) {
        expect(COVARIANCE_MATRIX[i]![j]).toBeCloseTo(stocksFixture.covariance_matrix[i]![j]!, 10);
        expect(CHOLESKY_L[i]![j]).toBeCloseTo(stocksFixture.cholesky[i]![j]!, 9);
      }
    }
  });

  it('matches ±30% daily limits, pin states, and capital gains tax 100%', () => {
    const ref: Record<SymbolKey, number> = {
      cs: priceToMicros(1_000),
      teio: priceToMicros(1_200),
      numa: priceToMicros(400),
      gold: priceToMicros(3_000),
    };
    const extreme: Record<SymbolKey, number> = {
      cs: priceToMicros(1_000 * 1.45),
      teio: priceToMicros(1_200 * 0.55),
      numa: priceToMicros(400 * 1.45),
      gold: priceToMicros(3_000 * 0.55),
    };
    const limited = limitToDay(extreme, ref);
    for (const key of ['cs', 'teio', 'numa', 'gold'] as const) {
      expect(microsToPrice(limited[key])).toBe(stocksFixture.daily_limits.extreme_limited[key]);
    }
    expect(pinStates(extreme, ref)).toEqual(stocksFixture.daily_limits.pins);

    for (const [profitStr, expectedTax] of Object.entries(stocksFixture.capital_gains_tax)) {
      expect(capitalGainsTax(Number(profitStr))).toBe(expectedTax);
    }
  });

  it('matches cross-margin required margin, PnL, and interest base 100% (CODE behaviour)', () => {
    expect(requiredMargin({ cs: 100_000 })).toBeCloseTo(
      stocksFixture.margin.required_margin_cs_100k,
      8,
    );
    expect(requiredMargin({ cs: 50_000, tb: 80_000 })).toBeCloseTo(
      stocksFixture.margin.required_margin_multi,
      8,
    );
    expect(marginPnl('long', 10_000, 10_000 * PRICE_SCALE, priceToMicros(1.25))).toBe(
      stocksFixture.margin.long_pnl_gain,
    );
    expect(marginPnl('short', 10_000, 10_000 * PRICE_SCALE, priceToMicros(0.8))).toBe(
      stocksFixture.margin.short_pnl_gain,
    );
    expect(marginInterestBaseMicros('long', 50_000 * PRICE_SCALE, 20_000) / PRICE_SCALE).toBe(
      stocksFixture.margin.interest_base_long,
    );
    expect(marginInterestBaseMicros('short', 50_000 * PRICE_SCALE, 20_000) / PRICE_SCALE).toBe(
      stocksFixture.margin.interest_base_short,
    );

    // Verify CODE behaviour: margin interest IS charged (0.1%/day long on borrowed 30k = 30/day)
    const intRes = accrueMarginInterest({
      side: 'long',
      entryValueMicros: 50_000 * PRICE_SCALE,
      marginPelica: 20_000,
      accruedMicros: 0,
      elapsedSeconds: 86_400,
    });
    expect(intRes.chargePelica).toBe(30);
    expect(intRes.marginDeducted).toBe(30);
    expect(intRes.debtOverflow).toBe(0);
  });

  it('matches Black-Scholes single options and Margrabe pair options 100%', () => {
    const spotMicros = priceToMicros(1_000);
    const callStrike = optionStrikeMicros('call', spotMicros);
    const putStrike = optionStrikeMicros('put', spotMicros);

    expect(microsToPrice(callStrike)).toBe(stocksFixture.options.call_strike);
    expect(microsToPrice(putStrike)).toBe(stocksFixture.options.put_strike);

    expect(optionAskPerUnit('call', 'cs', spotMicros, callStrike, 86_400, BASE_MS)).toBeCloseTo(
      stocksFixture.options.call_ask_24h,
      9,
    );
    expect(optionBidPerUnit('call', 'cs', spotMicros, callStrike, 86_400, BASE_MS)).toBeCloseTo(
      stocksFixture.options.call_bid_24h,
      9,
    );
    expect(optionAskPerUnit('put', 'cs', spotMicros, putStrike, 86_400, BASE_MS)).toBeCloseTo(
      stocksFixture.options.put_ask_24h,
      9,
    );
    expect(optionIntrinsic('call', 10_000, priceToMicros(1_200), callStrike)).toBe(
      stocksFixture.options.intrinsic_call_itm,
    );

    expect(pairAskRate('cs', 'teio', 86_400, BASE_MS)).toBeCloseTo(
      stocksFixture.options.pair_ask_rate_24h,
      9,
    );
    expect(pairBidRate('cs', 'teio', 1.1, 1.0, 86_400, BASE_MS)).toBeCloseTo(
      stocksFixture.options.pair_bid_rate_24h,
      9,
    );
    expect(
      pairIntrinsic(
        10_000,
        priceToMicros(100),
        priceToMicros(100),
        priceToMicros(120),
        priceToMicros(100),
      ),
    ).toBe(stocksFixture.options.pair_intrinsic);

    // Naked short option margin (20% of strike * units / 1000, ceil)
    expect(shortOptionMarginRequired(callStrike, 10_000)).toBe(2_040);
  });

  it('matches earnings, volatility events, CIR risk-free rate, and bonds 100%', () => {
    expect(earningsFactor(1, 0.12)).toBeCloseTo(stocksFixture.earnings.factor_pos, 10);
    expect(earningsFactor(-1, 0.12)).toBeCloseTo(stocksFixture.earnings.factor_neg, 10);
    expect(earningsJumpVariance()).toBeCloseTo(stocksFixture.earnings.jump_variance, 9);

    const rng = createSeededRng(3002);
    const plan = planWeeklyEarnings(BASE_MS, 9, rng);
    expect(plan.announceAtMs).toBe(BASE_MS);
    expect(plan.releaseAtMs).toBe(stocksFixture.earnings.memo.release_at * 1_000);

    const memo = buildEarningsMemo('CSトークン', 1, plan.releaseAtMs);
    expect(memo.symbolName).toBe(stocksFixture.earnings.memo.symbol_name);
    expect(memo.hint).toBe(stocksFixture.earnings.memo.hint);
    expect(memo.releaseAtMs / 1_000).toBe(stocksFixture.earnings.memo.release_at);
    expect(memo.truthBps / 10_000).toBe(stocksFixture.earnings.memo.truth);

    const ev = planVolatilityEvent(BASE_MS, createSeededRng(3003));
    expect(volatilityMultiplier([ev], ev.symbol, ev.startAtMs + 60_000)).toBe(
      stocksFixture.market_events.multiplier_during,
    );

    const rf0 = rfTarget(0.15);
    const rf1 = rfStep(rf0, 0.15, 1.0, 0.5);
    expect(rf0).toBeCloseTo(stocksFixture.rates_and_bonds.rf_target_theta_0_15, 9);
    expect(rf1).toBeCloseTo(stocksFixture.rates_and_bonds.rf_step_1d_z_0_5, 9);

    for (const kind of ['normal', 'junk'] as const) {
      const expected = stocksFixture.rates_and_bonds.bonds[kind];
      const def = BOND_CONSTANTS.kinds[kind];
      const ratePct = bondRatePct(kind, rf0);
      const rateBps = bondRateBps(kind, rf0);
      expect(ratePct).toBe(expected.rate_pct);
      expect(bondInterest(10_000, rateBps)).toBe(expected.interest_10000);
      expect(bondMaturityPayout(10_000, rateBps)).toBe(expected.maturity_payout_10000);
      expect(bondDefaultProbability(kind, 24)).toBeCloseTo(expected.default_prob_24h, 10);
      const halfMs = BASE_MS + (def.hours * 3_600_000) / 2;
      const dueMs = BASE_MS + def.hours * 3_600_000;
      expect(bondSaleValue(10_000, rateBps, halfMs, dueMs, bondSaleDiscountPerHour(rf0))).toBe(
        expected.sale_value_halfway,
      );
    }
  });

  it('matches crypto spot quotes 100%', () => {
    const q1 = spotBuyQuote(10_000, priceToMicros(100));
    expect([q1.unitsMilli, q1.total, q1.fee]).toEqual(cryptoFixture.quotes.buy_10000_at_100);

    const q2 = spotBuyQuote(10_000, priceToMicros(33.3));
    expect([q2.unitsMilli, q2.total, q2.fee]).toEqual(cryptoFixture.quotes.buy_10000_at_33_3);

    const s1 = spotSellQuote(50_000, priceToMicros(120));
    expect([s1.proceeds, s1.fee]).toEqual(cryptoFixture.quotes.sell_50000_at_120);

    expect(microsToPrice(avgPriceMicros(50_000, 4_000))).toBe(
      cryptoFixture.quotes.avg_price_50000_cost_4000,
    );
    expect(spotPnlPercent(priceToMicros(120), 50_000, 4_000)).toBeCloseTo(
      cryptoFixture.quotes.pnl_percent,
      10,
    );

    // Partial sell cost basis removal (matches crypto/spot.json db_flow: 50000 * 200000 / 460000 = 21739)
    expect(removedCostBasis(50_000, 200_000, 460_000)).toBe(21_739);
  });

  it('produces deterministic correlated ticks with injected Rng and bounds prices to [20, 50_000]', () => {
    const base: Record<SymbolKey, number> = {
      cs: priceToMicros(1_000),
      teio: priceToMicros(1_200),
      numa: priceToMicros(400),
      gold: priceToMicros(3_000),
    };
    const r1 = nextMarketPrices(base, createSeededRng(3001));
    const r2 = nextMarketPrices(base, createSeededRng(3001));
    expect(r1).toEqual(r2);
    for (const key of ['cs', 'teio', 'numa', 'gold'] as const) {
      const p = microsToPrice(r1.fairMicros[key]);
      expect(p).toBeGreaterThanOrEqual(20);
      expect(p).toBeLessThanOrEqual(50_000);
    }
  });
});
