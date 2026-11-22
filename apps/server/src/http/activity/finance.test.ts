import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  FINANCE_ROUTES,
  FinanceBankView,
  FinanceCompaniesView,
  FinanceKyosaiView,
  FinanceListingsView,
  FinanceLoansView,
  FinanceMarketView,
  FinanceWriteResult,
  type TokenResponse,
} from '@casino/shared';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

async function login(id: string) {
  server.discord.state.user = {
    id,
    username: `u${id.slice(-3)}`,
    global_name: null,
    avatar: null,
  };
  server.discord.state.guilds = [{ id: GUILD, name: 'G' }];
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [id],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  const { sessionToken } = res.json<TokenResponse>();
  const headers = () => ({ ...server.signed(), authorization: `Bearer ${sessionToken}` });
  return {
    get: (url: string) => server.app.inject({ url, headers: headers() }),
    post: (url: string, payload: object) =>
      server.app.inject({ method: 'POST', url, headers: headers(), payload }),
  };
}

let counter = 0;
const key = () => `finance-test-key-${String(++counter).padStart(8, '0')}`;

const ledger = (userId: string) =>
  server.store.db
    .prepare('SELECT reason, delta FROM ledger WHERE user_id = ? ORDER BY id')
    .all(userId) as { reason: string; delta: number }[];

function grant(userId: string, amount: number): void {
  server.economy.ensureMember(GUILD, userId);
  server.economy.credit({ guildId: GUILD, userId, amount, reason: 'admin_grant' });
}

