import { PRICE_SCALE, QUANTITY_SCALE, type Rng } from '@casino/shared';
import {
  accrueMarginInterest,
  BOND_CONSTANTS,
  bondDefaultProbability,
  bondInterest,
  bondRateBps,
  bondSaleDiscountPerHour,
  bondSaleValue,
  buildEarningsMemo,
  capitalGainsTax,
  computePortfolioMarginStatus,
  detectMarketMove,
  EARNINGS_CONSTANTS,
  earningsFactor,
  earningsJumpVariance,
  isActionPinned,
  limitToDay,
  marginPnl,
  MARKET_CONSTANTS,
  MARKET_SYMBOLS,
  maybeRollVolatilityEvent,
  microsToPrice,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  nextMarketPrices,
  OPTION_CONSTANTS,
  optionAskPerUnit,
  optionBidPerUnit,
  optionBuyerPayout,
  optionIntrinsic,
  optionStrikeMicros,
  pairAskRate,
  pairBidRate,
  pairIntrinsic,
  pinStates,
  planWeeklyEarnings,
  priceToMicros,
  removedCostBasis,
  roundTo,
  shortOptionMarginRequired,
  spotBuyQuote,
  spotSellQuote,
  SYMBOL_BY_KEY,
  TEIAI_CONSTANTS,
  truncInt,
  type BondKindKey,
  type MarginPositionSnapshot,
  type MarginSide,
  type MarketPricingEvent,
  type OptionKind,
  type OptionSide,
  type PinState,
  type PortfolioMarginStatus,
  type SymbolKey,
  type VolatilityEvent,
} from '@casino/domain/finance';
import type { ServiceResult, TeiaiService } from './teiai-service.ts';
import { listKnownGuildIds, type FinanceDeps } from './types.ts';

export interface SpotHoldingRow {
  guild_id: string;
  user_id: string;
  symbol: SymbolKey;
  units_milli: number;
  cost: number;
}

export interface MarginPositionRow {
  guild_id: string;
  user_id: string;
  symbol: SymbolKey;
  units_milli: number;
  entry_value_micros: number;
  margin: number;
  opened_at: number;
  interest_at: number;
  interest_accrued_micros: number;
}

export interface OptionRow {
  id: number;
  guild_id: string;
  user_id: string;
  side: OptionSide;
  kind: OptionKind;
  symbol: SymbolKey;
  symbol_b: SymbolKey | null;
  strike_micros: number;
  units_milli: number;
  notional: number;
  entry_a_micros: number;
  entry_b_micros: number;
  premium: number;
  margin: number;
  payout: number;
  status: 'open' | 'settled' | 'sold' | 'bought_back';
  created_at: number;
  expires_at: number;
  settled_at: number | null;
}

export interface BondRow {
  id: number;
  guild_id: string;
  user_id: string;
  kind: BondKindKey;
  principal: number;
  rate_bps: number;
  status: 'active' | 'matured' | 'defaulted' | 'sold';
  payout: number;
  created_at: number;
  due_at: number;
  checked_at: number;
  settled_at: number | null;
}

export interface SpotTradeResult {
  readonly unitsMilli: number;
  readonly money: number;
  readonly fee: number;
  readonly tax: number;
  readonly profit: number;
  readonly balance: number;
}

export interface MarketTickSummary {
  readonly pricesMicros: Record<SymbolKey, number>;
  readonly fairMicros: Record<SymbolKey, number>;
  readonly shockDirection: -1 | 0 | 1;
  readonly pins: Record<SymbolKey, PinState>;
  readonly earningsReleased: SymbolKey | null;
  readonly volatilityEventAnnounced: VolatilityEvent | null;
}

export class StocksService {
  private readonly deps: FinanceDeps;
  private readonly teiai: TeiaiService;

  constructor(deps: FinanceDeps, teiai: TeiaiService) {
    this.deps = deps;
    this.teiai = teiai;
  }

  private utcOffsetHours(): number {
    return this.deps.utcOffsetHours ?? 9;
  }

  private marginTable(side: MarginSide): 'positions_long' | 'positions_short' {
    return side === 'long' ? 'positions_long' : 'positions_short';
  }

  // -------------------------------------------------------------------------
  // Global Market Prices, Fair Values, Events & Earnings
  // -------------------------------------------------------------------------

  ensureMarketInitialized(nowMs = this.deps.clock.now()): void {
    this.deps.store.transaction(() => {
      for (const sym of MARKET_SYMBOLS) {
        const fairRow = this.deps.store
          .stmt('SELECT fair_micros FROM market_fair WHERE symbol = ?')
          .get(sym.key) as { fair_micros: number } | undefined;
        if (!fairRow) {
          this.deps.store
            .stmt('INSERT INTO market_fair (symbol, fair_micros, updated_at) VALUES (?, ?, ?)')
            .run(sym.key, sym.startMicros, nowMs);
        }
        const priceRow = this.deps.store
          .stmt(
            'SELECT price_micros FROM market_prices WHERE symbol = ? ORDER BY recorded_at DESC, id DESC LIMIT 1',
          )
          .get(sym.key) as { price_micros: number } | undefined;
        if (!priceRow) {
          this.deps.store
            .stmt(
              'INSERT INTO market_prices (symbol, price_micros, shock, recorded_at) VALUES (?, ?, 0, ?)',
            )
            .run(sym.key, sym.startMicros, nowMs);
        }
      }
    });
  }

  /** Explicitly set a ticker's price & fair price (useful for admin/testing/seeding). */
  setPrice(
    symbol: SymbolKey,
    priceMicros: number,
    nowMs = this.deps.clock.now(),
    shock: -1 | 0 | 1 = 0,
  ): void {
    this.deps.store.transaction(() => {
      this.deps.store
        .stmt(
          `INSERT INTO market_fair (symbol, fair_micros, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT (symbol) DO UPDATE SET fair_micros = excluded.fair_micros, updated_at = excluded.updated_at`,
        )
        .run(symbol, priceMicros, nowMs);
      this.deps.store
        .stmt(
          'INSERT INTO market_prices (symbol, price_micros, shock, recorded_at) VALUES (?, ?, ?, ?)',
        )
        .run(symbol, priceMicros, shock, nowMs);
    });
  }

  getPricesMicros(nowMs = this.deps.clock.now()): Record<SymbolKey, number> {
    this.ensureMarketInitialized(nowMs);
    const out: Record<SymbolKey, number> = {
      cs: SYMBOL_BY_KEY.cs.startMicros,
      teio: SYMBOL_BY_KEY.teio.startMicros,
      numa: SYMBOL_BY_KEY.numa.startMicros,
      gold: SYMBOL_BY_KEY.gold.startMicros,
    };
    for (const sym of MARKET_SYMBOLS) {
      const row = this.deps.store
        .stmt(
          'SELECT price_micros FROM market_prices WHERE symbol = ? ORDER BY recorded_at DESC, id DESC LIMIT 1',
        )
        .get(sym.key) as { price_micros: number } | undefined;
      if (row) out[sym.key] = row.price_micros;
    }
    return out;
  }

  getFairPricesMicros(nowMs = this.deps.clock.now()): Record<SymbolKey, number> {
    this.ensureMarketInitialized(nowMs);
    const out: Record<SymbolKey, number> = {
      cs: SYMBOL_BY_KEY.cs.startMicros,
      teio: SYMBOL_BY_KEY.teio.startMicros,
      numa: SYMBOL_BY_KEY.numa.startMicros,
      gold: SYMBOL_BY_KEY.gold.startMicros,
    };
    for (const sym of MARKET_SYMBOLS) {
      const row = this.deps.store
        .stmt('SELECT fair_micros FROM market_fair WHERE symbol = ?')
        .get(sym.key) as { fair_micros: number } | undefined;
      if (row) out[sym.key] = row.fair_micros;
    }
    return out;
  }

  getReferencePrices24h(nowMs = this.deps.clock.now()): Partial<Record<SymbolKey, number>> {
    const cutoff = nowMs - MS_PER_DAY;
    const out: Partial<Record<SymbolKey, number>> = {};
    for (const sym of MARKET_SYMBOLS) {
      const row = this.deps.store
        .stmt(
          `SELECT price_micros FROM market_prices
           WHERE symbol = ? AND recorded_at <= ?
           ORDER BY recorded_at DESC, id DESC LIMIT 1`,
        )
        .get(sym.key, cutoff) as { price_micros: number } | undefined;
      if (row) out[sym.key] = row.price_micros;
    }
    return out;
  }

  getPinStates(nowMs = this.deps.clock.now()): Record<SymbolKey, PinState> {
    return pinStates(this.getFairPricesMicros(nowMs), this.getReferencePrices24h(nowMs));
  }

