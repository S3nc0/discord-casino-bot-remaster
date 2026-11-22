import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  BlackjackView,
  CASINO_ROUTES,
  CasinoOverview,
  ChinchiroView,
  DailyClaimResponse,
  DailyStatus,
  HistoryPage,
  PachinkoResultView,
  RouletteBetAccepted,
  RouletteTableData,
  SlotsResultView,
  isLedgerReason,
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
beforeEach(() => {
  server = createTestServer({ casinoHandlers: true });
});
afterEach(async () => {
  await server.close();
});

const key = (n: number) => `casino-test-key-${String(n).padStart(6, '0')}`;

async function login(who: { id: string; guild?: string } = { id: USER }) {
  const guild = who.guild ?? GUILD;
  server.discord.state.user = {
    id: who.id,
    username: `u${who.id.slice(-3)}`,
    global_name: null,
    avatar: null,
  };
  server.discord.state.guilds = [{ id: guild, name: 'G' }];
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: guild },
    users: [who.id],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: guild, instanceId: INSTANCE },
  });
  const { sessionToken } = res.json<TokenResponse>();
  const headers = () => ({ ...server.signed(), authorization: `Bearer ${sessionToken}` });
  return {
    get: (url: string) => server.app.inject({ url, headers: headers() }),
    post: (url: string, payload?: object) =>
      server.app.inject({
        method: 'POST',
        url,
        headers: headers(),
        ...(payload === undefined ? {} : { payload }),
      }),
  };
}

const caller = (userId = USER, guildId = GUILD) => ({
  guildId,
  userId,
  source: 'activity' as const,
  instanceId: INSTANCE,
});

describe('casino routes need a session', () => {
  it('401 without a bearer token', async () => {
    for (const [method, url] of [
      ['GET', CASINO_ROUTES.overview],
      ['GET', CASINO_ROUTES.daily],
      ['POST', CASINO_ROUTES.dailyClaim],
      ['GET', CASINO_ROUTES.history],
    ] as const) {
      const res = await server.app.inject({ method, url, headers: server.signed() });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('GET /api/daily and POST /api/daily/claim', () => {
  it('claims once per slot, posts one ledger row and replays a repeated key', async () => {
    const api = await login();
    const before = (await api.get(CASINO_ROUTES.daily)).json();
    expect(Value.Check(DailyStatus, before)).toBe(true);
    expect(before).toMatchObject({ claimable: true, streak: 0 });

    const res = await api.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(1) });
    expect(res.statusCode).toBe(200);
    const claim = res.json();
    expect(Value.Check(DailyClaimResponse, claim)).toBe(true);
    expect(claim).toMatchObject({ replayed: false, amount: 1000, streak: 1, balance: 4000 });
    expect(claim.nextSlotAt).toBeGreaterThan(server.clock.now());

    const rows = server.economy.history(GUILD, USER).filter((e) => e.reason === 'daily_bonus');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBe(1000);

    // Same key again: the stored answer, no second credit.
    const again = (await api.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(1) })).json();
    expect(again).toMatchObject({ replayed: true, amount: 1000, balance: 4000 });
    expect(server.economy.getBalance(GUILD, USER)).toBe(4000);

    // A new key in the same slot is refused with a typed code and posts nothing.
    const refused = await api.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(2) });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'conflict' });
    expect(server.economy.getBalance(GUILD, USER)).toBe(4000);
    expect((await api.get(CASINO_ROUTES.daily)).json()).toMatchObject({
      claimable: false,
      streak: 1,
    });

    // The next slot (6 hours on) opens it again; the streak stays on the same calendar day.
    server.clock.advance(6 * 60 * 60 * 1000);
    const later = await login();
    expect((await later.get(CASINO_ROUTES.daily)).json()).toMatchObject({ claimable: true });
    const next = await later.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(3) });
    expect(next.statusCode).toBe(200);
  });

  it('rejects a missing key, an unknown field and a short key', async () => {
    const api = await login();
    for (const body of [
      {},
      { idempotencyKey: 'short' },
      { idempotencyKey: key(4), userId: USER },
    ]) {
      const res = await api.post(CASINO_ROUTES.dailyClaim, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
    expect(server.economy.history(GUILD, USER).some((e) => e.reason === 'daily_bonus')).toBe(false);
  });

  it('acts only on the session user: another user claims their own bonus', async () => {
    const a = await login();
    await a.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(5) });
    const b = await login({ id: OTHER_USER });
    const res = await b.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(5) });
    expect(res.statusCode).toBe(200);
    expect(res.json().replayed).toBe(false);
    expect(server.economy.getBalance(GUILD, OTHER_USER)).toBe(4000);
  });

  it('limits claims per user and minute with a typed code', async () => {
    const api = await login();
    let last = 200;
    for (let i = 0; i < 12; i++) {
      last = (await api.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(100 + i) }))
        .statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('GET /api/history', () => {
  it('pages newest first with a cursor and only valid ledger reasons', async () => {
    const api = await login();
    await api.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(10) });
    for (let i = 0; i < 4; i++) {
      server.casino.slots.play(caller(), { stake: 10, idempotencyKey: key(20 + i) });
      server.clock.advance(2_000);
    }
    const first = (await api.get(`${CASINO_ROUTES.history}?limit=3`)).json();
    expect(Value.Check(HistoryPage, first)).toBe(true);
    expect(first.items).toHaveLength(3);
    expect(first.nextBefore).toBe(first.items[2].id);
    const ids = first.items.map((e: { id: number }) => e.id);
    expect([...ids].sort((x, y) => y - x)).toEqual(ids);
    for (const item of first.items) expect(isLedgerReason(item.reason)).toBe(true);

    const second = (
      await api.get(`${CASINO_ROUTES.history}?limit=50&before=${first.nextBefore}`)
    ).json();
    expect(second.items.every((e: { id: number }) => e.id < first.nextBefore)).toBe(true);
    expect(second.nextBefore).toBeNull();
    const all = [...first.items, ...second.items].map((e: { reason: string }) => e.reason);
    expect(all).toContain('initial_grant');
    expect(all).toContain('daily_bonus');
    expect(all).toContain('game_stake');
  });

  it('shows only the session user in the session guild', async () => {
    const a = await login();
    await a.post(CASINO_ROUTES.dailyClaim, { idempotencyKey: key(30) });
    const other = await login({ id: OTHER_USER });
    const page = (await other.get(CASINO_ROUTES.history)).json();
    expect(page.items.map((e: { reason: string }) => e.reason)).toEqual(['initial_grant']);
  });

  it('rejects a bad cursor or limit', async () => {
    const api = await login();
    for (const query of ['before=0', 'before=abc', 'limit=0', 'limit=51', 'foo=1']) {
      const res = await api.get(`${CASINO_ROUTES.history}?${query}`);
      expect(res.statusCode, query).toBe(400);
    }
  });
});

