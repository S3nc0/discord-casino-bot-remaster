import { describe, expect, it, vi } from 'vitest';
import {
  createSeededRng,
  manualClock,
  TEIAI_SELLER_ID,
  type DomainEvent,
  type Rng,
} from '@casino/shared';
import {
  minNextBid,
  MS_PER_DAY,
  MS_PER_HOUR,
  PLAYER_MARKET_CONSTANTS,
} from '@casino/domain/finance';
import { RELIC_VALUE } from '@casino/domain/work';
import { IdentityRepo } from '../db/identity.ts';
import { EconomyService } from '../economy/economy-service.ts';
import { EventBus } from '../runtime/bus.ts';
import { GUILD, OTHER_GUILD, memoryStore } from '../runtime/test-kit.ts';
import {
  InMemoryMarketplaceAssetAdapter,
  createFinanceServices,
  runPlayerMarketSettleTick,
  type MarketplaceListingRow,
} from './index.ts';

const U1 = '200000000000000001';
const U2 = '200000000000000002';
/** 2025-01-06T00:00:00Z, a UTC day start. */
const DAY0 = 1_736_121_600_000;

/** A roll that always lands on the first (fossil) or last (Dragon's tear) relic of the table. */
const rollAt = (x: number): Rng => ({ float: () => x, int: (min) => min });

function makeEnv(options: { perDay?: number; rng?: Rng; startMs?: number } = {}) {
  const store = memoryStore();
  const clock = manualClock(options.startMs ?? DAY0 + 3 * MS_PER_HOUR);
  const bus = new EventBus();
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const assets = new InMemoryMarketplaceAssetAdapter();
  const build = (rng: Rng) =>
    createFinanceServices(
      { store, economy, identity, clock, rng, bus, utcOffsetHours: 9 },
      { marketplaceAssets: assets, relicAuctionPerDay: options.perDay ?? 1 },
    );
  const services = build(options.rng ?? createSeededRng(7));
  const events: DomainEvent[] = [];
  bus.onAnyDomain((ev) => events.push(ev));
  const seed = (guildId: string, userId: string, balance: number) => {
    economy.ensureMember(guildId, userId, { initialGrant: false });
    if (balance > 0) economy.credit({ guildId, userId, amount: balance, reason: 'admin_grant' });
  };
  const teiaiRows = (guildId = GUILD) =>
    store
      .stmt('SELECT * FROM marketplace_listings WHERE guild_id = ? AND seller_id = ? ORDER BY id')
      .all(guildId, TEIAI_SELLER_ID) as MarketplaceListingRow[];
  const ledgerFor = (listingId: number) =>
    store
      .stmt(
        "SELECT reason, delta, user_id FROM ledger WHERE ref_type LIKE 'marketplace%' AND ref_id = ? ORDER BY id",
      )
      .all(String(listingId)) as { reason: string; delta: number; user_id: string }[];
  return {
    store,
    clock,
    bus,
    economy,
    assets,
    services,
    build,
    events,
    seed,
    teiaiRows,
    ledgerFor,
  };
}

