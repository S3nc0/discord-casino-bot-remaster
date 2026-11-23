import { afterEach, describe, expect, it } from 'vitest';
import { FINANCE_ROUTES, PRICE_SCALE, type TokenResponse } from '@casino/shared';
import { IdempotencyStore } from '../../games/casino/idempotency.ts';
import { Inventory } from '../../games/shop/inventory.ts';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';

const DAY = 24 * 60 * 60 * 1000;
let server: TestServer;
afterEach(async () => {
  await server.close();
});

async function login(id: string) {
  server.discord.state.user = { id, username: `u${id.slice(-3)}`, global_name: null, avatar: null };
  server.discord.state.guilds = [{ id: GUILD, name: 'G' }];
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [USER, OTHER_USER],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  const { sessionToken } = res.json<TokenResponse>();
  return (url: string, payload: object) =>
    server.app.inject({
      method: 'POST',
      url,
      headers: { ...server.signed(), authorization: `Bearer ${sessionToken}` },
      payload,
    });
}

function grant(userId: string, amount: number): void {
  server.economy.ensureMember(GUILD, userId);
  server.economy.credit({ guildId: GUILD, userId, amount, reason: 'admin_grant' });
}

const data = <T>(res: { ok: true; data: T } | { ok: false; reason: string }): T => {
  if (!res.ok) throw new Error(`fixture failed: ${res.reason}`);
  return res.data;
};

/** Every row of every table but the idempotency store and the login bookkeeping. */
function snapshot(): string {
  const skip = new Set(['idempotency_keys', 'users', 'guild_members', 'guilds']);
  const tables = (
    server.store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).filter((t) => !skip.has(t.name));
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      (server.store.db.prepare(`SELECT * FROM "${name}"`).all() as unknown[])
        .map((r) => JSON.stringify(r))
        .sort(),
    ]),
  );
}

type Body = Record<string, unknown>;
/** Writes whose key reaches the ledger: setup returns the body (without the key) to send twice. */
const MONEY: Record<string, () => Body> = {
  [FINANCE_ROUTES.bankRepay]: () => {
    server.finance.teiai.adminSetDebt(GUILD, USER, 5_000);
    return { amount: 1_000 };
  },
  [FINANCE_ROUTES.loanAccept]: () => ({
    loanId: data(
      server.finance.loans.offerLoan({
        guildId: GUILD,
        lenderId: OTHER_USER,
        borrowerId: USER,
        principal: 1_000,
        rateBps: 100,
        termDays: 5,
      }),
    ),
  }),
  [FINANCE_ROUTES.loanLend]: () => ({
    loanId: data(
      server.finance.loans.requestLoan({
        guildId: GUILD,
        borrowerId: OTHER_USER,
        principal: 1_000,
        rateBps: 100,
        termDays: 5,
      }),
    ),
  }),
  [FINANCE_ROUTES.loanRepay]: () => {
    const loanId = data(
      server.finance.loans.offerLoan({
        guildId: GUILD,
        lenderId: OTHER_USER,
        borrowerId: USER,
        principal: 10_000,
        rateBps: 100,
        termDays: 5,
      }),
    );
    data(server.finance.loans.acceptOffer(GUILD, loanId, USER));
    return { loanId, amount: 1_000 };
  },
  [FINANCE_ROUTES.kyosaiBid]: () => {
    server.finance.kyosai.tickAuctions(GUILD, server.clock.now());
    return { amount: 5_000 };
  },
  [FINANCE_ROUTES.kyosaiAccept]: () => {
    server.finance.kyosai.tickAuctions(GUILD, server.clock.now());
    data(server.finance.kyosai.bidAuction(GUILD, OTHER_USER, 5_000));
    server.clock.advance(2 * DAY);
    server.finance.kyosai.tickAuctions(GUILD, server.clock.now());
    return { offerId: data(server.finance.kyosai.createOffer(GUILD, OTHER_USER, USER, 1, 8_000)) };
  },
  [FINANCE_ROUTES.marketSpot]: () => ({ symbol: 'gold', amount: 10_000 }),
  [FINANCE_ROUTES.marketMargin]: () => ({
    symbol: 'gold',
    side: 'long',
    amount: 10_000,
    leverage: 2,
  }),
  [FINANCE_ROUTES.marketOption]: () => ({ kind: 'call', symbol: 'gold', premium: 1_000 }),
  [FINANCE_ROUTES.marketBond]: () => ({ kind: 'normal', amount: 5_000 }),
  [FINANCE_ROUTES.marketSettle]: () => {
    data(server.finance.stocks.buySpot(GUILD, USER, 'gold', 40_000));
    return { position: 'spot:gold', percent: 25 };
  },
  [FINANCE_ROUTES.companyFound]: () => ({ name: 'Pixel Farm', kind: 'farm' }),
  [FINANCE_ROUTES.companyInvest]: () => {
    data(server.finance.companies.foundCompany(GUILD, OTHER_USER, 'Pixel Farm', 'farm'));
    return { ownerId: OTHER_USER, amount: 1_500 };
  },
  [FINANCE_ROUTES.companyFund]: () => {
    data(server.finance.companies.foundCompany(GUILD, USER, 'Pixel Farm', 'farm'));
    return { amount: 10_000 };
  },
  [FINANCE_ROUTES.listingBuy]: () => {
    new Inventory(server.store).add(GUILD, OTHER_USER, 'daily_double', 1);
    const listingId = data(
      server.finance.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: OTHER_USER,
        kind: 'item',
        ref: 'daily_double',
        qty: 1,
        mode: 'fixed',
        price: 3_000,
      }),
    );
    return { listingId };
  },
  [FINANCE_ROUTES.listingBid]: () => {
    new Inventory(server.store).add(GUILD, OTHER_USER, 'daily_double', 1);
    const listingId = data(
      server.finance.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: OTHER_USER,
        kind: 'item',
        ref: 'daily_double',
        qty: 1,
        mode: 'auction',
        price: 3_000,
        hours: 72,
      }),
    );
    return { listingId, amount: 3_000 };
  },
};

