import {
  checkPairDailyLimit,
  endAfterBidMs,
  isTradableItem,
  isValidAuctionHours,
  listingPriceRange,
  marketplaceFee,
  minNextBid,
  MS_PER_HOUR,
  PLAYER_MARKET_CONSTANTS,
  type MarketplaceAssetKind,
  type MarketplaceMode,
  type MarketplaceStatus,
} from '@casino/domain/finance';
import type { ServiceResult, TeiaiService } from './teiai-service.ts';
import {
  financeDeps,
  getSharedPairVolume24h,
  type FinanceDeps,
  type MarketplaceAssetAdapter,
} from './types.ts';

export interface MarketplaceListingRow {
  id: number;
  guild_id: string;
  seller_id: string;
  kind: MarketplaceAssetKind;
  ref: string;
  qty: number;
  mode: MarketplaceMode;
  price: number;
  bid: number;
  bidder_id: string | null;
  buyer_id: string | null;
  sold_price: number;
  fee: number;
  status: MarketplaceStatus;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
  end_at: number;
  closed_at: number | null;
}

export interface SettledListingEntry {
  readonly listing: MarketplaceListingRow;
  readonly outcome: 'sold' | 'expired';
}

/**
 * Default in-memory asset adapter for standalone/test operation before B2-B wires SQLite
 * `inventory` / `horses` tables.
 */
export class InMemoryMarketplaceAssetAdapter implements MarketplaceAssetAdapter {
  private readonly items = new Map<string, number>();
  private readonly horses = new Map<string, string>();

  private itemKey(guildId: string, userId: string, itemId: string): string {
    return `${guildId}:${userId}:${itemId}`;
  }

  private horseKey(guildId: string, horseId: string): string {
    return `${guildId}:${horseId}`;
  }

  grantItem(guildId: string, userId: string, itemId: string, qty: number): void {
    const k = this.itemKey(guildId, userId, itemId);
    this.items.set(k, (this.items.get(k) ?? 0) + qty);
  }

  getItemQty(guildId: string, userId: string, itemId: string): number {
    return this.items.get(this.itemKey(guildId, userId, itemId)) ?? 0;
  }

  grantHorse(guildId: string, userId: string, horseId: string): void {
    this.horses.set(this.horseKey(guildId, horseId), userId);
  }

  getHorseOwner(guildId: string, horseId: string): string | null {
    return this.horses.get(this.horseKey(guildId, horseId)) ?? null;
  }

  escrowAsset(
    guildId: string,
    sellerId: string,
    kind: MarketplaceAssetKind,
    ref: string,
    qty: number,
  ): boolean {
    if (kind === 'horse') {
      const k = this.horseKey(guildId, ref);
      if (this.horses.get(k) !== sellerId) return false;
      this.horses.delete(k);
      return true;
    }
    const k = this.itemKey(guildId, sellerId, ref);
    const have = this.items.get(k) ?? 0;
    if (have < qty) return false;
    this.items.set(k, have - qty);
    return true;
  }

  deliverAsset(
    guildId: string,
    recipientId: string,
    kind: MarketplaceAssetKind,
    ref: string,
    qty: number,
  ): void {
    if (kind === 'horse') {
      this.horses.set(this.horseKey(guildId, ref), recipientId);
      return;
    }
    this.grantItem(guildId, recipientId, ref, qty);
  }
}

export class PlayerMarketService {
  private readonly deps: FinanceDeps;
  private readonly teiai: TeiaiService;
  private readonly assets: MarketplaceAssetAdapter;

  constructor(deps: FinanceDeps, teiai: TeiaiService, assets: MarketplaceAssetAdapter) {
    this.deps = financeDeps(deps);
    this.teiai = teiai;
    this.assets = assets;
  }

  getListing(listingId: number): MarketplaceListingRow | null {
    const row = this.deps.store
      .stmt('SELECT * FROM marketplace_listings WHERE id = ?')
      .get(listingId) as MarketplaceListingRow | undefined;
    return row ?? null;
  }

  /** Active listings of a guild, soonest end first (Activity player market). */
  listActive(guildId: string, limit = 50): MarketplaceListingRow[] {
    return this.deps.store
      .stmt(
        "SELECT * FROM marketplace_listings WHERE guild_id = ? AND status = 'active' ORDER BY end_at ASC, id ASC LIMIT ?",
      )
      .all(guildId, limit) as MarketplaceListingRow[];
  }

