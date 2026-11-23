import {
  checkPairDailyLimit,
  doesMotionPass,
  hamiltonSplit,
  isKyosaiGateLocked,
  isPremiumNanoValid,
  KYOSAI_CONSTANTS,
  kyosaiAuctionLotSize,
  kyosaiDividendPool,
  kyosaiEndAfterBidMs,
  kyosaiMinNextBid,
  kyosaiTransferFee,
  MS_PER_DAY,
  MS_PER_HOUR,
  PLAYER_MARKET_CONSTANTS,
  type KyosaiAuctionStatus,
  type KyosaiMotionStatus,
  type KyosaiOfferStatus,
} from '@casino/domain/finance';
import type { ServiceResult, TeiaiService } from './teiai-service.ts';
import { financeDeps, getSharedPairVolume24h, type FinanceDeps } from './types.ts';

const HOUSE_HOLDER_KEY = '__house__';

export interface KyosaiAuctionRow {
  id: number;
  guild_id: string;
  units: number;
  status: KyosaiAuctionStatus;
  top_bid: number;
  top_bidder_id: string | null;
  ends_at: number;
  created_at: number;
}

export interface KyosaiOfferRow {
  id: number;
  guild_id: string;
  seller_id: string;
  buyer_id: string;
  units: number;
  price: number;
  fee: number;
  status: KyosaiOfferStatus;
  created_at: number;
  expires_at: number;
  done_at: number | null;
}

export interface KyosaiMotionRow {
  id: number;
  guild_id: string;
  proposer_id: string;
  proposed_premium_nano: number;
  status: KyosaiMotionStatus;
  yes_units: number;
  no_units: number;
  circulating_units: number;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
  closes_at: number;
  closed_at: number | null;
}

export interface KyosaiAuctionTickEvent {
  readonly event: 'listed' | 'sold' | 'unsold';
  readonly id: number;
  readonly guildId: string;
  readonly units: number;
  readonly topBid: number;
  readonly topBidderId: string | null;
  readonly endsAtMs: number;
  readonly announce: boolean;
}

export interface KyosaiStatusView {
  readonly total: number;
  readonly house: number;
  readonly circulating: number;
  readonly holders: number;
  readonly units: number;
  readonly pool: number;
  readonly premium: number;
  readonly theta: number | null;
  readonly locked: boolean;
  readonly auction: KyosaiAuctionRow | null;
  readonly motions: readonly KyosaiMotionRow[];
}

export class KyosaiService {
  private readonly deps: FinanceDeps;
  private readonly teiai: TeiaiService;

  constructor(deps: FinanceDeps, teiai: TeiaiService) {
    this.deps = financeDeps(deps);
    this.teiai = teiai;
  }

  /** Ensure fixed 10,000-unit guild supply exists (initially 100% held by house). */
  ensureSupply(guildId: string): void {
    const existing = this.deps.store
      .stmt('SELECT 1 AS found FROM kyosai_units WHERE guild_id = ? LIMIT 1')
      .get(guildId) as { found: number } | undefined;
    if (existing) return;
    this.deps.store
      .stmt(
        'INSERT INTO kyosai_units (guild_id, holder_key, user_id, is_house, units) VALUES (?, ?, NULL, 1, ?)',
      )
      .run(guildId, HOUSE_HOLDER_KEY, KYOSAI_CONSTANTS.totalUnits);
  }

  getHouseUnits(guildId: string): number {
    this.ensureSupply(guildId);
    const row = this.deps.store
      .stmt('SELECT units FROM kyosai_units WHERE guild_id = ? AND holder_key = ?')
      .get(guildId, HOUSE_HOLDER_KEY) as { units: number } | undefined;
    return row?.units ?? 0;
  }

  getUserUnits(guildId: string, userId: string): number {
    this.ensureSupply(guildId);
    const row = this.deps.store
      .stmt('SELECT units FROM kyosai_units WHERE guild_id = ? AND holder_key = ?')
      .get(guildId, userId) as { units: number } | undefined;
    return row?.units ?? 0;
  }

  private transferUnitsInTx(
    guildId: string,
    fromKey: string,
    toKey: string,
    toUserId: string | null,
    toIsHouse: boolean,
    units: number,
  ): void {
    if (units <= 0) return;
    this.deps.store
      .stmt('UPDATE kyosai_units SET units = units - ? WHERE guild_id = ? AND holder_key = ?')
      .run(units, guildId, fromKey);
    this.deps.store
      .stmt(
        `INSERT INTO kyosai_units (guild_id, holder_key, user_id, is_house, units)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, holder_key) DO UPDATE SET units = units + excluded.units`,
      )
      .run(guildId, toKey, toUserId, toIsHouse ? 1 : 0, units);
  }