describe('Teiai daily relic auction', () => {
  it('is off unless the per-day count is set', () => {
    const env = makeEnv({ perDay: 0 });
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toEqual([]);
    expect(env.teiaiRows()).toEqual([]);
  });

  it('lists one 24 h auction at the relic reference value, seller Teiai, nothing escrowed', () => {
    const env = makeEnv({ rng: rollAt(0) });
    const now = env.clock.now();
    const ids = env.services.playerMarket.teiaiDaily(GUILD);
    expect(ids).toHaveLength(1);
    const row = env.services.playerMarket.getListing(ids[0]!)!;
    expect(row).toMatchObject({
      seller_id: TEIAI_SELLER_ID,
      kind: 'item',
      ref: 'relic_fossil',
      qty: 1,
      mode: 'auction',
      price: RELIC_VALUE.relic_fossil,
      bid: 0,
      status: 'active',
      created_at: now,
      end_at: now + 24 * MS_PER_HOUR,
    });
    expect(env.ledgerFor(row.id)).toEqual([]);
  });

  it('draws by dig odds: the last slice is the Dragon tear at 100,000', () => {
    const env = makeEnv({ rng: rollAt(0.999999) });
    const [id] = env.services.playerMarket.teiaiDaily(GUILD);
    const row = env.services.playerMarket.getListing(id!)!;
    expect(row.ref).toBe('relic_tear');
    expect(row.price).toBe(100_000);
  });

  it('lists once per UTC day, even across ticks and a restart', () => {
    const env = makeEnv();
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toHaveLength(1);
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toEqual([]);
    env.clock.advance(5 * MS_PER_HOUR);
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toEqual([]);
    // A restart builds new services on the same database.
    const restarted = env.build(createSeededRng(99));
    expect(restarted.playerMarket.teiaiDaily(GUILD)).toEqual([]);
    expect(runPlayerMarketSettleTick(restarted).relicListed[GUILD]).toEqual([]);
    expect(env.teiaiRows()).toHaveLength(1);
    // Another guild and the next UTC day each get their own.
    expect(env.services.playerMarket.teiaiDaily(OTHER_GUILD)).toHaveLength(1);
    env.clock.advance(MS_PER_DAY);
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toHaveLength(1);
    expect(env.teiaiRows()).toHaveLength(2);
  });

  it('counts the day from UTC midnight, not from 24 h ago', () => {
    const env = makeEnv({ startMs: DAY0 + 23 * MS_PER_HOUR });
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toHaveLength(1);
    env.clock.advance(2 * MS_PER_HOUR); // 01:00 UTC the next day
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toHaveLength(1);
  });

  it('is driven by the settle tick and announces after commit', () => {
    const env = makeEnv();
    env.seed(GUILD, U1, 1_000); // makes the guild known
    const report = runPlayerMarketSettleTick(env.services);
    const [id] = report.relicListed[GUILD]!;
    const listed = env.events.filter((e) => e.type === 'TeiaiRelicListed');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      guildId: GUILD,
      listingId: id,
      startPrice: env.services.playerMarket.getListing(id!)!.price,
    });
    runPlayerMarketSettleTick(env.services);
    expect(env.events.filter((e) => e.type === 'TeiaiRelicListed')).toHaveLength(1);
  });

  it('does not list in a guild the bot has denied', () => {
    const env = makeEnv();
    env.store
      .stmt('INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(GUILD, 'denied', DAY0, DAY0);
    expect(env.services.playerMarket.teiaiDaily(GUILD)).toEqual([]);
  });

  it('skips the 100,000 / 24 h pair limit for bids on a Teiai relic', () => {
    const env = makeEnv({ rng: rollAt(0.999999) });
    env.seed(GUILD, U1, 300_000);
    const [id] = env.services.playerMarket.teiaiDaily(GUILD);
    const market = env.services.playerMarket;
    const limit = PLAYER_MARKET_CONSTANTS.pairDailyLimit;
    const bid = limit + 20_000;
    expect(bid).toBeGreaterThanOrEqual(minNextBid(100_000, 0));
    expect(market.placeBid(GUILD, U1, id!, bid).ok).toBe(true);
    expect(env.economy.getBalance(GUILD, U1)).toBe(300_000 - bid);
  });

  it('sells to the top bidder: whole price to bank income, no seller credit, no fee', () => {
    const env = makeEnv({ rng: rollAt(0) });
    env.seed(GUILD, U1, 10_000);
    env.seed(GUILD, U2, 10_000);
    const market = env.services.playerMarket;
    const [id] = market.teiaiDaily(GUILD);
    const income = vi.spyOn(env.services.teiai, 'bankIncome');
    expect(market.placeBid(GUILD, U1, id!, 1_500).ok).toBe(true);
    const second = minNextBid(1_500, 1_500);
    expect(market.placeBid(GUILD, U2, id!, second).ok).toBe(true);
    // The outbid player got the hold back; the leader's hold stays.
    expect(env.economy.getBalance(GUILD, U1)).toBe(10_000);
    expect(env.economy.getBalance(GUILD, U2)).toBe(10_000 - second);

    const row = market.getListing(id!)!;
    const settled = market.settleExpired(GUILD, row.end_at);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.outcome).toBe('sold');
    expect(income).toHaveBeenCalledWith(GUILD, second, expect.objectContaining({ thermo: true }));
    expect(market.getListing(id!)).toMatchObject({
      status: 'sold',
      buyer_id: U2,
      sold_price: second,
      fee: 0,
    });
    expect(env.assets.getItemQty(GUILD, U2, 'relic_fossil')).toBe(1);
    expect(env.assets.getItemQty(GUILD, U1, 'relic_fossil')).toBe(0);
    // Nothing is paid out: the only rows are U1's hold and release, and U2's hold (a sink).
    expect(env.ledgerFor(id!).map((r) => r.reason)).toEqual([
      'marketplace_hold',
      'marketplace_release',
      'marketplace_hold',
    ]);
    expect(env.economy.getBalance(GUILD, U2)).toBe(10_000 - second);
    // Settling again does nothing.
    expect(market.settleExpired(GUILD, row.end_at + MS_PER_HOUR)).toEqual([]);
  });

  it('lets an unsold relic disappear: nobody receives it, no money moves', () => {
    const env = makeEnv({ rng: rollAt(0) });
    env.seed(GUILD, U1, 5_000);
    const market = env.services.playerMarket;
    const [id] = market.teiaiDaily(GUILD);
    const row = market.getListing(id!)!;
    const settled = market.settleExpired(GUILD, row.end_at);
    expect(settled.map((s) => s.outcome)).toEqual(['expired']);
    expect(market.getListing(id!)!.status).toBe('expired');
    expect(env.assets.getItemQty(GUILD, U1, 'relic_fossil')).toBe(0);
    expect(env.assets.getItemQty(GUILD, TEIAI_SELLER_ID, 'relic_fossil')).toBe(0);
    expect(env.ledgerFor(id!)).toEqual([]);
    expect(env.economy.getBalance(GUILD, U1)).toBe(5_000);
  });

  it('keeps the anti-snipe extension and the 5% minimum raise on a Teiai relic', () => {
    const env = makeEnv({ rng: rollAt(0) });
    env.seed(GUILD, U1, 10_000);
    const market = env.services.playerMarket;
    const [id] = market.teiaiDaily(GUILD);
    const end = market.getListing(id!)!.end_at;
    expect(market.placeBid(GUILD, U1, id!, 1_499).ok).toBe(false);
    const late = end - 60_000;
    const res = market.placeBid(GUILD, U1, id!, 1_500, late);
    expect(res.ok).toBe(true);
    expect(market.getListing(id!)!.end_at).toBeGreaterThan(end);
  });

  it('cannot be taken down by a player, and a top bidder who goes bankrupt gets the hold back', () => {
    const env = makeEnv({ rng: rollAt(0) });
    env.seed(GUILD, U1, 10_000);
    const market = env.services.playerMarket;
    const [id] = market.teiaiDaily(GUILD);
    expect(market.cancelListing(GUILD, U1, id!)).toEqual({
      ok: false,
      reason: 'marketplace_not_seller',
    });
    expect(market.placeBid(GUILD, U1, id!, 2_000).ok).toBe(true);
    market.pullBackForUser(GUILD, U1);
    expect(env.economy.getBalance(GUILD, U1)).toBe(10_000);
    const row = market.getListing(id!)!;
    expect(row).toMatchObject({ status: 'active', bid: 0, bidder_id: null });
  });
});