  /** Create a fixed-price or timed-auction listing and escrow the item/horse. */
  listAsset(input: {
    readonly guildId: string;
    readonly sellerId: string;
    readonly kind: MarketplaceAssetKind;
    readonly ref: string;
    readonly qty?: number;
    readonly mode: MarketplaceMode;
    readonly price: number;
    readonly hours?: number;
    readonly channelId?: string;
    readonly messageId?: string;
    readonly nowMs?: number;
  }): ServiceResult<number> {
    const nowMs = input.nowMs ?? this.deps.clock.now();
    const qty = input.kind === 'horse' ? 1 : (input.qty ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'invalid_qty' };
    if (input.kind === 'item' && !isTradableItem(input.ref)) {
      return { ok: false, reason: 'marketplace_item_not_tradable' };
    }
    const range = listingPriceRange(input.kind, input.kind === 'item' ? input.ref : undefined, qty);
    if (
      !range ||
      !Number.isInteger(input.price) ||
      input.price < range[0] ||
      input.price > range[1]
    ) {
      return { ok: false, reason: 'marketplace_price_out_of_range' };
    }
    const durationHours =
      input.mode === 'fixed' ? PLAYER_MARKET_CONSTANTS.fixedDays * 24 : (input.hours ?? 24);
    if (input.mode === 'auction' && !isValidAuctionHours(durationHours)) {
      return { ok: false, reason: 'marketplace_invalid_duration' };
    }

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(input.guildId, input.sellerId) !== 'katagi') {
        return { ok: false, reason: 'marketplace_debtor_blocked' };
      }
      const activeCount = (
        this.deps.store
          .stmt(
            "SELECT COUNT(*) AS cnt FROM marketplace_listings WHERE guild_id = ? AND seller_id = ? AND status = 'active'",
          )
          .get(input.guildId, input.sellerId) as { cnt: number }
      ).cnt;
      if (activeCount >= PLAYER_MARKET_CONSTANTS.maxActiveListings) {
        return { ok: false, reason: 'marketplace_max_active_listings' };
      }

      if (!this.assets.escrowAsset(input.guildId, input.sellerId, input.kind, input.ref, qty)) {
        return { ok: false, reason: 'marketplace_asset_not_owned' };
      }