describe('GET /api/casino/overview', () => {
  it('starts empty and lists the last settled rounds with the jackpot pool', async () => {
    const api = await login();
    const empty = (await api.get(CASINO_ROUTES.overview)).json();
    expect(Value.Check(CasinoOverview, empty)).toBe(true);
    expect(empty).toMatchObject({ minBet: 10, jackpotPool: 0, disabled: [], recent: [] });

    for (let i = 0; i < 3; i++) {
      server.casino.slots.play(caller(), { stake: 100, idempotencyKey: key(40 + i) });
      server.clock.advance(2_000);
    }
    const overview = (await api.get(CASINO_ROUTES.overview)).json();
    expect(Value.Check(CasinoOverview, overview)).toBe(true);
    expect(overview.recent).toHaveLength(3);
    expect(overview.recent[0].settledAt).toBeGreaterThan(overview.recent[2].settledAt);
    for (const round of overview.recent) expect(round.stake).toBe(100);
  });

  it('reports a game the owner switched off', async () => {
    const api = await login();
    server.store
      .stmt('INSERT INTO guild_features_off (guild_id, feature) VALUES (?, ?)')
      .run(GUILD, 'casino:roulette');
    expect((await api.get(CASINO_ROUTES.overview)).json().disabled).toEqual(['roulette']);
  });
});

describe('result shapes the screens read', () => {
  const play = () => {
    server.economy.ensureMember(GUILD, USER);
    return server.casino;
  };

  it('slots, pachinko, chinchiro, roulette and blackjack match the shared schemas', () => {
    const casino = play();
    const slots = casino.slots.play(caller(), { stake: 10, idempotencyKey: key(50) });
    expect(Value.Check(SlotsResultView, slots.response)).toBe(true);

    server.clock.advance(5_000);
    const pachinko = casino.pachinko.play(caller(), {
      stake: 10,
      sets: 2,
      idempotencyKey: key(51),
    });
    expect(Value.Check(PachinkoResultView, pachinko.response)).toBe(true);

    server.clock.advance(5_000);
    const chin = casino.chinchiro.start(caller(), { stake: 10, idempotencyKey: key(52) });
    expect(Value.Check(ChinchiroView, chin.response)).toBe(true);
    let view = chin.response;
    for (let i = 0; i < 3 && view.status !== 'settled'; i++) {
      view = casino.chinchiro.roll(caller(), {
        roundId: view.roundId,
        idempotencyKey: key(53 + i),
      }).response as typeof view;
      expect(Value.Check(ChinchiroView, view)).toBe(true);
    }
    expect(view.status).toBe('settled');

    server.clock.advance(5_000);
    const bet = casino.roulette.placeBet(caller(), {
      stake: 20,
      bets: [
        { kind: 'red', targets: [], stake: 10 },
        { kind: 'number', targets: [7], stake: 10 },
      ],
      idempotencyKey: key(60),
    });
    expect(Value.Check(RouletteBetAccepted, bet.response)).toBe(true);
    expect(Value.Check(RouletteTableData, casino.roulette.snapshot(GUILD, INSTANCE).data)).toBe(
      true,
    );

    // The roulette seat holds the first user's lock; blackjack takes a second player.
    const bj = casino.blackjack.bet(caller(OTHER_USER), { stake: 10, idempotencyKey: key(61) });
    expect(Value.Check(BlackjackView, bj.response)).toBe(true);
  });
});