describe('finance routes need a session', () => {
  it('401 without a bearer token, reads and writes alike', async () => {
    server = createTestServer();
    for (const url of [FINANCE_ROUTES.bank, FINANCE_ROUTES.market, FINANCE_ROUTES.listings]) {
      const res = await server.app.inject({ url, headers: server.signed() });
      expect(res.statusCode, url).toBe(401);
    }
    const res = await server.app.inject({
      method: 'POST',
      url: FINANCE_ROUTES.bankRepay,
      headers: server.signed(),
      payload: { idempotencyKey: key() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('reads match their schemas', () => {
  it('every view validates for a new player', async () => {
    server = createTestServer();
    const me = await login(USER);
    const cases = [
      [FINANCE_ROUTES.bank, FinanceBankView],
      [FINANCE_ROUTES.loans, FinanceLoansView],
      [FINANCE_ROUTES.kyosai, FinanceKyosaiView],
      [FINANCE_ROUTES.market, FinanceMarketView],
      [FINANCE_ROUTES.companies, FinanceCompaniesView],
      [FINANCE_ROUTES.listings, FinanceListingsView],
    ] as const;
    for (const [url, schema] of cases) {
      const res = await me.get(url);
      expect(res.statusCode, url).toBe(200);
      const body = res.json();
      expect(
        Value.Check(schema, body),
        `${url}: ${JSON.stringify([...Value.Errors(schema, body)].slice(0, 2))}`,
      ).toBe(true);
    }
    const bank = (await me.get(FINANCE_ROUTES.bank)).json<FinanceBankView>();
    expect(bank).toMatchObject({ balance: 3000, debt: 0, status: 'katagi', inGrace: false });
    const market = (await me.get(FINANCE_ROUTES.market)).json<FinanceMarketView>();
    expect(market.symbols.map((s) => s.key)).toEqual(['cs', 'teio', 'numa', 'gold']);
    expect(market.symbols[0]?.history.length).toBeGreaterThan(0);
  });
});

describe('Teiai Bank repay', () => {
  it('moves money once per key, replays the answer and refuses a changed body', async () => {
    server = createTestServer();
    const me = await login(USER);
    server.economy.ensureMember(GUILD, USER);
    server.finance.teiai.adminSetDebt(GUILD, USER, 1000);
    const k = key();

    const first = await me.post(FINANCE_ROUTES.bankRepay, { idempotencyKey: k, amount: 400 });
    expect(first.statusCode).toBe(200);
    const body = first.json<FinanceWriteResult>();
    expect(Value.Check(FinanceWriteResult, body)).toBe(true);
    expect(body).toMatchObject({ balance: 2600, amount: 400, remainingDebt: 600 });
    expect(ledger(USER).filter((r) => r.reason === 'loan_repay')).toEqual([
      { reason: 'loan_repay', delta: -400 },
    ]);

    const again = await me.post(FINANCE_ROUTES.bankRepay, { idempotencyKey: k, amount: 400 });
    expect(again.json()).toMatchObject({ balance: 2600, remainingDebt: 600, replayed: true });
    expect(ledger(USER).filter((r) => r.reason === 'loan_repay')).toHaveLength(1);

    const changed = await me.post(FINANCE_ROUTES.bankRepay, { idempotencyKey: k, amount: 100 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toEqual({ error: 'conflict' });
  });

  it('answers a rule failure with its typed reason and leaves the key free', async () => {
    server = createTestServer();
    const me = await login(USER);
    const k = key();
    const none = await me.post(FINANCE_ROUTES.bankRepay, { idempotencyKey: k });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: 'not_found', reason: 'no_debt' });
    server.finance.teiai.adminSetDebt(GUILD, USER, 500);
    const retry = await me.post(FINANCE_ROUTES.bankRepay, { idempotencyKey: k });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ amount: 500, remainingDebt: 0 });
  });

  it('rejects unknown properties, a short key and a user id from the client', async () => {
    server = createTestServer();
    const me = await login(USER);
    for (const payload of [
      { idempotencyKey: key(), userId: OTHER_USER },
      { idempotencyKey: 'short' },
      { amount: 5 },
      { idempotencyKey: key(), amount: 0 },
    ]) {
      const res = await me.post(FINANCE_ROUTES.bankRepay, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
  });
});

describe('securities market', () => {
  it('buys spot, shows the holding and settles it with ledger rows', async () => {
    server = createTestServer();
    const me = await login(USER);
    const buy = await me.post(FINANCE_ROUTES.marketSpot, {
      idempotencyKey: key(),
      symbol: 'gold',
      amount: 1000,
    });
    expect(buy.statusCode).toBe(200);
    expect(buy.json<FinanceWriteResult>().unitsMilli).toBeGreaterThan(0);
    const market = (await me.get(FINANCE_ROUTES.market)).json<FinanceMarketView>();
    expect(market.spot).toHaveLength(1);
    expect(market.spot[0]).toMatchObject({ symbol: 'gold' });
    expect(ledger(USER).some((r) => r.reason === 'stock_buy')).toBe(true);

    const sell = await me.post(FINANCE_ROUTES.marketSettle, {
      idempotencyKey: key(),
      position: 'spot:gold',
    });
    expect(sell.statusCode).toBe(200);
    expect(ledger(USER).some((r) => r.reason === 'stock_sell')).toBe(true);
    expect((await me.get(FINANCE_ROUTES.market)).json<FinanceMarketView>().spot).toEqual([]);
  });

  it('refuses a margin below the minimum with its reason', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(FINANCE_ROUTES.marketMargin, {
      idempotencyKey: key(),
      symbol: 'cs',
      side: 'long',
      amount: 1,
      leverage: 2,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_payload', reason: 'margin_min_amount' });
  });

  it('settles an unknown position as not found', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(FINANCE_ROUTES.marketSettle, {
      idempotencyKey: key(),
      position: 'spot:cs',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found', reason: 'position_not_found' });
  });

  it('refuses spending more than the balance', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(FINANCE_ROUTES.marketSpot, {
      idempotencyKey: key(),
      symbol: 'cs',
      amount: 900_000,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'insufficient_funds' });
    expect(ledger(USER).filter((r) => r.reason === 'stock_buy')).toEqual([]);
  });
});

describe('player loans', () => {
  it('offer, accept and repay move money through the ledger', async () => {
    server = createTestServer();
    const lender = await login(USER);
    const borrower = await login(OTHER_USER);
    grant(USER, 2000);

    const offer = await lender.post(FINANCE_ROUTES.loanOffer, {
      idempotencyKey: key(),
      borrowerId: OTHER_USER,
      principal: 1000,
      rateBps: 100,
      termDays: 5,
    });
    expect(offer.statusCode).toBe(200);
    const loanId = offer.json<FinanceWriteResult>().id!;

    const seen = (await borrower.get(FINANCE_ROUTES.loans)).json<FinanceLoansView>();
    expect(seen.loans).toHaveLength(1);
    expect(seen.loans[0]).toMatchObject({
      id: loanId,
      role: 'borrower',
      status: 'offer',
      counterparty: { id: USER },
    });

    const accept = await borrower.post(FINANCE_ROUTES.loanAccept, {
      idempotencyKey: key(),
      loanId,
    });
    expect(accept.statusCode).toBe(200);
    expect(ledger(USER).some((r) => r.reason === 'p2p_lend' && r.delta === -1000)).toBe(true);
    expect(ledger(OTHER_USER).some((r) => r.reason === 'p2p_borrow' && r.delta === 1000)).toBe(
      true,
    );

    const repay = await borrower.post(FINANCE_ROUTES.loanRepay, {
      idempotencyKey: key(),
      loanId,
      amount: 500,
    });
    expect(repay.statusCode).toBe(200);
    expect(ledger(USER).some((r) => r.reason === 'p2p_collect')).toBe(true);
  });

  it('lists an open request for other players and lets one fund it', async () => {
    server = createTestServer();
    const asker = await login(OTHER_USER);
    const lender = await login(USER);
    const ask = await asker.post(FINANCE_ROUTES.loanRequest, {
      idempotencyKey: key(),
      principal: 500,
      rateBps: 50,
      termDays: 3,
    });
    expect(ask.statusCode).toBe(200);
    const board = (await lender.get(FINANCE_ROUTES.loans)).json<FinanceLoansView>();
    expect(board.loans[0]).toMatchObject({ role: 'open', status: 'request' });
    const lend = await lender.post(FINANCE_ROUTES.loanLend, {
      idempotencyKey: key(),
      loanId: board.loans[0]!.id,
    });
    expect(lend.statusCode).toBe(200);
    expect(lend.json<FinanceWriteResult>().balance).toBe(2500);
  });

  it('answers a self offer with its rule code', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(FINANCE_ROUTES.loanOffer, {
      idempotencyKey: key(),
      borrowerId: USER,
      principal: 500,
      rateBps: 50,
      termDays: 3,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_payload', reason: 'loan_self_forbidden' });
  });
});

describe('Kyosai', () => {
  it('reports the fund state and refuses a bid without an auction', async () => {
    server = createTestServer();
    const me = await login(USER);
    const view = (await me.get(FINANCE_ROUTES.kyosai)).json<FinanceKyosaiView>();
    expect(view).toMatchObject({ total: 10_000, units: 0, auction: null });
    const bid = await me.post(FINANCE_ROUTES.kyosaiBid, { idempotencyKey: key(), amount: 100 });
    expect(bid.statusCode).toBe(404);
    expect(bid.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('companies', () => {
  it('founds a company for 200,000 and shows it', async () => {
    server = createTestServer();
    const me = await login(USER);
    grant(USER, 300_000);
    const found = await me.post(FINANCE_ROUTES.companyFound, {
      idempotencyKey: key(),
      name: 'Pixel Farm',
      kind: 'farm',
    });
    expect(found.statusCode).toBe(200);
    expect(found.json<FinanceWriteResult>().balance).toBe(103_000);
    expect(ledger(USER).some((r) => r.reason === 'company_create')).toBe(true);
    const view = (await me.get(FINANCE_ROUTES.companies)).json<FinanceCompaniesView>();
    expect(view.mine).toMatchObject({ name: 'Pixel Farm', kind: 'farm', level: 1 });

    const second = await me.post(FINANCE_ROUTES.companyFound, {
      idempotencyKey: key(),
      name: 'Again',
      kind: 'mine',
    });
    expect(second.json()).toEqual({ error: 'conflict', reason: 'company_already_exists' });
  });

  it('lets another player take a stake and lists it as a holding', async () => {
    server = createTestServer();
    const owner = await login(USER);
    const investor = await login(OTHER_USER);
    grant(USER, 300_000);
    await owner.post(FINANCE_ROUTES.companyFound, {
      idempotencyKey: key(),
      name: 'Pixel Farm',
      kind: 'farm',
    });
    const board = (await investor.get(FINANCE_ROUTES.companies)).json<FinanceCompaniesView>();
    expect(board.others[0]).toMatchObject({ name: 'Pixel Farm', owner: { id: USER } });
    const stake = await investor.post(FINANCE_ROUTES.companyInvest, {
      idempotencyKey: key(),
      ownerId: USER,
      amount: 1500,
    });
    expect(stake.statusCode).toBe(200);
    const mine = (await investor.get(FINANCE_ROUTES.companies)).json<FinanceCompaniesView>();
    expect(mine.holdings[0]).toMatchObject({ name: 'Pixel Farm', amount: 1500 });
  });
});

describe('write rate limit', () => {
  it('answers 429 with retryAfterMs after 60 writes in a minute', async () => {
    server = createTestServer();
    const me = await login(USER);
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const res = await me.post(FINANCE_ROUTES.bankRepay, { amount: 0 });
      last = res.statusCode;
      if (last === 429) {
        expect(res.json()).toMatchObject({ error: 'rate_limited' });
        expect(res.json().retryAfterMs).toBeGreaterThan(0);
      }
    }
    expect(last).toBe(429);
  });
});