/** Writes whose key never reaches the ledger (no money moves), so a purged key is just a new key. */
const NO_MONEY = new Set<string>([
  FINANCE_ROUTES.loanOffer,
  FINANCE_ROUTES.loanRequest,
  FINANCE_ROUTES.loanDecline,
  FINANCE_ROUTES.loanCancel,
  FINANCE_ROUTES.kyosaiOffer,
  FINANCE_ROUTES.kyosaiCancel,
  FINANCE_ROUTES.kyosaiPropose,
  FINANCE_ROUTES.kyosaiVote,
  FINANCE_ROUTES.companyDividend,
  FINANCE_ROUTES.listingCancel,
]);

const fresh = () => {
  server = createTestServer();
  grant(USER, 1_000_000);
  grant(OTHER_USER, 1_000_000);
  server.finance.stocks.ensureMarketInitialized();
  server.finance.stocks.setPrice('gold', 1_000 * PRICE_SCALE, server.clock.now());
};

describe('R-1: finance routes after the idempotency key expired', () => {
  it('the sweep covers every finance write route', async () => {
    fresh();
    await server.app.ready();
    const writes = Object.values(FINANCE_ROUTES).filter((url) =>
      server.app.hasRoute({ method: 'POST', url }),
    );
    expect(writes.length).toBeGreaterThan(20);
    for (const url of writes) {
      expect(url in MONEY !== NO_MONEY.has(url), `${url} is in exactly one list`).toBe(true);
    }
    expect([...Object.keys(MONEY), ...NO_MONEY].sort()).toEqual([...writes].sort());
  });

  for (const [url, setup] of Object.entries(MONEY)) {
    it(`R-1: ${url} replayed with a purged key is conflict and moves nothing`, async () => {
      fresh();
      const body = { ...setup(), idempotencyKey: 'sweep-http-key-00000001' };
      const first = await (await login(USER))(url, body);
      expect(first.statusCode, first.body).toBe(200);

      server.clock.advance(DAY + 1);
      expect(new IdempotencyStore(server.store, server.clock).purge()).toBeGreaterThan(0);
      const post = await login(USER);
      const before = snapshot();
      const again = await post(url, body);
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json()).toEqual({ error: 'conflict' });
      expect(snapshot()).toBe(before);
    });
  }
});
