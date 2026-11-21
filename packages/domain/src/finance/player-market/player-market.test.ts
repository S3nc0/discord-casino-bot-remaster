import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkPairDailyLimit,
  endAfterBidMs,
  isTradableItem,
  isValidAuctionHours,
  listingPriceRange,
  marketplaceFee,
  minNextBid,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const BASE_MS = 1_736_121_600_000;

interface PlayerMarketFixture {
  readonly domain_math: {
    readonly tradable_daily_double: boolean;
    readonly tradable_horse_voucher: boolean;
    readonly fee_of_1000: number;
    readonly fee_of_1005: number;
    readonly price_range_item: readonly [number, number];
    readonly price_range_horse: readonly [number, number];
    readonly min_next_bid_first: number;
    readonly min_next_bid_after_1000: number;
    readonly end_after_bid_snipe: number;
    readonly end_after_bid_normal: number;
  };
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/player-market/listings.json'), 'utf8'),
) as PlayerMarketFixture;

describe('player-market domain parity', () => {
  it('matches legacy domain_math fixture 100%', () => {
    expect(isTradableItem('daily_double')).toBe(fixture.domain_math.tradable_daily_double);
    expect(isTradableItem('horse_voucher')).toBe(fixture.domain_math.tradable_horse_voucher);
    expect(isTradableItem('vip_badge')).toBe(false); // title kind is non-tradable
    expect(isTradableItem('unknown_item')).toBe(false);

    expect(marketplaceFee(1_000)).toBe(fixture.domain_math.fee_of_1000);
    expect(marketplaceFee(1_005)).toBe(fixture.domain_math.fee_of_1005);

    expect(listingPriceRange('item', 'daily_double', 1)).toEqual(
      fixture.domain_math.price_range_item,
    );
    expect(listingPriceRange('horse')).toEqual(fixture.domain_math.price_range_horse);

    expect(minNextBid(1_000, 0)).toBe(fixture.domain_math.min_next_bid_first);
    expect(minNextBid(1_000, 1_000)).toBe(fixture.domain_math.min_next_bid_after_1000);

    expect(endAfterBidMs(BASE_MS + 60_000, BASE_MS) / 1_000).toBe(
      fixture.domain_math.end_after_bid_snipe,
    );
    expect(endAfterBidMs(BASE_MS + 3_600_000, BASE_MS) / 1_000).toBe(
      fixture.domain_math.end_after_bid_normal,
    );

    expect(isValidAuctionHours(6)).toBe(true);
    expect(isValidAuctionHours(12)).toBe(false);
    expect(checkPairDailyLimit(90_000, 10_000).ok).toBe(true);
    expect(checkPairDailyLimit(90_000, 10_001).ok).toBe(false);
  });
});