  private isGateLockedInTx(
    guildId: string,
    nowMs: number,
  ): {
    readonly locked: boolean;
    readonly theta: number | null;
  } {
    const bank = this.teiai.getBankStatus(guildId, nowMs);
    const graceDebtors = this.teiai.getGraceDebtorCount(guildId);
    return {
      locked: isKyosaiGateLocked(bank.ratio, graceDebtors),
      theta: bank.ratio,
    };
  }

  getStatus(guildId: string, userId: string, nowMs = this.deps.clock.now()): KyosaiStatusView {
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const house = this.getHouseUnits(guildId);
      const circulating = KYOSAI_CONSTANTS.totalUnits - house;
      const units = this.getUserUnits(guildId, userId);
      const holders = (
        this.deps.store
          .stmt(
            'SELECT COUNT(*) AS cnt FROM kyosai_units WHERE guild_id = ? AND is_house = 0 AND units > 0',
          )
          .get(guildId) as { cnt: number }
      ).cnt;

      const bank = this.teiai.getBankStatus(guildId, nowMs);
      const graceDebtors = this.teiai.getGraceDebtorCount(guildId);
      const liabilities = bank.deposits + bank.bonds;
      const pool = kyosaiDividendPool(bank.available, liabilities);

      const auction =
        (this.deps.store
          .stmt(
            "SELECT * FROM kyosai_auctions WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
          )
          .get(guildId) as KyosaiAuctionRow | undefined) ?? null;

      const motions = this.deps.store
        .stmt(
          "SELECT * FROM kyosai_motions WHERE guild_id = ? AND status = 'open' ORDER BY closes_at ASC, id ASC",
        )
        .all(guildId) as KyosaiMotionRow[];

      return {
        total: KYOSAI_CONSTANTS.totalUnits,
        house,
        circulating,
        holders,
        units,
        pool,
        premium: bank.trustPremium,
        theta: bank.ratio,
        locked: isKyosaiGateLocked(bank.ratio, graceDebtors),
        auction,
        motions,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Excess-Loss Backstop & Daily Dividend + Dormant Recovery
  // -------------------------------------------------------------------------

  /**
   * Charge excess bank shortfall across ALL 10,000 units via Hamilton split.
   * House share is NOT paid (returned to `TeiaiService` for `excess_unpaid_micros`).
   * Player shares debit cash (`kyosai_charge`), and any shortfall becomes Toichi debt.
   */
  chargeExcess(guildId: string, amount: number, nowMs = this.deps.clock.now()): number {
    if (amount <= 0) return 0;
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const rows = this.deps.store
        .stmt(
          'SELECT holder_key, user_id, is_house, units FROM kyosai_units WHERE guild_id = ? AND units > 0',
        )
        .all(guildId) as {
        holder_key: string;
        user_id: string | null;
        is_house: number;
        units: number;
      }[];

      const shares = hamiltonSplit(
        amount,
        rows.map((r) => ({ holderId: r.is_house === 1 ? '0' : r.holder_key, units: r.units })),
      );

      let houseUnpaid = 0;
      for (const r of rows) {
        const key = r.is_house === 1 ? '0' : r.holder_key;
        const charge = shares[key] ?? 0;
        if (charge <= 0) continue;
        if (r.is_house === 1 || r.user_id === null) {
          houseUnpaid += charge;
          continue;
        }
        const bal = this.deps.economy.getBalance(guildId, r.user_id);
        const fromCash = Math.min(bal, charge);
        const debtRest = charge - fromCash;
        if (fromCash > 0) {
          this.deps.economy.debit({
            guildId,
            userId: r.user_id,
            amount: fromCash,
            reason: 'kyosai_charge',
            refType: 'kyosai_excess',
          });
        }
        if (debtRest > 0) {
          this.teiai.addDebtFromExcess(guildId, r.user_id, debtRest, nowMs);
        }
      }
      return houseUnpaid;
    });
  }

