import type { Rng } from '@casino/shared';
import { uniform } from '../progression/py-random.ts';
import { MS_DAY, MS_HOUR, roundHalfEven } from '../progression/time.ts';
import { RELIC_DROPS } from '../work/labor.ts';
import { RELIC_VALUE } from '../work/relics.ts';
import { CATALOG, isAuctionListable, isMarketListable, isUnique, type Item } from './catalog.ts';

// catalogs/teiai.yaml (the live numbers; docs/spec/shop.md quotes older ones)
export const AUCTION_START = 0.9;
export const AUCTION_STEP = 0.1;
export const AUCTION_FLOOR = 0.7;
export const MARKET_SLOTS_PER_DAY = 3;
export const MARKET_AUCTION_PROB = 0.5;
export const MARKET_AUCTION_RATE: readonly [number, number] = [0.5, 1.2];
export const MARKET_AUCTION_HOURS: readonly [number, number] = [2, 6];
export const MARKET_AUCTION_END = 0.6;
export const MARKET_FIXED_RATE: readonly [number, number] = [0.7, 1.5];
export const MARKET_FIXED_HOURS = 6;
export const MARKET_FIXED_QTY: readonly [number, number] = [2, 4];
export const MARKET_BLACK_PROB = 0.2;
export const MARKET_BLACK_WORSE = 0.07;
export const MARKET_BLACK_BETTER = 0.03;
export const SEIZE_RATE = 0.5;

/** Seized goods start at 90 % of the price and lose 10 points per full day, down to 70 %. */
export function auctionRate(listedAtMs: number, nowMs: number): number {
  const days = Math.floor(Math.max(0, nowMs - listedAtMs) / MS_DAY);
  return Math.max(AUCTION_FLOOR, Math.round((AUCTION_START - AUCTION_STEP * days) * 100) / 100);
}

export function auctionPrice(basePrice: number, listedAtMs: number, nowMs: number): number {
  return Math.max(1, roundHalfEven(basePrice * auctionRate(listedAtMs, nowMs)));
}

export interface MarketListing {
  itemId: string;
  mode: 'auction' | 'fixed';
  black: boolean;
  qty: number;
  startPrice: number;
  endPrice: number;
  listedAt: number;
  expiresAt: number;
}

/** Price of a listing at `nowMs`: Dutch auctions fall linearly, fixed listings stay put. */
export function marketPrice(
  l: Pick<MarketListing, 'startPrice' | 'endPrice' | 'listedAt' | 'expiresAt'>,
  nowMs: number,
): number {
  if (l.expiresAt <= l.listedAt) return Math.max(1, l.startPrice);
  const t = Math.min(1, Math.max(0, (nowMs - l.listedAt) / (l.expiresAt - l.listedAt)));
  return Math.max(1, roundHalfEven(l.startPrice + (l.endPrice - l.startPrice) * t));
}

/** The day's market listings, planned once per UTC day (`dayStartMs` is that day's 00:00 UTC). */
export function planMarketDay(dayStartMs: number, rng: Rng): MarketListing[] {
  const pool = CATALOG.filter(isMarketListable);
  const out: MarketListing[] = [];
  for (let i = 0; i < MARKET_SLOTS_PER_DAY; i++) {
    const listedAt = dayStartMs + uniform(rng, 0, 86_400) * 1000;
    const item = pool[rng.int(0, pool.length)] as Item;
    const auction = rng.float() < MARKET_AUCTION_PROB;
    let listing: MarketListing;
    if (auction) {
      const startPrice = roundHalfEven(
        item.price * uniform(rng, MARKET_AUCTION_RATE[0], MARKET_AUCTION_RATE[1]),
      );
      const hours = uniform(rng, MARKET_AUCTION_HOURS[0], MARKET_AUCTION_HOURS[1]);
      listing = {
        itemId: item.id,
        mode: 'auction',
        black: false,
        qty: 1,
        startPrice,
        endPrice: roundHalfEven(startPrice * MARKET_AUCTION_END),
        listedAt,
        expiresAt: listedAt + hours * MS_HOUR,
      };
    } else {
      const price = roundHalfEven(
        item.price * uniform(rng, MARKET_FIXED_RATE[0], MARKET_FIXED_RATE[1]),
      );
      listing = {
        itemId: item.id,
        mode: 'fixed',
        black: false,
        qty: isUnique(item) ? 1 : rng.int(MARKET_FIXED_QTY[0], MARKET_FIXED_QTY[1] + 1),
        startPrice: price,
        endPrice: price,
        listedAt,
        expiresAt: listedAt + MARKET_FIXED_HOURS * MS_HOUR,
      };
    }
    listing.black = rng.float() < MARKET_BLACK_PROB;
    out.push(listing);
  }
  return out.sort((a, b) => a.listedAt - b.listedAt);
}

export interface Reveal {
  itemId: string;
  outcome: 'same' | 'worse' | 'better';
}

/**
 * Open a black-market lot: 7 % cheaper item, 3 % dearer item (same kind preferred), otherwise
 * the shown item. A unique item the buyer already owns falls back to the shown one.
 */
export function revealBlack(shown: Item, rng: Rng, ownsUnique: (id: string) => boolean): Reveal {
  const u = rng.float();
  const pool = CATALOG.filter(isAuctionListable);
  const pickFrom = (cmp: (i: Item) => boolean): Item | undefined => {
    const sameKind = pool.filter((i) => i.kind === shown.kind && cmp(i));
    const any = pool.filter(cmp);
    const list = sameKind.length > 0 ? sameKind : any;
    return list.length > 0 ? (list[rng.int(0, list.length)] as Item) : undefined;
  };
  let chosen: Item | undefined;
  let outcome: Reveal['outcome'] = 'same';
  if (u < MARKET_BLACK_WORSE) {
    chosen = pickFrom((i) => i.price < shown.price);
    outcome = 'worse';
  } else if (u < MARKET_BLACK_WORSE + MARKET_BLACK_BETTER) {
    chosen = pickFrom((i) => i.price > shown.price);
    outcome = 'better';
  }
  if (!chosen) return { itemId: shown.id, outcome: 'same' };
  if (isUnique(chosen) && ownsUnique(chosen.id)) return { itemId: shown.id, outcome: 'same' };
  return { itemId: chosen.id, outcome };
}

// ---- Teiai's daily relic auction (catalogs/teiai.yaml: relic_auction_per_day / relic_auction_hours)

/** Relics Teiai puts up per guild per UTC day (0 turns it off). */
export const RELIC_AUCTION_PER_DAY = 1;
/** Length of that auction. */
export const RELIC_AUCTION_HOURS = 24;

/** The relic Teiai auctions and its starting price (the reference value, no cap on bids). */
export interface RelicAuctionPick {
  readonly itemId: string;
  readonly startPrice: number;
}

/**
 * Pick the day's relic by dig odds (the underground-work drop table), unstarred only: mostly
 * fossils, the Dragon's tear is rare. The start price is the relic's reference value.
 */
export function pickRelic(rng: Rng): RelicAuctionPick {
  const total = RELIC_DROPS.reduce((sum, d) => sum + d.prob, 0);
  let x = rng.float() * total;
  for (const drop of RELIC_DROPS) {
    x -= drop.prob;
    if (x < 0) return { itemId: drop.item, startPrice: RELIC_VALUE[drop.item] };
  }
  const last = RELIC_DROPS[RELIC_DROPS.length - 1] as (typeof RELIC_DROPS)[number];
  return { itemId: last.item, startPrice: RELIC_VALUE[last.item] };
}