  private getPricingEvents(nowMs: number): MarketPricingEvent[] {
    const volRows = this.deps.store
      .stmt(
        'SELECT symbol, factor_bps, announce_at, start_at, end_at FROM market_events WHERE end_at > ?',
      )
      .all(nowMs) as {
      symbol: SymbolKey;
      factor_bps: number;
      announce_at: number;
      start_at: number;
      end_at: number;
    }[];

    const events: MarketPricingEvent[] = volRows.map((r) => ({
      symbol: r.symbol,
      factorBps: r.factor_bps,
      announceAtMs: r.announce_at,
      startAtMs: r.start_at,
      endAtMs: r.end_at,
    }));

    const earnRows = this.deps.store
      .stmt("SELECT symbol, release_at FROM earnings WHERE status = 'announced' AND release_at > ?")
      .all(nowMs) as { symbol: SymbolKey; release_at: number }[];
    for (const e of earnRows) {
      events.push({
        symbol: e.symbol,
        jumpAtMs: e.release_at,
        jumpVar: earningsJumpVariance(),
      });
    }
    return events;
  }

  /**
   * Global 1-minute market tick:
   * 1. Ensures weekly earnings plan exists, transitions planned -> announced -> released.
   * 2. Rolls random volatility event (`market_events`).
   * 3. Advances correlated Cholesky prices, applies ±30% daily limits, records `market_prices`.
   * 4. Emits `MarketTick` per guild and `MarketMove` on ±5% 15m swings.
   */
  tickMarket(nowMs = this.deps.clock.now(), rng: Rng = this.deps.rng): MarketTickSummary {
    return this.deps.store.transaction(() => {
      this.ensureMarketInitialized(nowMs);
      const fair = this.getFairPricesMicros(nowMs);

      // 1. Weekly earnings lifecycle
      let upcoming = this.deps.store
        .stmt(
          "SELECT * FROM earnings WHERE status IN ('planned', 'announced') ORDER BY release_at ASC LIMIT 1",
        )
        .get() as
        | {
            id: number;
            symbol: SymbolKey;
            direction: -1 | 1;
            size_bps: number;
            announce_at: number;
            release_at: number;
            status: 'planned' | 'announced';
          }
        | undefined;

      if (!upcoming) {
        const plan = planWeeklyEarnings(nowMs, this.utcOffsetHours(), rng);
        const res = this.deps.store
          .stmt(
            `INSERT INTO earnings (symbol, direction, size_bps, announce_at, release_at, status)
             VALUES (?, ?, ?, ?, ?, 'planned')`,
          )
          .run(plan.symbol, plan.direction, plan.sizeBps, plan.announceAtMs, plan.releaseAtMs);
        upcoming = {
          id: Number(res.lastInsertRowid),
          symbol: plan.symbol,
          direction: plan.direction,
          size_bps: plan.sizeBps,
          announce_at: plan.announceAtMs,
          release_at: plan.releaseAtMs,
          status: 'planned',
        };
      }

      if (
        upcoming.status === 'planned' &&
        nowMs >= upcoming.announce_at &&
        nowMs < upcoming.release_at
      ) {
        this.deps.store
          .stmt("UPDATE earnings SET status = 'announced' WHERE id = ?")
          .run(upcoming.id);
        upcoming = { ...upcoming, status: 'announced' };
      }

      let earningsReleased: SymbolKey | null = null;
      if (nowMs >= upcoming.release_at) {
        const factor = earningsFactor(upcoming.direction, upcoming.size_bps / 10_000);
        const curFair = microsToPrice(fair[upcoming.symbol]);
        const jumped = roundTo(
          Math.min(
            microsToPrice(MARKET_CONSTANTS.maxPriceMicros),
            Math.max(microsToPrice(MARKET_CONSTANTS.minPriceMicros), curFair * factor),
          ),
          2,
        );
        fair[upcoming.symbol] = priceToMicros(jumped);
        this.deps.store
          .stmt("UPDATE earnings SET status = 'released' WHERE id = ?")
          .run(upcoming.id);
        earningsReleased = upcoming.symbol;
      }

      // 2. Volatility events
      const activeVolRows = this.deps.store
        .stmt(
          'SELECT symbol, factor_bps, announce_at, start_at, end_at FROM market_events WHERE end_at > ?',
        )
        .all(nowMs) as {
        symbol: SymbolKey;
        factor_bps: number;
        announce_at: number;
        start_at: number;
        end_at: number;
      }[];
      const activeVols: VolatilityEvent[] = activeVolRows.map((r) => ({
        symbol: r.symbol,
        factorBps: r.factor_bps,
        announceAtMs: r.announce_at,
        startAtMs: r.start_at,
        endAtMs: r.end_at,
      }));
      const lastEndRow = this.deps.store
        .stmt('SELECT MAX(end_at) AS last_end FROM market_events')
        .get() as { last_end: number | null };
      const newEvent = maybeRollVolatilityEvent(
        nowMs,
        activeVols,
        lastEndRow?.last_end ?? null,
        rng,
      );
      if (newEvent) {
        this.deps.store
          .stmt(
            `INSERT INTO market_events (symbol, factor_bps, announce_at, start_at, end_at, announced)
             VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .run(
            newEvent.symbol,
            newEvent.factorBps,
            newEvent.announceAtMs,
            newEvent.startAtMs,
            newEvent.endAtMs,
          );
        activeVols.push(newEvent);
      }

      // 3. Correlated Cholesky tick + ±30% daily limits
      const tick = nextMarketPrices(fair, rng, { events: activeVols, nowMs });
      const ref24h = this.getReferencePrices24h(nowMs);
      const limited = limitToDay(tick.fairMicros, ref24h);
      const pins = pinStates(tick.fairMicros, ref24h);

      for (const sym of MARKET_SYMBOLS) {
        this.deps.store
          .stmt('UPDATE market_fair SET fair_micros = ?, updated_at = ? WHERE symbol = ?')
          .run(tick.fairMicros[sym.key], nowMs, sym.key);
        this.deps.store
          .stmt(
            'INSERT INTO market_prices (symbol, price_micros, shock, recorded_at) VALUES (?, ?, ?, ?)',
          )
          .run(sym.key, limited[sym.key], tick.shockDirection, nowMs);
      }

      // 4. Detect ±5% 15-minute moves and fan out domain events per guild
      const moveWindowCutoff = nowMs - 15 * MS_PER_MINUTE;
      const detectedMoves: {
        readonly ticker: SymbolKey;
        readonly direction: 'spike' | 'crash';
        readonly changeBps: number;
        readonly price: number;
      }[] = [];
      for (const sym of MARKET_SYMBOLS) {
        const prevRow = this.deps.store
          .stmt(
            `SELECT price_micros FROM market_prices
             WHERE symbol = ? AND recorded_at <= ?
             ORDER BY recorded_at DESC, id DESC LIMIT 1`,
          )
          .get(sym.key, moveWindowCutoff) as { price_micros: number } | undefined;
        if (prevRow) {
          const mv = detectMarketMove(prevRow.price_micros, limited[sym.key]);
          if (mv) {
            detectedMoves.push({
              ticker: sym.key,
              direction: mv.direction,
              changeBps: mv.changeBps,
              price: limited[sym.key],
            });
          }
        }
      }

      const bus = this.deps.bus;
      if (bus) {
        const guildIds = listKnownGuildIds(this.deps.store);
        const pricesSnapshot: Record<string, number> = { ...limited };
        this.deps.store.afterCommit(() => {
          for (const guildId of guildIds) {
            bus.publishDomain({
              type: 'MarketTick',
              guildId,
              at: nowMs,
              prices: pricesSnapshot,
            });
            for (const mv of detectedMoves) {
              bus.publishDomain({
                type: 'MarketMove',
                guildId,
                at: nowMs,
                ticker: mv.ticker,
                direction: mv.direction,
                changeBps: mv.changeBps,
                price: mv.price,
              });
            }
          }
        });
      }

      return {
        pricesMicros: limited,
        fairMicros: tick.fairMicros,
        shockDirection: tick.shockDirection,
        pins,
        earningsReleased,
        volatilityEventAnnounced: newEvent,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Spot & Crypto Trading
  // -------------------------------------------------------------------------

  getSpotHoldings(guildId: string, userId: string): SpotHoldingRow[] {
    return this.deps.store
      .stmt(
        'SELECT * FROM positions_spot WHERE guild_id = ? AND user_id = ? AND units_milli > 0 ORDER BY symbol ASC',
      )
      .all(guildId, userId) as SpotHoldingRow[];
  }

  buySpot(
    guildId: string,
    userId: string,
    symbol: SymbolKey,
    budgetPelica: number,
    nowMs = this.deps.clock.now(),
    options: { readonly priceMicrosOverride?: number; readonly idempotencyKey?: string } = {},
  ): ServiceResult<SpotTradeResult> {
    if (!Number.isInteger(budgetPelica) || budgetPelica <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }
    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'market_debtor_blocked' };
      }
      const pins = this.getPinStates(nowMs);
      if (isActionPinned(pins[symbol], 'buy_spot')) {
        return { ok: false, reason: 'market_limit_up_blocked' };
      }
      const priceMicros = options.priceMicrosOverride ?? this.getPricesMicros(nowMs)[symbol];
      const q = spotBuyQuote(budgetPelica, priceMicros);
      if (q.unitsMilli <= 0 || q.total <= 0) {
        return { ok: false, reason: 'market_order_too_small' };
      }
      if (this.deps.economy.getBalance(guildId, userId) < q.total) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const netPrincipal = q.total - q.fee;
      const buyRes = this.deps.economy.debit({
        guildId,
        userId,
        amount: netPrincipal,
        reason: 'stock_buy',
        refType: 'spot',
        refId: symbol,
        idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:buy` : undefined,
      });
      if (q.fee > 0) {
        this.deps.economy.debit({
          guildId,
          userId,
          amount: q.fee,
          reason: 'trade_fee',
          refType: 'spot',
          refId: symbol,
          idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:fee` : undefined,
        });
        this.teiai.bankIncome(guildId, q.fee, { thermo: true, nowMs });
      }

      this.deps.store
        .stmt(
          `INSERT INTO positions_spot (guild_id, user_id, symbol, units_milli, cost)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (guild_id, user_id, symbol) DO UPDATE SET
             units_milli = units_milli + excluded.units_milli,
             cost = cost + excluded.cost`,
        )
        .run(guildId, userId, symbol, q.unitsMilli, q.total);

      const balAfter = this.deps.economy.getBalance(guildId, userId);
      const bus = this.deps.bus;
      if (bus) {
        const orderId = buyRes.entry.id;
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'OrderFilled',
            guildId,
            at: nowMs,
            userId,
            orderId,
            ticker: symbol,
            side: 'buy',
            quantity: q.unitsMilli,
            price: priceMicros,
          });
        });
      }

      return {
        ok: true,
        data: {
          unitsMilli: q.unitsMilli,
          money: q.total,
          fee: q.fee,
          tax: 0,
          profit: 0,
          balance: balAfter,
        },
      };
    });
  }

  sellSpot(
    guildId: string,
    userId: string,
    symbol: SymbolKey,
    unitsMilli: number,
    nowMs = this.deps.clock.now(),
    options: {
      readonly taxable?: boolean;
      readonly bypassPinAndCollateral?: boolean;
      readonly priceMicrosOverride?: number;
      readonly idempotencyKey?: string;
    } = {},
  ): ServiceResult<SpotTradeResult> {
    if (!Number.isInteger(unitsMilli) || unitsMilli <= 0) {
      return { ok: false, reason: 'invalid_units' };
    }
    const taxable = options.taxable ?? true;
    const bypass = options.bypassPinAndCollateral ?? false;

    return this.deps.store.transaction(() => {
      if (!bypass) {
        const pins = this.getPinStates(nowMs);
        if (isActionPinned(pins[symbol], 'sell_spot')) {
          return { ok: false, reason: 'market_limit_down_blocked' };
        }
      }
      const pos = this.deps.store
        .stmt('SELECT * FROM positions_spot WHERE guild_id = ? AND user_id = ? AND symbol = ?')
        .get(guildId, userId, symbol) as SpotHoldingRow | undefined;
      if (!pos || pos.units_milli < unitsMilli) {
        return { ok: false, reason: 'market_insufficient_units' };
      }

      const prices = this.getPricesMicros(nowMs);
      const priceMicros = options.priceMicrosOverride ?? prices[symbol];

      // Cross-margin collateral guard: cannot sell spot collateral if margin ratio would drop below 100%
      if (!bypass) {
        const marginBefore = this.getPortfolioMarginStatus(guildId, userId, nowMs);
        if (marginBefore.required > 0) {
          const soldVal = (unitsMilli * microsToPrice(priceMicros)) / QUANTITY_SCALE;
          const nextEquity =
            marginBefore.equity - (soldVal * MARKET_CONSTANTS.collateralHaircutBps.spot) / 10_000;
          if (nextEquity / marginBefore.required < MARKET_CONSTANTS.losscutRatioBps / 10_000) {
            return { ok: false, reason: 'market_collateral_locked' };
          }
        }
      }

      const q = spotSellQuote(unitsMilli, priceMicros);
      const costRemoved = removedCostBasis(pos.cost, unitsMilli, pos.units_milli);
      const profit = q.proceeds - costRemoved;
      const tax = taxable && profit > 0 ? capitalGainsTax(profit) : 0;
      const netCash = Math.max(0, q.proceeds - tax);

      const leftUnits = pos.units_milli - unitsMilli;
      const leftCost = Math.max(0, pos.cost - costRemoved);
      if (leftUnits <= 0) {
        this.deps.store
          .stmt('DELETE FROM positions_spot WHERE guild_id = ? AND user_id = ? AND symbol = ?')
          .run(guildId, userId, symbol);
      } else {
        this.deps.store
          .stmt(
            'UPDATE positions_spot SET units_milli = ?, cost = ? WHERE guild_id = ? AND user_id = ? AND symbol = ?',
          )
          .run(leftUnits, leftCost, guildId, userId, symbol);
      }

      let orderId = 1;
      if (q.gross > 0) {
        const sellRes = this.deps.economy.credit({
          guildId,
          userId,
          amount: q.gross,
          reason: 'stock_sell',
          refType: 'spot',
          refId: symbol,
          idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:sell` : undefined,
        });
        orderId = sellRes.entry.id;
      }
      if (q.fee > 0) {
        this.deps.economy.debit({
          guildId,
          userId,
          amount: q.fee,
          reason: 'trade_fee',
          refType: 'spot',
          refId: symbol,
          idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:fee` : undefined,
        });
        this.teiai.bankIncome(guildId, q.fee, { thermo: true, nowMs });
      }
      if (tax > 0) {
        this.deps.economy.debit({
          guildId,
          userId,
          amount: tax,
          reason: 'capital_gains_tax',
          refType: 'spot',
          refId: symbol,
          idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:tax` : undefined,
        });
        this.teiai.bankIncome(guildId, tax, { thermo: true, nowMs });
      }

      const balAfter = this.deps.economy.getBalance(guildId, userId);
      const bus = this.deps.bus;
      if (bus) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'OrderFilled',
            guildId,
            at: nowMs,
            userId,
            orderId,
            ticker: symbol,
            side: 'sell',
            quantity: unitsMilli,
            price: priceMicros,
          });
        });
      }

      return {
        ok: true,
        data: {
          unitsMilli,
          money: netCash,
          fee: q.fee,
          tax,
          profit,
          balance: balAfter,
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Cross-Margin Positions (Long & Short), Margin Interest & Loss-Cut
  // -------------------------------------------------------------------------

  private listMarginSnapshots(guildId: string, userId: string): MarginPositionSnapshot[] {
    const longs = this.deps.store
      .stmt('SELECT * FROM positions_long WHERE guild_id = ? AND user_id = ? AND units_milli > 0')
      .all(guildId, userId) as MarginPositionRow[];
    const shorts = this.deps.store
      .stmt('SELECT * FROM positions_short WHERE guild_id = ? AND user_id = ? AND units_milli > 0')
      .all(guildId, userId) as MarginPositionRow[];
    return [
      ...longs.map((r) => ({
        symbol: r.symbol,
        side: 'long' as const,
        unitsMilli: r.units_milli,
        entryValueMicros: r.entry_value_micros,
        margin: r.margin,
      })),
      ...shorts.map((r) => ({
        symbol: r.symbol,
        side: 'short' as const,
        unitsMilli: r.units_milli,
        entryValueMicros: r.entry_value_micros,
        margin: r.margin,
      })),
    ];
  }

  getPortfolioMarginStatus(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
  ): PortfolioMarginStatus {
    const prices = this.getPricesMicros(nowMs);
    const positions = this.listMarginSnapshots(guildId, userId);
    const spots = this.getSpotHoldings(guildId, userId);
    let spotValuePelica = 0;
    for (const s of spots) {
      spotValuePelica += (s.units_milli * microsToPrice(prices[s.symbol])) / QUANTITY_SCALE;
    }
    const bondRows = this.deps.store
      .stmt(
        "SELECT kind, COALESCE(SUM(principal), 0) AS total FROM bonds WHERE guild_id = ? AND user_id = ? AND status = 'active' GROUP BY kind",
      )
      .all(guildId, userId) as { kind: BondKindKey; total: number }[];
    let normalBondPrincipal = 0;
    let junkBondPrincipal = 0;
    for (const b of bondRows) {
      if (b.kind === 'normal') normalBondPrincipal = b.total;
      else junkBondPrincipal = b.total;
    }

    return computePortfolioMarginStatus({
      positions,
      pricesMicros: prices,
      spotValuePelica,
      normalBondPrincipal,
      junkBondPrincipal,
    });
  }

  openMargin(
    guildId: string,
    userId: string,
    side: MarginSide,
    symbol: SymbolKey,
    marginPelica: number,
    leverage: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{ readonly unitsMilli: number; readonly margin: number }> {
    if (!Number.isInteger(marginPelica) || marginPelica < MARKET_CONSTANTS.minMargin) {
      return { ok: false, reason: 'margin_min_amount' };
    }
    if (!MARKET_CONSTANTS.allowedLeverages.includes(leverage)) {
      return { ok: false, reason: 'margin_invalid_leverage' };
    }

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'market_debtor_blocked' };
      }
      const pins = this.getPinStates(nowMs);
      if (side === 'long' && isActionPinned(pins[symbol], 'open_long')) {
        return { ok: false, reason: 'market_pin_blocked' };
      }
      if (this.deps.economy.getBalance(guildId, userId) < marginPelica) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const prices = this.getPricesMicros(nowMs);
      const priceMicros = prices[symbol];
      const notionalPelica = marginPelica * leverage;
      const unitsMilli = Math.floor((notionalPelica * QUANTITY_SCALE) / microsToPrice(priceMicros));
      if (unitsMilli <= 0) return { ok: false, reason: 'market_order_too_small' };
      const entryValueMicros = Math.round(
        ((unitsMilli * microsToPrice(priceMicros)) / QUANTITY_SCALE) * PRICE_SCALE,
      );

      // Verify post-open portfolio cross-margin ratio >= 130%
      const existingSnaps = this.listMarginSnapshots(guildId, userId);
      const simulated: MarginPositionSnapshot[] = [
        ...existingSnaps,
        { symbol, side, unitsMilli, entryValueMicros, margin: marginPelica },
      ];
      const currentStatus = this.getPortfolioMarginStatus(guildId, userId, nowMs);
      const spotAndBondCollateral =
        currentStatus.equity -
        existingSnaps.reduce(
          (sum, p) =>
            sum + p.margin + marginPnl(p.side, p.unitsMilli, p.entryValueMicros, prices[p.symbol]),
          0,
        );
      const simStatus = computePortfolioMarginStatus({
        positions: simulated,
        pricesMicros: prices,
        spotValuePelica:
          spotAndBondCollateral / (MARKET_CONSTANTS.collateralHaircutBps.spot / 10_000),
        normalBondPrincipal: 0,
        junkBondPrincipal: 0,
      });
      if (!simStatus.meetsOpenRatio) {
        return { ok: false, reason: 'margin_ratio_too_low' };
      }

      const openRes = this.deps.economy.debit({
        guildId,
        userId,
        amount: marginPelica,
        reason: 'margin_open',
        refType: `margin_${side}`,
        refId: symbol,
        idempotencyKey,
      });

      const table = this.marginTable(side);
      this.deps.store
        .stmt(
          `INSERT INTO ${table} (
            guild_id, user_id, symbol, units_milli, entry_value_micros, margin, opened_at, interest_at, interest_accrued_micros
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT (guild_id, user_id, symbol) DO UPDATE SET
            units_milli = units_milli + excluded.units_milli,
            entry_value_micros = entry_value_micros + excluded.entry_value_micros,
            margin = margin + excluded.margin`,
        )
        .run(guildId, userId, symbol, unitsMilli, entryValueMicros, marginPelica, nowMs, nowMs);

      const bus = this.deps.bus;
      if (bus) {
        const orderId = openRes.entry.id;
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'OrderFilled',
            guildId,
            at: nowMs,
            userId,
            orderId,
            ticker: symbol,
            side: side === 'long' ? 'buy' : 'sell',
            quantity: unitsMilli,
            price: priceMicros,
          });
        });
      }

      return { ok: true, data: { unitsMilli, margin: marginPelica } };
    });
  }

  closeMargin(
    guildId: string,
    userId: string,
    side: MarginSide,
    symbol: SymbolKey,
    nowMs = this.deps.clock.now(),
    options: { readonly bypassPin?: boolean; readonly idempotencyKey?: string } = {},
  ): ServiceResult<{
    readonly pnl: number;
    readonly returned: number;
    readonly tax: number;
    readonly owed: number;
  }> {
    return this.deps.store.transaction(() => {
      if (!options.bypassPin) {
        const pins = this.getPinStates(nowMs);
        const pinAction = side === 'long' ? 'close_long' : 'cover_short';
        if (isActionPinned(pins[symbol], pinAction)) {
          return { ok: false, reason: 'market_pin_blocked' };
        }
      }

      const table = this.marginTable(side);
      const pos = this.deps.store
        .stmt(`SELECT * FROM ${table} WHERE guild_id = ? AND user_id = ? AND symbol = ?`)
        .get(guildId, userId, symbol) as MarginPositionRow | undefined;
      if (!pos || pos.units_milli <= 0) {
        return { ok: false, reason: 'margin_position_not_found' };
      }

      const priceMicros = this.getPricesMicros(nowMs)[symbol];
      const pnl = marginPnl(side, pos.units_milli, pos.entry_value_micros, priceMicros);
      const grossReturn = pos.margin + pnl;
      const tax = pnl > 0 ? capitalGainsTax(pnl) : 0;

      this.deps.store
        .stmt(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ? AND symbol = ?`)
        .run(guildId, userId, symbol);

      let returned = 0;
      let owed = 0;
      let orderId = 1;

      if (grossReturn > 0) {
        const closeRes = this.deps.economy.credit({
          guildId,
          userId,
          amount: grossReturn,
          reason: 'margin_close',
          refType: `margin_${side}`,
          refId: symbol,
          idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:close` : undefined,
        });
        orderId = closeRes.entry.id;
        if (tax > 0) {
          const actualTax = Math.min(tax, this.deps.economy.getBalance(guildId, userId));
          if (actualTax > 0) {
            this.deps.economy.debit({
              guildId,
              userId,
              amount: actualTax,
              reason: 'capital_gains_tax',
              refType: `margin_${side}`,
              refId: symbol,
              idempotencyKey: options.idempotencyKey ? `${options.idempotencyKey}:tax` : undefined,
            });
            this.teiai.bankIncome(guildId, actualTax, { thermo: true, nowMs });
          }
        }
        returned = Math.max(0, grossReturn - tax);
      } else if (grossReturn < 0) {
        owed = -grossReturn;
        this.teiai.owe(guildId, userId, owed, { refType: `margin_${side}_deficit`, nowMs });
      }

      // Bank absorbs PnL counterparty side
      if (pnl > 0) {
        this.teiai.bankOutflow(guildId, pnl, { useTrust: true, thermo: true, nowMs });
      } else if (pnl < 0) {
        this.teiai.bankIncome(guildId, -pnl, { thermo: true, nowMs });
      }

      const bus = this.deps.bus;
      if (bus) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'OrderFilled',
            guildId,
            at: nowMs,
            userId,
            orderId,
            ticker: symbol,
            side: side === 'long' ? 'sell' : 'buy',
            quantity: pos.units_milli,
            price: priceMicros,
          });
        });
      }

      return { ok: true, data: { pnl, returned, tax, owed } };
    });
  }

  /**
   * Charge cross-margin financing interest across all open positions (CODE behaviour):
   * 0.10%/day long on `entry - margin`; 0.05%/day short on `entry`; min charge `10` Pelica.
   */
  accrueAllMarginInterest(guildId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      let totalCharged = 0;
      for (const side of ['long', 'short'] as const) {
        const table = this.marginTable(side);
        const rows = this.deps.store
          .stmt(`SELECT * FROM ${table} WHERE guild_id = ? AND units_milli > 0`)
          .all(guildId) as MarginPositionRow[];
        for (const row of rows) {
          const elapsedSec = Math.max(0, (nowMs - row.interest_at) / 1_000);
          if (elapsedSec <= 0) continue;
          const res = accrueMarginInterest({
            side,
            entryValueMicros: row.entry_value_micros,
            marginPelica: row.margin,
            accruedMicros: row.interest_accrued_micros,
            elapsedSeconds: elapsedSec,
          });
          this.deps.store
            .stmt(
              `UPDATE ${table}
               SET margin = margin - ?, interest_at = ?, interest_accrued_micros = ?
               WHERE guild_id = ? AND user_id = ? AND symbol = ?`,
            )
            .run(
              res.marginDeducted,
              nowMs,
              res.nextAccruedMicros,
              guildId,
              row.user_id,
              row.symbol,
            );

          if (res.chargePelica > 0) {
            totalCharged += res.chargePelica;
            this.teiai.bankIncome(guildId, res.chargePelica, { thermo: true, nowMs });
          }
          if (res.debtOverflow > 0) {
            this.teiai.owe(guildId, row.user_id, res.debtOverflow, {
              refType: 'margin_interest_overflow',
              nowMs,
            });
          }
        }
      }
      return totalCharged;
    });
  }

  /** Enforce cross-margin loss-cut (`ratio < 0.80`) across all margin holders in `guildId`. */
  enforceLossCuts(guildId: string, nowMs = this.deps.clock.now()): string[] {
    return this.deps.store.transaction(() => {
      const holders = this.deps.store
        .stmt(
          `SELECT DISTINCT user_id FROM positions_long WHERE guild_id = ? AND units_milli > 0
           UNION
           SELECT DISTINCT user_id FROM positions_short WHERE guild_id = ? AND units_milli > 0`,
        )
        .all(guildId, guildId) as { user_id: string }[];

      const cutUsers: string[] = [];
      for (const { user_id: userId } of holders) {
        const status = this.getPortfolioMarginStatus(guildId, userId, nowMs);
        if (!status.needsLossCut) continue;

        const longs = this.deps.store
          .stmt(
            'SELECT symbol FROM positions_long WHERE guild_id = ? AND user_id = ? AND units_milli > 0',
          )
          .all(guildId, userId) as { symbol: SymbolKey }[];
        for (const r of longs) {
          this.closeMargin(guildId, userId, 'long', r.symbol, nowMs, { bypassPin: true });
        }
        const shorts = this.deps.store
          .stmt(
            'SELECT symbol FROM positions_short WHERE guild_id = ? AND user_id = ? AND units_milli > 0',
          )
          .all(guildId, userId) as { symbol: SymbolKey }[];
        for (const r of shorts) {
          this.closeMargin(guildId, userId, 'short', r.symbol, nowMs, { bypassPin: true });
        }
        cutUsers.push(userId);
      }
      return cutUsers;
    });
  }

  // -------------------------------------------------------------------------
  // Options (Black-Scholes Call/Put, Margrabe Pair, Naked Short Writing)
  // -------------------------------------------------------------------------

  buyOption(input: {
    readonly guildId: string;
    readonly userId: string;
    readonly kind: OptionKind;
    readonly symbol: SymbolKey;
    readonly symbolB?: SymbolKey;
    readonly premium: number;
    readonly hours: number;
    readonly customTargetPct?: number;
    readonly nowMs?: number;
    readonly idempotencyKey?: string;
  }): ServiceResult<OptionRow> {
    const nowMs = input.nowMs ?? this.deps.clock.now();
    const hours = input.hours ?? OPTION_CONSTANTS.optionHours;
    if (!Number.isInteger(input.premium) || input.premium < OPTION_CONSTANTS.minPremium) {
      return { ok: false, reason: 'option_min_premium' };
    }
    if (!Number.isInteger(hours) || hours <= 0 || hours > 24) {
      return { ok: false, reason: 'option_invalid_hours' };
    }
    if (input.kind === 'pair' && (!input.symbolB || input.symbolB === input.symbol)) {
      return { ok: false, reason: 'option_invalid_pair' };
    }

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(input.guildId, input.userId) !== 'katagi') {
        return { ok: false, reason: 'market_debtor_blocked' };
      }
      if (this.deps.economy.getBalance(input.guildId, input.userId) < input.premium) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const prices = this.getPricesMicros(nowMs);
      const events = this.getPricingEvents(nowMs);
      const horizonSec = hours * 3_600;
      const expiresAt = nowMs + hours * MS_PER_HOUR;

      let strikeMicros = 0;
      let unitsMilli = 0;
      let notional = 0;
      let entryAMicros = 0;
      let entryBMicros = 0;

      if (input.kind === 'pair') {
        const symB = input.symbolB!;
        const rate = pairAskRate(input.symbol, symB, horizonSec, nowMs, events);
        if (rate <= 0) return { ok: false, reason: 'option_unpriceable' };
        notional = truncInt(input.premium / rate);
        if (notional <= 0) return { ok: false, reason: 'option_too_small' };
        entryAMicros = prices[input.symbol];
        entryBMicros = prices[symB];
      } else {
        const spotMicros = prices[input.symbol];
        strikeMicros = optionStrikeMicros(
          input.kind,
          spotMicros,
          input.symbol,
          input.customTargetPct,
        );
        const askPerUnit = optionAskPerUnit(
          input.kind,
          input.symbol,
          spotMicros,
          strikeMicros,
          horizonSec,
          nowMs,
          events,
        );
        if (askPerUnit <= 0) return { ok: false, reason: 'option_unpriceable' };
        unitsMilli = truncInt(input.premium / askPerUnit);
        if (unitsMilli <= 0) return { ok: false, reason: 'option_too_small' };
      }

      this.deps.economy.debit({
        guildId: input.guildId,
        userId: input.userId,
        amount: input.premium,
        reason: 'option_premium',
        refType: `option_${input.kind}`,
        refId: input.symbol,
        idempotencyKey: input.idempotencyKey,
      });
      this.teiai.bankIncome(input.guildId, input.premium, { thermo: true, nowMs });

      const res = this.deps.store
        .stmt(
          `INSERT INTO options (
            guild_id, user_id, side, kind, symbol, symbol_b, strike_micros, units_milli, notional,
            entry_a_micros, entry_b_micros, premium, margin, status, created_at, expires_at
          ) VALUES (?, ?, 'long', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?, ?)`,
        )
        .run(
          input.guildId,
          input.userId,
          input.kind,
          input.symbol,
          input.symbolB ?? null,
          strikeMicros,
          unitsMilli,
          notional,
          entryAMicros,
          entryBMicros,
          input.premium,
          nowMs,
          expiresAt,
        );

      const row = this.deps.store
        .stmt('SELECT * FROM options WHERE id = ?')
        .get(Number(res.lastInsertRowid)) as OptionRow;
      return { ok: true, data: row };
    });
  }

  /** Write (sell) a naked short single option; posts 20% strike margin and receives bid premium. */
  writeOption(input: {
    readonly guildId: string;
    readonly userId: string;
    readonly kind: 'call' | 'put';
    readonly symbol: SymbolKey;
    readonly unitsMilli: number;
    readonly hours?: number;
    readonly customTargetPct?: number;
    readonly nowMs?: number;
    readonly idempotencyKey?: string;
  }): ServiceResult<OptionRow> {
    const nowMs = input.nowMs ?? this.deps.clock.now();
    const hours = input.hours ?? OPTION_CONSTANTS.optionHours;
    if (!Number.isInteger(input.unitsMilli) || input.unitsMilli <= 0) {
      return { ok: false, reason: 'invalid_units' };
    }
    if (!Number.isInteger(hours) || hours <= 0 || hours > 24) {
      return { ok: false, reason: 'option_invalid_hours' };
    }

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(input.guildId, input.userId) !== 'katagi') {
        return { ok: false, reason: 'market_debtor_blocked' };
      }
      const spotMicros = this.getPricesMicros(nowMs)[input.symbol];
      const strikeMicros = optionStrikeMicros(
        input.kind,
        spotMicros,
        input.symbol,
        input.customTargetPct,
      );
      const margin = shortOptionMarginRequired(strikeMicros, input.unitsMilli);
      if (this.deps.economy.getBalance(input.guildId, input.userId) < margin) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const events = this.getPricingEvents(nowMs);
      const bidPerUnit = optionBidPerUnit(
        input.kind,
        input.symbol,
        spotMicros,
        strikeMicros,
        hours * 3_600,
        nowMs,
        events,
      );
      const premium = truncInt(bidPerUnit * input.unitsMilli);
      if (premium <= 0) return { ok: false, reason: 'option_too_small' };

      this.deps.economy.debit({
        guildId: input.guildId,
        userId: input.userId,
        amount: margin,
        reason: 'margin_open',
        refType: 'option_write_margin',
        refId: input.symbol,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:margin` : undefined,
      });
      this.teiai.bankOutflow(input.guildId, premium, { useTrust: true, thermo: true, nowMs });
      this.deps.economy.credit({
        guildId: input.guildId,
        userId: input.userId,
        amount: premium,
        reason: 'option_write_premium',
        refType: `option_${input.kind}`,
        refId: input.symbol,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:prem` : undefined,
      });

      const expiresAt = nowMs + hours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO options (
            guild_id, user_id, side, kind, symbol, symbol_b, strike_micros, units_milli, notional,
            entry_a_micros, entry_b_micros, premium, margin, status, created_at, expires_at
          ) VALUES (?, ?, 'short', ?, ?, NULL, ?, ?, 0, 0, 0, ?, ?, 'open', ?, ?)`,
        )
        .run(
          input.guildId,
          input.userId,
          input.kind,
          input.symbol,
          strikeMicros,
          input.unitsMilli,
          premium,
          margin,
          nowMs,
          expiresAt,
        );

      const row = this.deps.store
        .stmt('SELECT * FROM options WHERE id = ?')
        .get(Number(res.lastInsertRowid)) as OptionRow;
      return { ok: true, data: row };
    });
  }

  /** Early resale of a long option at current bid value. */
  sellOptionEarly(
    guildId: string,
    userId: string,
    optionId: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const opt = this.deps.store.stmt('SELECT * FROM options WHERE id = ?').get(optionId) as
        OptionRow | undefined;
      if (
        !opt ||
        opt.guild_id !== guildId ||
        opt.user_id !== userId ||
        opt.side !== 'long' ||
        opt.status !== 'open'
      ) {
        return { ok: false, reason: 'option_not_found' };
      }

      const bidVal = this.evaluateLongOptionValueInTx(opt, nowMs, false);
      this.deps.store
        .stmt("UPDATE options SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
        .run(bidVal, nowMs, optionId);

      if (bidVal > 0) {
        this.teiai.bankOutflow(guildId, bidVal, { useTrust: true, thermo: true, nowMs });
        this.deps.economy.credit({
          guildId,
          userId,
          amount: bidVal,
          reason: 'option_payout',
          refType: 'option_sell',
          refId: String(optionId),
          idempotencyKey,
        });
      }
      return { ok: true, data: bidVal };
    });
  }

  /** Buy back a short option early at current ask price, releasing posted margin. */
  buybackOption(
    guildId: string,
    userId: string,
    optionId: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{ readonly cost: number; readonly marginReturned: number }> {
    return this.deps.store.transaction(() => {
      const opt = this.deps.store.stmt('SELECT * FROM options WHERE id = ?').get(optionId) as
        OptionRow | undefined;
      if (
        !opt ||
        opt.guild_id !== guildId ||
        opt.user_id !== userId ||
        opt.side !== 'short' ||
        opt.status !== 'open' ||
        opt.kind === 'pair'
      ) {
        return { ok: false, reason: 'option_not_found' };
      }

      const prices = this.getPricesMicros(nowMs);
      const events = this.getPricingEvents(nowMs);
      const remSec = Math.max(0, (opt.expires_at - nowMs) / 1_000);
      const askPerUnit = optionAskPerUnit(
        opt.kind,
        opt.symbol,
        prices[opt.symbol],
        opt.strike_micros,
        remSec,
        nowMs,
        events,
      );
      const cost = Math.ceil(askPerUnit * opt.units_milli);

      this.deps.store
        .stmt("UPDATE options SET status = 'bought_back', payout = ?, settled_at = ? WHERE id = ?")
        .run(cost, nowMs, optionId);

      if (opt.margin > 0) {
        this.deps.economy.credit({
          guildId,
          userId,
          amount: opt.margin,
          reason: 'margin_close',
          refType: 'option_buyback_margin',
          refId: String(optionId),
        });
      }

      if (cost > 0) {
        const bal = this.deps.economy.getBalance(guildId, userId);
        const payCash = Math.min(bal, cost);
        if (payCash > 0) {
          this.deps.economy.debit({
            guildId,
            userId,
            amount: payCash,
            reason: 'option_buyback',
            refType: 'option',
            refId: String(optionId),
            idempotencyKey,
          });
        }
        const rest = cost - payCash;
        if (rest > 0) {
          this.teiai.owe(guildId, userId, rest, { refType: 'option_buyback_deficit', nowMs });
        }
        this.teiai.bankIncome(guildId, cost, { thermo: true, nowMs });
      }

      return { ok: true, data: { cost, marginReturned: opt.margin } };
    });
  }

  private evaluateLongOptionValueInTx(opt: OptionRow, nowMs: number, atExpiry: boolean): number {
    const prices = this.getPricesMicros(nowMs);
    if (atExpiry) {
      if (opt.kind === 'pair' && opt.symbol_b) {
        const raw = pairIntrinsic(
          opt.notional,
          opt.entry_a_micros,
          opt.entry_b_micros,
          prices[opt.symbol],
          prices[opt.symbol_b],
        );
        return optionBuyerPayout(raw, opt.premium);
      }
      if (opt.kind === 'call' || opt.kind === 'put') {
        const raw = optionIntrinsic(
          opt.kind,
          opt.units_milli,
          prices[opt.symbol],
          opt.strike_micros,
        );
        return optionBuyerPayout(raw, opt.premium);
      }
      return 0;
    }

    const remSec = Math.max(0, (opt.expires_at - nowMs) / 1_000);
    const events = this.getPricingEvents(nowMs);
    if (opt.kind === 'pair' && opt.symbol_b) {
      const relA = microsToPrice(prices[opt.symbol]) / microsToPrice(opt.entry_a_micros);
      const relB = microsToPrice(prices[opt.symbol_b]) / microsToPrice(opt.entry_b_micros);
      const rate = pairBidRate(opt.symbol, opt.symbol_b, relA, relB, remSec, nowMs, events);
      return optionBuyerPayout(truncInt(opt.notional * rate), opt.premium);
    }
    if (opt.kind === 'call' || opt.kind === 'put') {
      const bid = optionBidPerUnit(
        opt.kind,
        opt.symbol,
        prices[opt.symbol],
        opt.strike_micros,
        remSec,
        nowMs,
        events,
      );
      return optionBuyerPayout(truncInt(bid * opt.units_milli), opt.premium);
    }
    return 0;
  }

  /** Settle all expired open options in `guildId`. */
  settleExpiredOptions(guildId: string, nowMs = this.deps.clock.now()): OptionRow[] {
    return this.deps.store.transaction(() => {
      const expired = this.deps.store
        .stmt(
          "SELECT * FROM options WHERE guild_id = ? AND status = 'open' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
        )
        .all(guildId, nowMs) as OptionRow[];

      const prices = this.getPricesMicros(nowMs);
      const settled: OptionRow[] = [];

      for (const opt of expired) {
        if (opt.side === 'long') {
          const payout = this.evaluateLongOptionValueInTx(opt, nowMs, true);
          this.deps.store
            .stmt("UPDATE options SET status = 'settled', payout = ?, settled_at = ? WHERE id = ?")
            .run(payout, nowMs, opt.id);
          if (payout > 0) {
            this.teiai.bankOutflow(guildId, payout, { useTrust: true, thermo: true, nowMs });
            this.teiai.creditWithWithholding(guildId, opt.user_id, payout, 'option_payout', {
              refType: 'option',
              refId: String(opt.id),
              nowMs,
            });
          }
        } else {
          // Short option expiry: writer owes intrinsic (capped only by writer's obligation)
          const obligation =
            opt.kind === 'call' || opt.kind === 'put'
              ? optionIntrinsic(opt.kind, opt.units_milli, prices[opt.symbol], opt.strike_micros)
              : 0;
          this.deps.store
            .stmt("UPDATE options SET status = 'settled', payout = ?, settled_at = ? WHERE id = ?")
            .run(obligation, nowMs, opt.id);

          const marginLeft = opt.margin - obligation;
          if (marginLeft > 0) {
            this.deps.economy.credit({
              guildId,
              userId: opt.user_id,
              amount: marginLeft,
              reason: 'margin_close',
              refType: 'option_short_expiry',
              refId: String(opt.id),
            });
          } else if (marginLeft < 0) {
            this.teiai.owe(guildId, opt.user_id, -marginLeft, {
              refType: 'option_short_deficit',
              nowMs,
            });
          }
          if (obligation > 0) {
            this.teiai.bankIncome(guildId, obligation, { thermo: true, nowMs });
          }
        }
        settled.push(
          this.deps.store.stmt('SELECT * FROM options WHERE id = ?').get(opt.id) as OptionRow,
        );
      }
      return settled;
    });
  }

  // -------------------------------------------------------------------------
  // Bonds (Normal & Junk)
  // -------------------------------------------------------------------------

  getActiveBondPrincipal(guildId: string): number {
    const row = this.deps.store
      .stmt(
        "SELECT COALESCE(SUM(principal), 0) AS total FROM bonds WHERE guild_id = ? AND status = 'active'",
      )
      .get(guildId) as { total: number };
    return row?.total ?? 0;
  }

  buyBond(
    guildId: string,
    userId: string,
    kind: BondKindKey,
    principal: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<BondRow> {
    if (!Number.isInteger(principal) || principal < BOND_CONSTANTS.minAmount) {
      return { ok: false, reason: 'bond_min_amount' };
    }
    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'market_debtor_blocked' };
      }
      if (this.deps.economy.getBalance(guildId, userId) < principal) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const rf = this.teiai.getRiskFreeRate(guildId, nowMs);
      const rateBps = bondRateBps(kind, rf);
      const def = BOND_CONSTANTS.kinds[kind];
      const dueAt = nowMs + def.hours * MS_PER_HOUR;

      this.deps.economy.debit({
        guildId,
        userId,
        amount: principal,
        reason: 'bond_buy',
        refType: `bond_${kind}`,
        idempotencyKey,
      });
      this.teiai.bankIncome(guildId, principal, { thermo: false, nowMs });

      const res = this.deps.store
        .stmt(
          `INSERT INTO bonds (guild_id, user_id, kind, principal, rate_bps, status, created_at, due_at, checked_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(guildId, userId, kind, principal, rateBps, nowMs, dueAt, nowMs);

      const row = this.deps.store
        .stmt('SELECT * FROM bonds WHERE id = ?')
        .get(Number(res.lastInsertRowid)) as BondRow;
      return { ok: true, data: row };
    });
  }

  /** Early DCF resale of an active normal bond (junk bonds cannot be sold early). */
  sellBondEarly(
    guildId: string,
    userId: string,
    bondId: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const bond = this.deps.store.stmt('SELECT * FROM bonds WHERE id = ?').get(bondId) as
        BondRow | undefined;
      if (
        !bond ||
        bond.guild_id !== guildId ||
        bond.user_id !== userId ||
        bond.status !== 'active'
      ) {
        return { ok: false, reason: 'bond_not_found' };
      }
      if (!BOND_CONSTANTS.kinds[bond.kind].sellable) {
        return { ok: false, reason: 'bond_not_sellable' };
      }

      // Cross-margin collateral guard
      const marginStatus = this.getPortfolioMarginStatus(guildId, userId, nowMs);
      if (marginStatus.required > 0) {
        const nextEquity =
          marginStatus.equity -
          (bond.principal * MARKET_CONSTANTS.collateralHaircutBps.normal) / 10_000;
        if (nextEquity / marginStatus.required < MARKET_CONSTANTS.losscutRatioBps / 10_000) {
          return { ok: false, reason: 'market_collateral_locked' };
        }
      }

      const rf = this.teiai.getRiskFreeRate(guildId, nowMs);
      const val = bondSaleValue(
        bond.principal,
        bond.rate_bps,
        nowMs,
        bond.due_at,
        bondSaleDiscountPerHour(rf),
      );
      this.deps.store
        .stmt("UPDATE bonds SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
        .run(val, nowMs, bondId);

      if (val > 0) {
        this.teiai.bankOutflow(guildId, val, { useTrust: true, thermo: true, nowMs });
        this.deps.economy.credit({
          guildId,
          userId,
          amount: val,
          reason: 'bond_redeem',
          refType: 'bond_early_sale',
          refId: String(bondId),
          idempotencyKey,
        });
      }
      return { ok: true, data: val };
    });
  }

  /** Settle active bonds in `guildId`: continuous Poisson default on junk bonds, maturity payouts. */
  settleBonds(
    guildId: string,
    nowMs = this.deps.clock.now(),
    rng: Rng = this.deps.rng,
  ): { readonly matured: BondRow[]; readonly defaulted: BondRow[] } {
    return this.deps.store.transaction(() => {
      const active = this.deps.store
        .stmt(
          "SELECT * FROM bonds WHERE guild_id = ? AND status = 'active' ORDER BY due_at ASC, id ASC",
        )
        .all(guildId) as BondRow[];

      const matured: BondRow[] = [];
      const defaulted: BondRow[] = [];

      for (const bond of active) {
        const def = BOND_CONSTANTS.kinds[bond.kind];
        const effectiveEnd = Math.min(nowMs, bond.due_at);
        const elapsedHours = Math.max(0, (effectiveEnd - bond.checked_at) / MS_PER_HOUR);

        if (def.defaultPct > 0 && elapsedHours > 0) {
          const pDefault = bondDefaultProbability(def, elapsedHours);
          if (rng.float() < pDefault) {
            this.deps.store
              .stmt(
                "UPDATE bonds SET status = 'defaulted', payout = 0, checked_at = ?, settled_at = ? WHERE id = ?",
              )
              .run(nowMs, nowMs, bond.id);
            defaulted.push(
              this.deps.store.stmt('SELECT * FROM bonds WHERE id = ?').get(bond.id) as BondRow,
            );
            continue;
          }
        }

        if (nowMs >= bond.due_at) {
          const interest = bondInterest(bond.principal, bond.rate_bps);
          const total = bond.principal + interest;
          this.teiai.bankOutflow(guildId, total, { useTrust: true, thermo: true, nowMs });
          this.deps.economy.credit({
            guildId,
            userId: bond.user_id,
            amount: bond.principal,
            reason: 'bond_redeem',
            refType: `bond_${bond.kind}`,
            refId: String(bond.id),
          });
          if (interest > 0) {
            this.teiai.creditWithWithholding(guildId, bond.user_id, interest, 'bond_coupon', {
              refType: `bond_${bond.kind}`,
              refId: String(bond.id),
              nowMs,
            });
          }
          this.deps.store
            .stmt(
              "UPDATE bonds SET status = 'matured', payout = ?, checked_at = ?, settled_at = ? WHERE id = ?",
            )
            .run(total, nowMs, nowMs, bond.id);
          matured.push(
            this.deps.store.stmt('SELECT * FROM bonds WHERE id = ?').get(bond.id) as BondRow,
          );
        } else {
          this.deps.store.stmt('UPDATE bonds SET checked_at = ? WHERE id = ?').run(nowMs, bond.id);
        }
      }

      return { matured, defaulted };
    });
  }

  // -------------------------------------------------------------------------
  // Insider Earnings Memos
  // -------------------------------------------------------------------------

  buyEarningsMemo(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
    rng: Rng = this.deps.rng,
    idempotencyKey?: string,
  ): ServiceResult<{
    readonly symbol: SymbolKey;
    readonly hint: -1 | 1;
    readonly releaseAtMs: number;
  }> {
    return this.deps.store.transaction(() => {
      const earn = this.deps.store
        .stmt(
          "SELECT * FROM earnings WHERE status = 'announced' AND release_at > ? ORDER BY release_at ASC LIMIT 1",
        )
        .get(nowMs) as
        { id: number; symbol: SymbolKey; direction: -1 | 1; release_at: number } | undefined;
      if (!earn) return { ok: false, reason: 'earnings_no_announced_event' };

      const existing = this.deps.store
        .stmt('SELECT 1 FROM earnings_memos WHERE guild_id = ? AND user_id = ? AND earnings_id = ?')
        .get(guildId, userId, earn.id);
      if (existing) return { ok: false, reason: 'earnings_memo_already_owned' };

      const shopRow = this.deps.store
        .stmt('SELECT sold FROM earnings_shop WHERE guild_id = ? AND earnings_id = ?')
        .get(guildId, earn.id) as { sold: number } | undefined;
      const sold = shopRow?.sold ?? 0;
      if (sold >= EARNINGS_CONSTANTS.shopStock) {
        return { ok: false, reason: 'earnings_memo_sold_out' };
      }
      if (this.deps.economy.getBalance(guildId, userId) < EARNINGS_CONSTANTS.shopMemoPrice) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      this.deps.economy.debit({
        guildId,
        userId,
        amount: EARNINGS_CONSTANTS.shopMemoPrice,
        reason: 'shop_buy',
        refType: 'earnings_memo',
        refId: String(earn.id),
        idempotencyKey,
      });
      this.teiai.bankIncome(guildId, EARNINGS_CONSTANTS.shopMemoPrice, { thermo: true, nowMs });

      const memo = buildEarningsMemo(
        SYMBOL_BY_KEY[earn.symbol].name,
        earn.direction,
        earn.release_at,
        EARNINGS_CONSTANTS.shopTruthBps,
        rng,
      );

      this.deps.store
        .stmt(
          `INSERT INTO earnings_memos (guild_id, user_id, earnings_id, symbol, hint, truth_bps, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(guildId, userId, earn.id, earn.symbol, memo.hint, memo.truthBps, nowMs);
      this.deps.store
        .stmt(
          `INSERT INTO earnings_shop (guild_id, earnings_id, sold) VALUES (?, ?, 1)
           ON CONFLICT (guild_id, earnings_id) DO UPDATE SET sold = sold + 1`,
        )
        .run(guildId, earn.id);

      return {
        ok: true,
        data: { symbol: earn.symbol, hint: memo.hint, releaseAtMs: earn.release_at },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Forced Execution & Bankruptcy Liquidation Hooks for TeiaiService
  // -------------------------------------------------------------------------

  /**
   * Forced execution Steps 4..7 (`owe_for`): Margin -> Spot (taxable=false) -> Options -> Normal Bonds.
   * Returns total Pelica recovered directly toward the debt need (up to `need`).
   */
  seizeSecurities(
    guildId: string,
    userId: string,
    need: number,
    nowMs = this.deps.clock.now(),
  ): number {
    if (need <= 0) return 0;
    return this.deps.store.transaction(() => {
      let rem = need;
      let recovered = 0;
      const prices = this.getPricesMicros(nowMs);

      // Step 4: Margin positions
      for (const side of ['long', 'short'] as const) {
        if (rem <= 0) break;
        const table = this.marginTable(side);
        const rows = this.deps.store
          .stmt(`SELECT * FROM ${table} WHERE guild_id = ? AND user_id = ? AND units_milli > 0`)
          .all(guildId, userId) as MarginPositionRow[];
        for (const r of rows) {
          if (rem <= 0) break;
          const pnl = marginPnl(side, r.units_milli, r.entry_value_micros, prices[r.symbol]);
          const val = Math.max(0, r.margin + pnl);
          this.deps.store
            .stmt(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ? AND symbol = ?`)
            .run(guildId, userId, r.symbol);
          const take = Math.min(rem, val);
          rem -= take;
          recovered += take;
          const surplus = val - take;
          if (surplus > 0) {
            this.deps.economy.credit({
              guildId,
              userId,
              amount: surplus,
              reason: 'margin_close',
              refType: 'seizure_surplus',
              refId: r.symbol,
            });
          }
        }
      }

      // Step 5: Spot holdings (taxable=false)
      if (rem > 0) {
        const spots = this.getSpotHoldings(guildId, userId);
        for (const s of spots) {
          if (rem <= 0) break;
          const q = spotSellQuote(s.units_milli, prices[s.symbol]);
          this.deps.store
            .stmt('DELETE FROM positions_spot WHERE guild_id = ? AND user_id = ? AND symbol = ?')
            .run(guildId, userId, s.symbol);
          const take = Math.min(rem, q.proceeds);
          rem -= take;
          recovered += take;
          const surplus = q.proceeds - take;
          if (surplus > 0) {
            this.deps.economy.credit({
              guildId,
              userId,
              amount: surplus,
              reason: 'stock_sell',
              refType: 'seizure_surplus',
              refId: s.symbol,
            });
          }
        }
      }

      // Step 6: Long options
      if (rem > 0) {
        const opts = this.deps.store
          .stmt(
            "SELECT * FROM options WHERE guild_id = ? AND user_id = ? AND side = 'long' AND status = 'open'",
          )
          .all(guildId, userId) as OptionRow[];
        for (const opt of opts) {
          if (rem <= 0) break;
          const val = this.evaluateLongOptionValueInTx(opt, nowMs, false);
          this.deps.store
            .stmt("UPDATE options SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
            .run(val, nowMs, opt.id);
          if (val > 0) {
            this.teiai.bankOutflow(guildId, val, { useTrust: true, thermo: true, nowMs });
          }
          const take = Math.min(rem, val);
          rem -= take;
          recovered += take;
          const surplus = val - take;
          if (surplus > 0) {
            this.deps.economy.credit({
              guildId,
              userId,
              amount: surplus,
              reason: 'option_payout',
              refType: 'seizure_surplus',
              refId: String(opt.id),
            });
          }
        }
      }

      // Step 7: Sellable normal bonds
      if (rem > 0) {
        const rf = this.teiai.getRiskFreeRate(guildId, nowMs);
        const disc = bondSaleDiscountPerHour(rf);
        const normalBonds = this.deps.store
          .stmt(
            "SELECT * FROM bonds WHERE guild_id = ? AND user_id = ? AND kind = 'normal' AND status = 'active' ORDER BY id ASC",
          )
          .all(guildId, userId) as BondRow[];
        for (const b of normalBonds) {
          if (rem <= 0) break;
          const val = bondSaleValue(b.principal, b.rate_bps, nowMs, b.due_at, disc);
          this.deps.store
            .stmt("UPDATE bonds SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
            .run(val, nowMs, b.id);
          if (val > 0) {
            this.teiai.bankOutflow(guildId, val, { useTrust: true, thermo: true, nowMs });
          }
          const take = Math.min(rem, val);
          rem -= take;
          recovered += take;
          const surplus = val - take;
          if (surplus > 0) {
            this.deps.economy.credit({
              guildId,
              userId,
              amount: surplus,
              reason: 'bond_redeem',
              refType: 'seizure_surplus',
              refId: String(b.id),
            });
          }
        }
      }

      return recovered;
    });
  }

  /**
   * Full bankruptcy liquidation of all securities:
   * Margin -> Spot (taxable=false) -> Normal Bonds (DCF) + Junk Bonds (50% seize rate) -> Options.
   * Returns total Pelica added to the bankruptcy liquidation pool.
   */
  liquidateAllForBankruptcy(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
  ): number {
    return this.deps.store.transaction(() => {
      let pool = 0;
      const prices = this.getPricesMicros(nowMs);

      // 1. Margin positions
      for (const side of ['long', 'short'] as const) {
        const table = this.marginTable(side);
        const rows = this.deps.store
          .stmt(`SELECT * FROM ${table} WHERE guild_id = ? AND user_id = ? AND units_milli > 0`)
          .all(guildId, userId) as MarginPositionRow[];
        for (const r of rows) {
          const pnl = marginPnl(side, r.units_milli, r.entry_value_micros, prices[r.symbol]);
          pool += Math.max(0, r.margin + pnl);
          this.deps.store
            .stmt(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ? AND symbol = ?`)
            .run(guildId, userId, r.symbol);
        }
      }

      // 2. Spot holdings (taxable=false)
      const spots = this.getSpotHoldings(guildId, userId);
      for (const s of spots) {
        const q = spotSellQuote(s.units_milli, prices[s.symbol]);
        pool += q.proceeds;
        this.deps.store
          .stmt('DELETE FROM positions_spot WHERE guild_id = ? AND user_id = ? AND symbol = ?')
          .run(guildId, userId, s.symbol);
      }

      // 3. Bonds (normal DCF, junk 50% seize rate)
      const rf = this.teiai.getRiskFreeRate(guildId, nowMs);
      const disc = bondSaleDiscountPerHour(rf);
      const bonds = this.deps.store
        .stmt("SELECT * FROM bonds WHERE guild_id = ? AND user_id = ? AND status = 'active'")
        .all(guildId, userId) as BondRow[];
      for (const b of bonds) {
        const val =
          b.kind === 'normal'
            ? bondSaleValue(b.principal, b.rate_bps, nowMs, b.due_at, disc)
            : Math.floor((b.principal * TEIAI_CONSTANTS.seizeRateBps) / 10_000);
        this.deps.store
          .stmt("UPDATE bonds SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
          .run(val, nowMs, b.id);
        if (val > 0) {
          this.teiai.bankOutflow(guildId, val, { useTrust: true, thermo: true, nowMs });
          pool += val;
        }
      }

      // 4. Open options (long at bid value; short margin released minus ask cost)
      const opts = this.deps.store
        .stmt("SELECT * FROM options WHERE guild_id = ? AND user_id = ? AND status = 'open'")
        .all(guildId, userId) as OptionRow[];
      for (const opt of opts) {
        if (opt.side === 'long') {
          const val = this.evaluateLongOptionValueInTx(opt, nowMs, false);
          this.deps.store
            .stmt("UPDATE options SET status = 'sold', payout = ?, settled_at = ? WHERE id = ?")
            .run(val, nowMs, opt.id);
          if (val > 0) {
            this.teiai.bankOutflow(guildId, val, { useTrust: true, thermo: true, nowMs });
            pool += val;
          }
        } else {
          this.deps.store
            .stmt("UPDATE options SET status = 'settled', payout = 0, settled_at = ? WHERE id = ?")
            .run(nowMs, opt.id);
          pool += opt.margin;
        }
      }

      return pool;
    });
  }
}
