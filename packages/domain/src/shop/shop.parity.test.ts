import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PyRandom } from '../progression/py-random.ts';
import { itemById, validatePurchase } from './catalog.ts';
import { nextRefillAt, stockAvailable, stockNow } from './stock.ts';
import { auctionPrice, auctionRate, marketPrice, planMarketDay } from './teiai-market.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/shop/purchases.json', import.meta.url),
    'utf8',
  ),
);
const H = 3_600_000;

describe('shop (legacy parity)', () => {
  it('seized auction decays 10 points a day down to 70 %', () => {
    for (const [hours, rate] of Object.entries(fx.auction_rate_by_hour)) {
      expect(auctionRate(0, Number(hours) * H)).toBe(rate);
    }
    expect(auctionPrice(3000, 0, 12 * H)).toBe(fx.db_flow.auction_price_12h);
  });

  it('refills a limited stock by the hour', () => {
    const rule = { max: 5, perHour: 0.5 };
    expect(stockNow(rule, 2, 0, H)).toBe(fx.stock_math.after_1h_from_2);
    expect(stockNow(rule, 2, 0, 10 * H)).toBe(fx.stock_math.after_10h_capped);
    expect(nextRefillAt(rule, 2, 1_000_000)).toBe(fx.stock_math.next_refill_from_2 * 1000);
    expect(nextRefillAt(rule, 5, 0)).toBeNull();
    expect(stockAvailable(2.5)).toBe(2);
  });

  it('Dutch price falls linearly', () => {
    const l = { startPrice: 10_000, endPrice: 4000, listedAt: 0, expiresAt: 100 };
    expect(marketPrice(l, 0)).toBe(fx.teiai_market.price_decay.start);
    expect(marketPrice(l, 50)).toBe(fx.teiai_market.price_decay.mid);
    expect(marketPrice(l, 100)).toBe(fx.teiai_market.price_decay.end);
  });

  it('plans three listings a day inside the live price ranges', () => {
    const day = fx.teiai_market.day_start * 1000;
    const plan = planMarketDay(day, new PyRandom(fx.seeds ?? fx.seed));
    expect(plan).toHaveLength(fx.teiai_market.planned_count);
    for (const l of plan) {
      expect(l.listedAt).toBeGreaterThanOrEqual(day);
      expect(l.listedAt).toBeLessThan(day + 86_400_000);
      const base = (itemById(l.itemId) as { price: number }).price;
      if (l.mode === 'auction') {
        expect(l.startPrice / base).toBeGreaterThanOrEqual(0.5);
        expect(l.startPrice / base).toBeLessThanOrEqual(1.2);
        expect(l.endPrice).toBe(Math.round(l.startPrice * 0.6));
      } else {
        expect(l.startPrice).toBe(l.endPrice);
        expect(l.expiresAt - l.listedAt).toBe(6 * H);
      }
    }
  });

  it('purchase rules: unique items, debt, balance', () => {
    const daily = itemById('daily_double');
    expect(validatePurchase({ item: daily, owned: 2, debt: 0, balance: 100_000 })).toBeNull();
    expect(validatePurchase({ item: daily, owned: 0, debt: 1, balance: 100_000 })).toBe(
      'debt_blocks',
    );
    expect(
      validatePurchase({ item: itemById('title_rookie'), owned: 1, debt: 0, balance: 1e9 }),
    ).toBe('already_owned');
    expect(validatePurchase({ item: daily, owned: 0, debt: 0, balance: 2999 })).toBe(
      'insufficient_balance',
    );
    expect(
      validatePurchase({ item: itemById('title_weekly_king'), owned: 0, debt: 0, balance: 1e9 }),
    ).toBe('not_for_sale');
  });
});