  /**
   * Daily dormant unit recovery (30d) + surplus dividend distribution (`kyosai_daily`).
   * First call initializes `kyosai_div_at = nowMs` and returns 0.
   */
  runDailyDividend(
    guildId: string,
    nowMs = this.deps.clock.now(),
  ): {
    readonly recoveredUsers: readonly string[];
    readonly dividendPaid: number;
  } {
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const resRow = this.teiai.ensureReserve(guildId, nowMs);
      if (resRow.kyosai_div_at <= 0) {
        this.deps.store
          .stmt('UPDATE bank_reserve SET kyosai_div_at = ? WHERE guild_id = ?')
          .run(nowMs, guildId);
        return { recoveredUsers: [], dividendPaid: 0 };
      }
      if (nowMs - resRow.kyosai_div_at < MS_PER_DAY) {
        return { recoveredUsers: [], dividendPaid: 0 };
      }

      // Step 1: Dormant recovery (30d without non-passive ledger activity)
      const dormantCutoff = nowMs - KYOSAI_CONSTANTS.dormantDays * MS_PER_DAY;
      const playerHolders = this.deps.store
        .stmt(
          'SELECT holder_key, user_id, units FROM kyosai_units WHERE guild_id = ? AND is_house = 0 AND units > 0',
        )
        .all(guildId) as { holder_key: string; user_id: string; units: number }[];

      const recoveredUsers: string[] = [];
      for (const h of playerHolders) {
        const lastRow = this.deps.store
          .stmt(
            `SELECT MAX(created_at) AS last_at FROM ledger
             WHERE guild_id = ? AND user_id = ?
               AND reason NOT IN ('kyosai_dividend', 'bank_interest', 'kyosai_charge')`,
          )
          .get(guildId, h.user_id) as { last_at: number | null };
        const memberRow = this.deps.store
          .stmt('SELECT created_at FROM guild_members WHERE guild_id = ? AND user_id = ?')
          .get(guildId, h.user_id) as { created_at: number } | undefined;
        const lastActive = lastRow?.last_at ?? memberRow?.created_at ?? 0;

        if (lastActive < dormantCutoff) {
          this.transferUnitsInTx(guildId, h.holder_key, HOUSE_HOLDER_KEY, null, true, h.units);
          this.deps.store
            .stmt(
              "UPDATE kyosai_offers SET status = 'cancelled' WHERE guild_id = ? AND seller_id = ? AND status = 'open'",
            )
            .run(guildId, h.user_id);
          recoveredUsers.push(h.user_id);
        }
      }

      // Step 2: Surplus dividend across all 10,000 units (house share stays in bank)
      const bank = this.teiai.getBankStatus(guildId, nowMs);
      const pool = kyosaiDividendPool(bank.available, bank.deposits + bank.bonds);
      let dividendPaid = 0;

      if (pool > 0) {
        const allHolders = this.deps.store
          .stmt(
            'SELECT holder_key, user_id, is_house, units FROM kyosai_units WHERE guild_id = ? AND units > 0',
          )
          .all(guildId) as {
          holder_key: string;
          user_id: string | null;
          is_house: number;
          units: number;
        }[];

        const shares = hamiltonSplit(
          pool,
          allHolders.map((r) => ({
            holderId: r.is_house === 1 ? '0' : r.holder_key,
            units: r.units,
          })),
        );

        let playerTotal = 0;
        const payouts: { userId: string; share: number }[] = [];
        for (const r of allHolders) {
          if (r.is_house === 1 || r.user_id === null) continue;
          const share = shares[r.holder_key] ?? 0;
          if (share > 0) {
            playerTotal += share;
            payouts.push({ userId: r.user_id, share });
          }
        }

        if (playerTotal > 0) {
          this.teiai.bankOutflow(guildId, playerTotal, { useTrust: false, thermo: false, nowMs });
          for (const p of payouts) {
            this.teiai.creditWithWithholding(guildId, p.userId, p.share, 'kyosai_dividend', {
              refType: 'kyosai_dividend',
              nowMs,
            });
            dividendPaid += p.share;
          }
        }
      }

      this.deps.store
        .stmt('UPDATE bank_reserve SET kyosai_div_at = ? WHERE guild_id = ?')
        .run(nowMs, guildId);

      return { recoveredUsers, dividendPaid };
    });
  }

  // -------------------------------------------------------------------------
  // House Unit Auctions
  // -------------------------------------------------------------------------

  /** Settle expired auctions and open the next 100-unit lot if house holds units. */
  tickAuctions(guildId: string, nowMs = this.deps.clock.now()): KyosaiAuctionTickEvent[] {
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const events: KyosaiAuctionTickEvent[] = [];

      const openAuctions = this.deps.store
        .stmt(
          "SELECT * FROM kyosai_auctions WHERE guild_id = ? AND status = 'open' ORDER BY id ASC",
        )
        .all(guildId) as KyosaiAuctionRow[];

      let hadUnsold = false;
      let stillOpen = false;

      for (const auc of openAuctions) {
        if (nowMs < auc.ends_at) {
          stillOpen = true;
          continue;
        }
        if (auc.top_bidder_id !== null && auc.top_bid > 0) {
          this.transferUnitsInTx(
            guildId,
            HOUSE_HOLDER_KEY,
            auc.top_bidder_id,
            auc.top_bidder_id,
            false,
            auc.units,
          );
          this.teiai.bankIncome(guildId, auc.top_bid, { thermo: true, nowMs });
          this.deps.store
            .stmt("UPDATE kyosai_auctions SET status = 'sold' WHERE id = ?")
            .run(auc.id);
          events.push({
            event: 'sold',
            id: auc.id,
            guildId,
            units: auc.units,
            topBid: auc.top_bid,
            topBidderId: auc.top_bidder_id,
            endsAtMs: auc.ends_at,
            announce: true,
          });
        } else {
          this.deps.store
            .stmt("UPDATE kyosai_auctions SET status = 'unsold' WHERE id = ?")
            .run(auc.id);
          hadUnsold = true;
          events.push({
            event: 'unsold',
            id: auc.id,
            guildId,
            units: auc.units,
            topBid: 0,
            topBidderId: null,
            endsAtMs: auc.ends_at,
            announce: false,
          });
        }
      }

      if (!stillOpen) {
        const houseUnits = this.getHouseUnits(guildId);
        const lot = kyosaiAuctionLotSize(houseUnits);
        if (lot > 0) {
          const endsAt = nowMs + KYOSAI_CONSTANTS.auctionHours * MS_PER_HOUR;
          const res = this.deps.store
            .stmt(
              `INSERT INTO kyosai_auctions (guild_id, units, status, top_bid, top_bidder_id, ends_at, created_at)
               VALUES (?, ?, 'open', 0, NULL, ?, ?)`,
            )
            .run(guildId, lot, endsAt, nowMs);
          events.push({
            event: 'listed',
            id: Number(res.lastInsertRowid),
            guildId,
            units: lot,
            topBid: 0,
            topBidderId: null,
            endsAtMs: endsAt,
            announce: !hadUnsold,
          });
        }
      }

      return events;
    });
  }

  /** Bid on the active Kyosai house unit auction. */
  bidAuction(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<KyosaiAuctionRow> {
    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'kyosai_debtor_blocked' };
      }
      const auc = this.deps.store
        .stmt(
          "SELECT * FROM kyosai_auctions WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
        )
        .get(guildId) as KyosaiAuctionRow | undefined;
      if (!auc || nowMs >= auc.ends_at) {
        return { ok: false, reason: 'kyosai_no_open_auction' };
      }
      const minBid = kyosaiMinNextBid(auc.top_bid);
      if (!Number.isInteger(amount) || amount < minBid) {
        return { ok: false, reason: 'kyosai_bid_too_low' };
      }

      const ownHeld = auc.top_bidder_id === userId ? auc.top_bid : 0;
      if (this.deps.economy.getBalance(guildId, userId) + ownHeld < amount) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      if (auc.top_bidder_id !== null && auc.top_bid > 0) {
        this.deps.economy.credit({
          guildId,
          userId: auc.top_bidder_id,
          amount: auc.top_bid,
          reason: 'kyosai_bid_release',
          refType: 'kyosai_auction',
          refId: String(auc.id),
        });
      }

      this.deps.economy.debit({
        guildId,
        userId,
        amount,
        reason: 'kyosai_bid_hold',
        refType: 'kyosai_auction',
        refId: String(auc.id),
        idempotencyKey,
      });

      const nextEnds = kyosaiEndAfterBidMs(auc.ends_at, nowMs);
      this.deps.store
        .stmt('UPDATE kyosai_auctions SET top_bid = ?, top_bidder_id = ?, ends_at = ? WHERE id = ?')
        .run(amount, userId, nextEnds, auc.id);

      const updated = this.deps.store
        .stmt('SELECT * FROM kyosai_auctions WHERE id = ?')
        .get(auc.id) as KyosaiAuctionRow;
      return { ok: true, data: updated };
    });
  }

  /** Pull back open Kyosai auction top bids for a user entering grace or bankruptcy. */
  pullBackBids(guildId: string, userId: string): void {
    this.deps.store.transaction(() => {
      const openBids = this.deps.store
        .stmt(
          "SELECT * FROM kyosai_auctions WHERE guild_id = ? AND status = 'open' AND top_bidder_id = ?",
        )
        .all(guildId, userId) as KyosaiAuctionRow[];
      for (const auc of openBids) {
        if (auc.top_bid > 0) {
          this.deps.economy.credit({
            guildId,
            userId,
            amount: auc.top_bid,
            reason: 'kyosai_bid_release',
            refType: 'kyosai_pullback',
            refId: String(auc.id),
          });
        }
        this.deps.store
          .stmt('UPDATE kyosai_auctions SET top_bid = 0, top_bidder_id = NULL WHERE id = ?')
          .run(auc.id);
      }
    });
  }

  /** Bankruptcy recovery: returns all user Kyosai units to house with 0 liquidation value. */
  recoverUnitsOnBankruptcy(guildId: string, userId: string): void {
    this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const held = this.getUserUnits(guildId, userId);
      if (held > 0) {
        this.transferUnitsInTx(guildId, userId, HOUSE_HOLDER_KEY, null, true, held);
      }
      this.deps.store
        .stmt(
          "UPDATE kyosai_offers SET status = 'cancelled' WHERE guild_id = ? AND seller_id = ? AND status = 'open'",
        )
        .run(guildId, userId);
    });
  }

  // -------------------------------------------------------------------------
  // P2P Unit Transfers (5% Fee + Liquidity Gate + Shared 24h Pair Cap)
  // -------------------------------------------------------------------------

  createOffer(
    guildId: string,
    sellerId: string,
    buyerId: string,
    units: number,
    price: number,
    nowMs = this.deps.clock.now(),
  ): ServiceResult<number> {
    if (sellerId === buyerId) return { ok: false, reason: 'kyosai_self_offer' };
    if (!Number.isInteger(units) || units < 1) return { ok: false, reason: 'invalid_units' };
    if (!Number.isInteger(price) || price < 0 || price > PLAYER_MARKET_CONSTANTS.pairDailyLimit) {
      return { ok: false, reason: 'kyosai_price_out_of_range' };
    }

    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      if (this.isGateLockedInTx(guildId, nowMs).locked) {
        return { ok: false, reason: 'kyosai_gate_locked' };
      }
      if (this.getUserUnits(guildId, sellerId) < units) {
        return { ok: false, reason: 'kyosai_insufficient_units' };
      }

      const expiresAt = nowMs + KYOSAI_CONSTANTS.offerHours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO kyosai_offers (guild_id, seller_id, buyer_id, units, price, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(guildId, sellerId, buyerId, units, price, nowMs, expiresAt);
      return { ok: true, data: Number(res.lastInsertRowid) };
    });
  }

  /** Open unit offers a member sent or received (Activity Kyosai screen). */
  listOffersFor(guildId: string, userId: string, nowMs = this.deps.clock.now()): KyosaiOfferRow[] {
    return this.deps.store
      .stmt(
        `SELECT * FROM kyosai_offers
         WHERE guild_id = ? AND status = 'open' AND expires_at > ? AND (seller_id = ? OR buyer_id = ?)
         ORDER BY id DESC LIMIT 20`,
      )
      .all(guildId, nowMs, userId, userId) as KyosaiOfferRow[];
  }

  acceptOffer(
    guildId: string,
    buyerId: string,
    offerId: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<KyosaiOfferRow> {
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const offer = this.deps.store
        .stmt('SELECT * FROM kyosai_offers WHERE id = ?')
        .get(offerId) as KyosaiOfferRow | undefined;
      if (!offer || offer.guild_id !== guildId || offer.status !== 'open') {
        return { ok: false, reason: 'kyosai_offer_not_found' };
      }
      if (offer.buyer_id !== buyerId) return { ok: false, reason: 'kyosai_not_buyer' };
      if (nowMs >= offer.expires_at) return { ok: false, reason: 'kyosai_offer_expired' };
      if (this.isGateLockedInTx(guildId, nowMs).locked) {
        return { ok: false, reason: 'kyosai_gate_locked' };
      }
      if (this.teiai.getStatus(guildId, buyerId) !== 'katagi') {
        return { ok: false, reason: 'kyosai_debtor_blocked' };
      }
      if (this.getUserUnits(guildId, offer.seller_id) < offer.units) {
        return { ok: false, reason: 'kyosai_seller_insufficient_units' };
      }

      const used24h = getSharedPairVolume24h(
        this.deps.store,
        guildId,
        offer.seller_id,
        buyerId,
        nowMs,
      );
      if (!checkPairDailyLimit(used24h, offer.price).ok) {
        return { ok: false, reason: 'kyosai_pair_daily_limit' };
      }
      if (this.deps.economy.getBalance(guildId, buyerId) < offer.price) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const fee = kyosaiTransferFee(offer.price);
      if (offer.price > 0) {
        // Gross transfer buyer -> seller (sums to 0), then separate 5% sink row `kyosai_fee`
        this.deps.economy.applyAll([
          {
            guildId,
            userId: buyerId,
            delta: -offer.price,
            reason: 'kyosai_buy',
            refType: 'kyosai_offer',
            refId: String(offerId),
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:buy` : undefined,
          },
          {
            guildId,
            userId: offer.seller_id,
            delta: offer.price,
            reason: 'kyosai_sell',
            refType: 'kyosai_offer',
            refId: String(offerId),
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:sell` : undefined,
          },
        ]);
        if (fee > 0) {
          this.deps.economy.debit({
            guildId,
            userId: offer.seller_id,
            amount: fee,
            reason: 'kyosai_fee',
            refType: 'kyosai_offer',
            refId: String(offerId),
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : undefined,
          });
          this.teiai.bankIncome(guildId, fee, { thermo: true, nowMs });
        }
      }

      this.transferUnitsInTx(guildId, offer.seller_id, buyerId, buyerId, false, offer.units);
      this.deps.store
        .stmt("UPDATE kyosai_offers SET status = 'done', fee = ?, done_at = ? WHERE id = ?")
        .run(fee, nowMs, offerId);

      const updated = this.deps.store
        .stmt('SELECT * FROM kyosai_offers WHERE id = ?')
        .get(offerId) as KyosaiOfferRow;
      return { ok: true, data: updated };
    });
  }

  cancelOffer(guildId: string, actorId: string, offerId: number): ServiceResult<void> {
    return this.deps.store.transaction(() => {
      const offer = this.deps.store
        .stmt('SELECT * FROM kyosai_offers WHERE id = ?')
        .get(offerId) as KyosaiOfferRow | undefined;
      if (!offer || offer.guild_id !== guildId || offer.status !== 'open') {
        return { ok: false, reason: 'kyosai_offer_not_found' };
      }
      if (offer.seller_id !== actorId && offer.buyer_id !== actorId) {
        return { ok: false, reason: 'kyosai_cancel_forbidden' };
      }
      this.deps.store
        .stmt("UPDATE kyosai_offers SET status = 'cancelled' WHERE id = ?")
        .run(offerId);
      return { ok: true, data: undefined };
    });
  }

  // -------------------------------------------------------------------------
  // Governance Motions (Trust Interest Premium)
  // -------------------------------------------------------------------------

  proposeMotion(
    guildId: string,
    proposerId: string,
    proposedPremiumNano: number,
    nowMs = this.deps.clock.now(),
    channelId?: string,
    messageId?: string,
  ): ServiceResult<KyosaiMotionRow> {
    if (!isPremiumNanoValid(proposedPremiumNano)) {
      return { ok: false, reason: 'kyosai_invalid_premium' };
    }
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const held = this.getUserUnits(guildId, proposerId);
      if (held < KYOSAI_CONSTANTS.motionMinUnits) {
        return { ok: false, reason: 'kyosai_motion_min_units' };
      }
      const openCount = (
        this.deps.store
          .stmt(
            "SELECT COUNT(*) AS cnt FROM kyosai_motions WHERE guild_id = ? AND proposer_id = ? AND status = 'open'",
          )
          .get(guildId, proposerId) as { cnt: number }
      ).cnt;
      if (openCount >= KYOSAI_CONSTANTS.motionMaxOpenPerUser) {
        return { ok: false, reason: 'kyosai_motion_max_open' };
      }

      const lastMotion = this.deps.store
        .stmt(
          'SELECT created_at FROM kyosai_motions WHERE guild_id = ? AND proposer_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(guildId, proposerId) as { created_at: number } | undefined;
      if (
        lastMotion &&
        nowMs - lastMotion.created_at < KYOSAI_CONSTANTS.motionCooldownHours * MS_PER_HOUR
      ) {
        return { ok: false, reason: 'kyosai_motion_cooldown' };
      }

      const closesAt = nowMs + KYOSAI_CONSTANTS.motionHours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO kyosai_motions (
            guild_id, proposer_id, proposed_premium_nano, status, channel_id, message_id, created_at, closes_at
          ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          guildId,
          proposerId,
          proposedPremiumNano,
          channelId ?? null,
          messageId ?? null,
          nowMs,
          closesAt,
        );
      const motionId = Number(res.lastInsertRowid);

      // Proposer automatically votes YES
      this.deps.store
        .stmt('INSERT INTO kyosai_votes (motion_id, user_id, vote, voted_at) VALUES (?, ?, 1, ?)')
        .run(motionId, proposerId, nowMs);

      const motion = this.deps.store
        .stmt('SELECT * FROM kyosai_motions WHERE id = ?')
        .get(motionId) as KyosaiMotionRow;
      return { ok: true, data: motion };
    });
  }

  voteMotion(
    guildId: string,
    userId: string,
    motionId: number,
    voteYes: boolean,
    nowMs = this.deps.clock.now(),
  ): ServiceResult<void> {
    return this.deps.store.transaction(() => {
      const motion = this.deps.store
        .stmt('SELECT * FROM kyosai_motions WHERE id = ?')
        .get(motionId) as KyosaiMotionRow | undefined;
      if (!motion || motion.guild_id !== guildId || motion.status !== 'open') {
        return { ok: false, reason: 'kyosai_motion_closed' };
      }
      if (nowMs >= motion.closes_at) return { ok: false, reason: 'kyosai_motion_closed' };
      if (this.getUserUnits(guildId, userId) <= 0) {
        return { ok: false, reason: 'kyosai_no_voting_units' };
      }

      this.deps.store
        .stmt(
          `INSERT INTO kyosai_votes (motion_id, user_id, vote, voted_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (motion_id, user_id) DO UPDATE SET
             vote = excluded.vote,
             voted_at = excluded.voted_at`,
        )
        .run(motionId, userId, voteYes ? 1 : 0, nowMs);
      return { ok: true, data: undefined };
    });
  }

  /**
   * Close expired motions in `(closes_at, id)` order, re-tallying votes against current unit
   * balances at close time to prevent double-voting via unit transfers.
   */
  closeExpiredMotions(guildId: string, nowMs = this.deps.clock.now()): KyosaiMotionRow[] {
    return this.deps.store.transaction(() => {
      this.ensureSupply(guildId);
      const due = this.deps.store
        .stmt(
          `SELECT * FROM kyosai_motions
           WHERE guild_id = ? AND status = 'open' AND closes_at <= ?
           ORDER BY closes_at ASC, id ASC`,
        )
        .all(guildId, nowMs) as KyosaiMotionRow[];

      const closed: KyosaiMotionRow[] = [];
      const circulating = KYOSAI_CONSTANTS.totalUnits - this.getHouseUnits(guildId);

      for (const m of due) {
        const votes = this.deps.store
          .stmt('SELECT user_id, vote FROM kyosai_votes WHERE motion_id = ?')
          .all(m.id) as { user_id: string; vote: number }[];
        let yesUnits = 0;
        let noUnits = 0;
        for (const v of votes) {
          const u = this.getUserUnits(guildId, v.user_id);
          if (v.vote === 1) yesUnits += u;
          else noUnits += u;
        }
        const passed = doesMotionPass(yesUnits, noUnits, circulating);
        const nextStatus: KyosaiMotionStatus = passed ? 'passed' : 'rejected';

        this.deps.store
          .stmt(
            `UPDATE kyosai_motions
             SET status = ?, yes_units = ?, no_units = ?, circulating_units = ?, closed_at = ?
             WHERE id = ?`,
          )
          .run(nextStatus, yesUnits, noUnits, circulating, nowMs, m.id);

        if (passed) {
          this.teiai.setTrustPremiumNano(guildId, m.proposed_premium_nano, nowMs);
        }

        closed.push(
          this.deps.store
            .stmt('SELECT * FROM kyosai_motions WHERE id = ?')
            .get(m.id) as KyosaiMotionRow,
        );
      }

      return closed;
    });
  }
}
