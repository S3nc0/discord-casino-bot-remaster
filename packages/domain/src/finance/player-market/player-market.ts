import { BPS_SCALE, MS_PER_SECOND } from '../math.ts';
import {
  MARKET_ITEM_CATALOG,
  PLAYER_MARKET_CONSTANTS,
  relicReferenceValue,
  TRADABLE_ITEM_KINDS,
  type MarketplaceAssetKind,
} from './constants.ts';

/**
 * True if `itemId` may be traded on the Player Market.
 * - Relics: tradable iff known in `RELIC_BASE_VALUES` (★0..★3).
 * - Shop items: tradable iff `price > 0`, `not limited`, and `kind` in `TRADABLE_ITEM_KINDS`.
 */
export function isTradableItem(itemId: string): boolean {
  const item = MARKET_ITEM_CATALOG.get(itemId);
  if (!item) return false;
  if (item.kind === 'relic') return relicReferenceValue(itemId) !== null;
  return item.price > 0 && !item.limited && TRADABLE_ITEM_KINDS.has(item.kind);
}

/**
 * 5% player market (and kyosai unit transfer) fee: `floor(price * 500 / 10_000)`.
 * Matches legacy `int(price * 0.05)` (`fee_of(1005) === 50`).
 */
export function marketplaceFee(price: number): number {
  if (price <= 0) return 0;
  return Math.floor((price * PLAYER_MARKET_CONSTANTS.feeRateBps) / BPS_SCALE);
}

/**
 * Valid `[low, high]` listing price bounds (anti-RMT / transfer-bypass guard):
 * - Horse: `[3_000, 300_000]`
 * - Item: `base = (relicValue ?? item.price) * max(1, qty)`,
 *   `high = min(100_000, floor(base * 5.0))`,
 *   `low = min(max(100, ceil(base * 0.10)), high)`.
 */
export function listingPriceRange(
  assetKind: MarketplaceAssetKind,
  itemId?: string,
  qty = 1,
): readonly [low: number, high: number] | null {
  if (assetKind === 'horse') {
    return [PLAYER_MARKET_CONSTANTS.horsePriceMin, PLAYER_MARKET_CONSTANTS.horsePriceMax];
  }
  if (!itemId || !isTradableItem(itemId)) return null;
  const relicVal = relicReferenceValue(itemId);
  const unitPrice = relicVal ?? MARKET_ITEM_CATALOG.get(itemId)?.price ?? 0;
  if (unitPrice <= 0) return null;
  const base = unitPrice * Math.max(1, Math.floor(qty));
  const high = Math.min(
    PLAYER_MARKET_CONSTANTS.pairDailyLimit,
    Math.floor((base * PLAYER_MARKET_CONSTANTS.itemPriceRangeMaxBps) / BPS_SCALE),
  );
  const rawLow = Math.ceil((base * PLAYER_MARKET_CONSTANTS.itemPriceRangeMinBps) / BPS_SCALE);
  const low = Math.min(Math.max(PLAYER_MARKET_CONSTANTS.minPrice, rawLow), high);
  return [low, high];
}

/**
 * Minimum next bid for an auction (shared by Player Market and Kyosai unit auctions):
 * - If `currentBid <= 0`: `startPrice`.
 * - Else: `currentBid + max(100, ceil(currentBid * 0.05))`.
 */
export function minNextBid(startPrice: number, currentBid: number): number {
  if (currentBid <= 0) return startPrice;
  const step = Math.max(
    PLAYER_MARKET_CONSTANTS.minIncrement,
    Math.ceil((currentBid * PLAYER_MARKET_CONSTANTS.minIncrementRateBps) / BPS_SCALE),
  );
  return currentBid + step;
}

/**
 * Anti-snipe auction end-time adjustment (ms UTC):
 * If bid arrives with `< 300s` (5 minutes) remaining, extends `endAtMs` to `max(endAtMs, nowMs + 300_000)`.
 */
export function endAfterBidMs(endAtMs: number, nowMs: number): number {
  const snipeMs = PLAYER_MARKET_CONSTANTS.snipeSeconds * MS_PER_SECOND;
  if (endAtMs - nowMs < snipeMs) {
    return Math.max(endAtMs, nowMs + snipeMs);
  }
  return endAtMs;
}

/** Check whether an auction duration (in hours) is one of the allowed options `[1, 6, 24, 72]`. */
export function isValidAuctionHours(hours: number): boolean {
  return PLAYER_MARKET_CONSTANTS.auctionHours.includes(hours);
}

/** Check rolling 24h unordered pair volume cap (`used + amount <= 100_000`). */
export function checkPairDailyLimit(usedIn24h: number, amount: number): {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
} {
  const limit = PLAYER_MARKET_CONSTANTS.pairDailyLimit;
  const remaining = Math.max(0, limit - usedIn24h);
  return {
    ok: usedIn24h + amount <= limit,
    limit,
    remaining,
  };
}