      const endAt = nowMs + durationHours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO marketplace_listings (
            guild_id, seller_id, kind, ref, qty, mode, price, status,
            channel_id, message_id, created_at, end_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.sellerId,
          input.kind,
          input.ref,
          qty,
          input.mode,
          input.price,
          input.channelId ?? null,
          input.messageId ?? null,
          nowMs,
          endAt,
        );
      return { ok: true, data: Number(res.lastInsertRowid) };
    });
  }

  /** Instant purchase of an active fixed-price listing. */
  buyFixed(
    guildId: string,
    buyerId: string,
    listingId: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const listing = this.getListing(listingId);
      if (
        !listing ||
        listing.guild_id !== guildId ||
        listing.status !== 'active' ||
        listing.mode !== 'fixed'
      ) {
        return { ok: false, reason: 'marketplace_listing_unavailable' };
      }
      if (nowMs >= listing.end_at) return { ok: false, reason: 'marketplace_listing_expired' };
      if (listing.seller_id === buyerId) return { ok: false, reason: 'marketplace_self_buy' };
      if (this.teiai.getStatus(guildId, buyerId) !== 'katagi') {
        return { ok: false, reason: 'marketplace_debtor_blocked' };
      }

      const used24h = getSharedPairVolume24h(
        this.deps.store,
        guildId,
        listing.seller_id,
        buyerId,
        nowMs,
      );
      if (!checkPairDailyLimit(used24h, listing.price).ok) {
        return { ok: false, reason: 'marketplace_pair_daily_limit' };
      }
      if (this.deps.economy.getBalance(guildId, buyerId) < listing.price) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const fee = marketplaceFee(listing.price);
      // Gross transfer buyer -> seller (sums to 0), then separate sink row for 5% fee
      this.deps.economy.applyAll([
        {
          guildId,
          userId: buyerId,
          delta: -listing.price,
          reason: 'marketplace_buy',
          refType: 'marketplace_listing',
          refId: String(listingId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:buy` : undefined,
        },
        {
          guildId,
          userId: listing.seller_id,
          delta: listing.price,
          reason: 'marketplace_sale',
          refType: 'marketplace_listing',
          refId: String(listingId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:sale` : undefined,
        },
      ]);

      if (fee > 0) {
        this.deps.economy.debit({
          guildId,
          userId: listing.seller_id,
          amount: fee,
          reason: 'marketplace_fee',
          refType: 'marketplace_listing',
          refId: String(listingId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : undefined,
        });
        this.teiai.bankIncome(guildId, fee, { thermo: true, nowMs });
      }

      this.deps.store
        .stmt(
          `UPDATE marketplace_listings
           SET status = 'sold', buyer_id = ?, sold_price = ?, fee = ?, closed_at = ?
           WHERE id = ?`,
        )
        .run(buyerId, listing.price, fee, nowMs, listingId);

      this.assets.deliverAsset(guildId, buyerId, listing.kind, listing.ref, listing.qty);

      return { ok: true, data: listing.price };
    });
  }

  /** Place a bid on an active timed auction, with anti-snipe extension and `MarketplaceOutbid` event. */
  placeBid(
    guildId: string,
    bidderId: string,
    listingId: number,
    amount: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{ readonly endAtMs: number; readonly previousBidderId: string | null }> {
    return this.deps.store.transaction(() => {
      const listing = this.getListing(listingId);
      if (
        !listing ||
        listing.guild_id !== guildId ||
        listing.status !== 'active' ||
        listing.mode !== 'auction'
      ) {
        return { ok: false, reason: 'marketplace_listing_unavailable' };
      }
      if (nowMs >= listing.end_at) return { ok: false, reason: 'marketplace_listing_expired' };
      if (listing.seller_id === bidderId) return { ok: false, reason: 'marketplace_self_bid' };
      if (this.teiai.getStatus(guildId, bidderId) !== 'katagi') {
        return { ok: false, reason: 'marketplace_debtor_blocked' };
      }

      const minBid = minNextBid(listing.price, listing.bid);
      if (!Number.isInteger(amount) || amount < minBid) {
        return { ok: false, reason: 'marketplace_bid_too_low' };
      }

      const used24h = getSharedPairVolume24h(
        this.deps.store,
        guildId,
        listing.seller_id,
        bidderId,
        nowMs,
      );
      if (!checkPairDailyLimit(used24h, amount).ok) {
        return { ok: false, reason: 'marketplace_pair_daily_limit' };
      }

      const prevBidder = listing.bidder_id;
      const prevBid = listing.bid;
      const ownHeld = prevBidder === bidderId ? prevBid : 0;
      if (this.deps.economy.getBalance(guildId, bidderId) + ownHeld < amount) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      if (prevBidder !== null && prevBid > 0) {
        this.deps.economy.credit({
          guildId,
          userId: prevBidder,
          amount: prevBid,
          reason: 'marketplace_release',
          refType: 'marketplace_listing',
          refId: String(listingId),
        });
      }

      this.deps.economy.debit({
        guildId,
        userId: bidderId,
        amount,
        reason: 'marketplace_hold',
        refType: 'marketplace_listing',
        refId: String(listingId),
        idempotencyKey,
      });

      const nextEndAt = endAfterBidMs(listing.end_at, nowMs);
      this.deps.store
        .stmt('UPDATE marketplace_listings SET bid = ?, bidder_id = ?, end_at = ? WHERE id = ?')
        .run(amount, bidderId, nextEndAt, listingId);

      const bus = this.deps.bus;
      if (bus && prevBidder !== null && prevBidder !== bidderId) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'MarketplaceOutbid',
            guildId,
            at: nowMs,
            userId: prevBidder,
            listingId,
            newBid: amount,
          });
        });
      }

      return { ok: true, data: { endAtMs: nextEndAt, previousBidderId: prevBidder } };
    });
  }

  /** Seller cancels an active listing (allowed only when `bid === 0` for auctions). */
  cancelListing(
    guildId: string,
    sellerId: string,
    listingId: number,
    nowMs = this.deps.clock.now(),
  ): ServiceResult<void> {
    return this.deps.store.transaction(() => {
      const listing = this.getListing(listingId);
      if (!listing || listing.guild_id !== guildId || listing.status !== 'active') {
        return { ok: false, reason: 'marketplace_listing_unavailable' };
      }
      if (listing.seller_id !== sellerId) return { ok: false, reason: 'marketplace_not_seller' };
      if (listing.mode === 'auction' && listing.bid > 0) {
        return { ok: false, reason: 'marketplace_cannot_cancel_with_bids' };
      }

      this.deps.store
        .stmt("UPDATE marketplace_listings SET status = 'cancelled', closed_at = ? WHERE id = ?")
        .run(nowMs, listingId);
      this.assets.deliverAsset(guildId, sellerId, listing.kind, listing.ref, listing.qty);
      return { ok: true, data: undefined };
    });
  }

  /** Settle all expired active fixed and auction listings in `guildId`. */
  settleExpired(guildId: string, nowMs = this.deps.clock.now()): SettledListingEntry[] {
    return this.deps.store.transaction(() => {
      const expired = this.deps.store
        .stmt(
          `SELECT * FROM marketplace_listings
           WHERE guild_id = ? AND status = 'active' AND end_at <= ?
           ORDER BY end_at ASC, id ASC`,
        )
        .all(guildId, nowMs) as MarketplaceListingRow[];

      const settled: SettledListingEntry[] = [];
      for (const listing of expired) {
        if (listing.mode === 'auction' && listing.bidder_id !== null && listing.bid > 0) {
          const fee = marketplaceFee(listing.bid);
          // Escrowed bid paid out via faucet `marketplace_auction_sale`, fee debited via `marketplace_fee`
          this.deps.economy.credit({
            guildId,
            userId: listing.seller_id,
            amount: listing.bid,
            reason: 'marketplace_auction_sale',
            refType: 'marketplace_listing',
            refId: String(listing.id),
          });
          if (fee > 0) {
            this.deps.economy.debit({
              guildId,
              userId: listing.seller_id,
              amount: fee,
              reason: 'marketplace_fee',
              refType: 'marketplace_listing',
              refId: String(listing.id),
            });
            this.teiai.bankIncome(guildId, fee, { thermo: true, nowMs });
          }

          this.deps.store
            .stmt(
              `UPDATE marketplace_listings
               SET status = 'sold', buyer_id = ?, sold_price = ?, fee = ?, closed_at = ?
               WHERE id = ?`,
            )
            .run(listing.bidder_id, listing.bid, fee, nowMs, listing.id);
          this.assets.deliverAsset(
            guildId,
            listing.bidder_id,
            listing.kind,
            listing.ref,
            listing.qty,
          );
          settled.push({ listing, outcome: 'sold' });
        } else {
          this.deps.store
            .stmt("UPDATE marketplace_listings SET status = 'expired', closed_at = ? WHERE id = ?")
            .run(nowMs, listing.id);
          this.assets.deliverAsset(
            guildId,
            listing.seller_id,
            listing.kind,
            listing.ref,
            listing.qty,
          );
          settled.push({ listing, outcome: 'expired' });
        }
      }

      return settled;
    });
  }

  /**
   * Grace/bankruptcy pull-back hook (`p2p_pull_back_for`):
   * 1. Refunds & clears any active auction bids where `userId` is top bidder.
   * 2. Cancels all active listings owned by `userId` (refunding any top bidder first) and returns
   *    escrowed assets to `userId` so bankruptcy liquidation can seize them.
   */
  pullBackForUser(guildId: string, userId: string, nowMs = this.deps.clock.now()): void {
    this.deps.store.transaction(() => {
      // 1. Pull back bids placed by userId
      const userBids = this.deps.store
        .stmt(
          `SELECT * FROM marketplace_listings
           WHERE guild_id = ? AND status = 'active' AND bidder_id = ?`,
        )
        .all(guildId, userId) as MarketplaceListingRow[];

      for (const l of userBids) {
        if (l.bid > 0) {
          this.deps.economy.credit({
            guildId,
            userId,
            amount: l.bid,
            reason: 'marketplace_release',
            refType: 'marketplace_pullback',
            refId: String(l.id),
          });
        }
        this.deps.store
          .stmt('UPDATE marketplace_listings SET bid = 0, bidder_id = NULL WHERE id = ?')
          .run(l.id);
      }

      // 2. Cancel active listings owned by userId (refunding any third-party bidder)
      const userListings = this.deps.store
        .stmt(
          `SELECT * FROM marketplace_listings
           WHERE guild_id = ? AND status = 'active' AND seller_id = ?`,
        )
        .all(guildId, userId) as MarketplaceListingRow[];

      for (const l of userListings) {
        if (l.bidder_id !== null && l.bid > 0) {
          this.deps.economy.credit({
            guildId,
            userId: l.bidder_id,
            amount: l.bid,
            reason: 'marketplace_release',
            refType: 'marketplace_seller_pullback',
            refId: String(l.id),
          });
        }
        this.deps.store
          .stmt(
            `UPDATE marketplace_listings
             SET status = 'cancelled', bid = 0, bidder_id = NULL, closed_at = ?
             WHERE id = ?`,
          )
          .run(nowMs, l.id);
        this.assets.deliverAsset(guildId, userId, l.kind, l.ref, l.qty);
      }
    });
  }
}
