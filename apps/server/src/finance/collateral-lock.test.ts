import { afterEach, describe, expect, it } from 'vitest';
import { microsToPrice } from '@casino/domain/finance';
import { GUILD, USER, createTestServer, type TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.economy.credit({ guildId: GUILD, userId: USER, amount: 200_000, reason: 'admin_grant' });
  return server.finance.stocks;
}

/** A 5x NUMA long (margin 10,000) whose price then falls by `drop`. */
function openAndDrop(stocks: ReturnType<typeof setup>, drop: number): void {
  expect(stocks.openMargin(GUILD, USER, 'long', 'numa', 10_000, 5).ok).toBe(true);
  const price = stocks.getPricesMicros().numa;
  stocks.setPrice('numa', Math.round(price * (1 - drop)));
}

describe('selling collateral keeps the account at 130% (open ratio), not just above the loss-cut', () => {
  it('spot: refuses a sale that leaves 100%–130%, allows one that leaves 130% or more', () => {
    const stocks = setup();
    expect(stocks.buySpot(GUILD, USER, 'cs', 20_000).ok).toBe(true);
    openAndDrop(stocks, 0.16);
    const status = stocks.getPortfolioMarginStatus(GUILD, USER);
    const held = stocks.getSpotHoldings(GUILD, USER)[0]!;
    const perUnit = (microsToPrice(stocks.getPricesMicros().cs) * 0.8) / 1000;
    const unitsFor = (ratio: number): number =>
      Math.floor((status.equity - ratio * status.required) / perUnit);
    expect(unitsFor(1.2)).toBeLessThanOrEqual(held.units_milli);

    const refused = stocks.sellSpot(GUILD, USER, 'cs', unitsFor(1.2));
    expect(refused).toMatchObject({ ok: false, reason: 'market_collateral_locked' });
    expect(stocks.getSpotHoldings(GUILD, USER)[0]!.units_milli).toBe(held.units_milli);

    const allowed = stocks.sellSpot(GUILD, USER, 'cs', unitsFor(1.4));
    expect(allowed.ok).toBe(true);
    expect(stocks.getPortfolioMarginStatus(GUILD, USER).ratio!).toBeGreaterThanOrEqual(1.3);
  });

  it('bond: refuses an early sale that leaves 100%–130%, allows one that leaves 130% or more', () => {
    const stocks = setup();
    const bond = stocks.buyBond(GUILD, USER, 'normal', 10_000);
    expect(bond.ok).toBe(true);
    const id = bond.ok ? bond.data.id : -1;
    openAndDrop(stocks, 0.1575);
    const after = stocks.getPortfolioMarginStatus(GUILD, USER);
    expect((after.equity - 9_500) / after.required).toBeGreaterThan(1);
    expect((after.equity - 9_500) / after.required).toBeLessThan(1.3);
    expect(stocks.sellBondEarly(GUILD, USER, id)).toMatchObject({
      ok: false,
      reason: 'market_collateral_locked',
    });
  });

  it('bond: allows the early sale when 130% or more is left', () => {
    const stocks = setup();
    const bond = stocks.buyBond(GUILD, USER, 'normal', 10_000);
    const id = bond.ok ? bond.data.id : -1;
    openAndDrop(stocks, 0.1);
    const after = stocks.getPortfolioMarginStatus(GUILD, USER);
    expect((after.equity - 9_500) / after.required).toBeGreaterThanOrEqual(1.3);
    expect(stocks.sellBondEarly(GUILD, USER, id).ok).toBe(true);
  });
});
