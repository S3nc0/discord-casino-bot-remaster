import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  ARENA_ROUTES,
  ArenaToday,
  HORSE_BET_KINDS,
  HORSE_COATS,
  HORSE_ROUTES,
  HORSE_SILKS,
  HORSE_STYLES,
  HorseBreedPreview,
  HorseCard,
  HorseRaceDetail,
  HorseStable,
  HorseTimeline,
  type TokenResponse,
} from '@casino/shared';
import { BET_KINDS, COATS, RUNNING_STYLES, SILKS } from '@casino/domain/race';
import { Inventory } from '../../games/shop/inventory.ts';
import {
  GUILD,
  INSTANCE,
  USER,
  createTestServer,
  type TestServer,
} from '../../runtime/test-kit.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

/** Friday 2027-01-15 at `hour:minute` JST. */
const jst = (hour: number, minute = 0): number => Date.UTC(2027, 0, 15, hour - 9, minute);
const key = (n: number | string): string => `test-key-${String(n).padStart(12, '0')}`;

async function login(at = jst(17)) {
  // A day-long session, so the tests can move the clock across race and arena hours.
  server = createTestServer({ sessionTtlSeconds: 86_400 });
  server.clock.set(at);
  server.discord.state.user = { id: USER, username: 'alice', global_name: null, avatar: null };
  server.discord.state.guilds = [{ id: GUILD, name: 'G' }];
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [USER],
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

const grant = (amount: number, userId = USER): void => {
  server.economy.credit({
    guildId: GUILD,
    userId,
    amount,
    reason: 'admin_grant',
    idempotencyKey: `grant-${amount}-${server.clock.now()}`,
  });
};
const give = (item: string, qty: number): void =>
  new Inventory(server.store).add(GUILD, USER, item, qty);
const rows = (sql: string, ...params: unknown[]): Record<string, unknown>[] =>
  server.store.stmt(sql).all(...params) as Record<string, unknown>[];
const ledgerCount = (reason: string): number =>
  (
    rows(
      'SELECT COUNT(*) AS n FROM ledger WHERE guild_id = ? AND user_id = ? AND reason = ?',
      GUILD,
      USER,
      reason,
    )[0] as {
      n: number;
    }
  ).n;

const look = { coat: '鹿毛', silks: '🟦' };

describe('catalogues equal the domain', () => {
  it('keeps the shared lists in step with packages/domain', () => {
    server = createTestServer();
    expect([...HORSE_COATS]).toEqual([...COATS]);
    expect([...HORSE_SILKS]).toEqual([...SILKS]);
    expect([...HORSE_STYLES]).toEqual([...RUNNING_STYLES]);
    expect([...HORSE_BET_KINDS]).toEqual([...BET_KINDS]);
  });
});

describe('every horse and arena route needs a session', () => {
  it('401 without a bearer token', async () => {
    server = createTestServer();
    const routes: [string, string][] = [
      ['GET', HORSE_ROUTES.stable],
      ['POST', HORSE_ROUTES.create],
      ['POST', HORSE_ROUTES.carrot],
      ['POST', HORSE_ROUTES.goldCarrot],
      ['POST', HORSE_ROUTES.style],
      ['POST', HORSE_ROUTES.retire],
      ['GET', `${HORSE_ROUTES.breedPreview}?a=1&b=2`],
      ['POST', HORSE_ROUTES.breed],
      ['GET', HORSE_ROUTES.card],
      ['GET', '/api/horse/races/1'],
      ['GET', '/api/horse/races/1/timeline'],
      ['POST', '/api/horse/races/1/enter'],
      ['POST', '/api/horse/races/1/withdraw'],
      ['POST', '/api/horse/races/1/bet'],
      ['GET', ARENA_ROUTES.today],
      ['POST', ARENA_ROUTES.bet],
    ];
    for (const [method, url] of routes) {
      const res = await server.app.inject({
        method: method as 'GET' | 'POST',
        url,
        headers: server.signed(),
        payload: method === 'POST' ? {} : undefined,
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('stable', () => {
  it('lists horses and items, creates a horse once per key and rejects a changed body', async () => {
    const me = await login();
    const empty = (await me.get(HORSE_ROUTES.stable)).json();
    expect(Value.Check(HorseStable, empty)).toBe(true);
    expect(empty.horses).toEqual([]);
    expect(empty.items.voucher).toBe(0);

    const noVoucher = await me.post(HORSE_ROUTES.create, {
      idempotencyKey: key(1),
      name: 'Ace',
      ...look,
    });
    expect(noVoucher.statusCode).toBe(409);
    expect(noVoucher.json()).toMatchObject({ error: 'conflict', rule: 'no_voucher' });

    give('horse_voucher', 2);
    const created = await me.post(HORSE_ROUTES.create, {
      idempotencyKey: key(1),
      name: 'Ace',
      ...look,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      replayed: false,
      horse: { name: 'Ace', stats: { speed: 50 } },
    });
    const again = await me.post(HORSE_ROUTES.create, {
      idempotencyKey: key(1),
      name: 'Ace',
      ...look,
    });
    expect(again.json()).toMatchObject({ replayed: true });
    expect((await me.get(HORSE_ROUTES.stable)).json().horses).toHaveLength(1);
    expect((await me.get(HORSE_ROUTES.stable)).json().items.voucher).toBe(1);

    const changed = await me.post(HORSE_ROUTES.create, {
      idempotencyKey: key(1),
      name: 'Bee',
      ...look,
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: 'conflict' });
  });

  it('takes a carrot and a style, and retires with the legacy value', async () => {
    const me = await login();
    give('horse_voucher', 1);
    give('carrot', 1);
    const { horse } = (
      await me.post(HORSE_ROUTES.create, { idempotencyKey: key(1), name: 'Ace', ...look })
    ).json();
    const moved = await me.post(HORSE_ROUTES.carrot, {
      idempotencyKey: key(2),
      horseId: horse.id,
      from: 'power',
      to: 'speed',
    });
    expect(moved.json().horse.stats).toMatchObject({ speed: 55, power: 45 });
    expect(
      (
        await me.post(HORSE_ROUTES.carrot, {
          idempotencyKey: key(3),
          horseId: horse.id,
          from: 'power',
          to: 'speed',
        })
      ).json(),
    ).toMatchObject({ rule: 'no_carrot' });
    const styled = await me.post(HORSE_ROUTES.style, {
      idempotencyKey: key(4),
      horseId: horse.id,
      style: 'sashi',
    });
    expect(styled.json().horse.style).toBe('sashi');
    // A horse with no record retires for 0.
    const retired = await me.post(HORSE_ROUTES.retire, {
      idempotencyKey: key(5),
      horseId: horse.id,
    });
    expect(retired.json()).toMatchObject({ value: 0, replayed: false });
    expect((await me.get(HORSE_ROUTES.stable)).json().horses).toEqual([]);
  });
});

describe('races', () => {
  it('enters, bets once per key, runs, and shows the result and the timeline', async () => {
    const me = await login();
    server.clock.set(jst(19, 30)); // the 21:00 race takes entries from 19:00 to 20:00
    grant(10_000);
    give('horse_voucher', 1);
    const { horse } = (
      await me.post(HORSE_ROUTES.create, { idempotencyKey: key(1), name: 'Ace', ...look })
    ).json();

    const card = (await me.get(HORSE_ROUTES.card)).json();
    expect(Value.Check(HorseCard, card)).toBe(true);
    const target = card.races.find(
      (r: { phase: string; major: boolean }) => r.phase === 'entry_open',
    );
    expect(target).toMatchObject({ major: true });

    const detail = (await me.get(`/api/horse/races/${target.id}`)).json();
    expect(Value.Check(HorseRaceDetail, detail)).toBe(true);
    expect(detail.enterable).toEqual([horse.id]);

    const entered = await me.post(`/api/horse/races/${target.id}/enter`, {
      idempotencyKey: key(2),
      horseId: horse.id,
    });
    expect(entered.statusCode).toBe(200);
    const enterAgain = await me.post(`/api/horse/races/${target.id}/enter`, {
      idempotencyKey: key(2),
      horseId: horse.id,
    });
    expect(enterAgain.json()).toMatchObject({ replayed: true });
    expect(ledgerCount('race_entry_fee')).toBe(1);

    server.clock.set(jst(20, 1));
    server.games.race.tick(GUILD);
    const betting = (await me.get(`/api/horse/races/${target.id}`)).json();
    expect(betting.race.phase).toBe('betting');
    expect(betting.runners).toHaveLength(8);
    expect(Object.keys(betting.odds)).toEqual(expect.arrayContaining(['win', 'place', 'trifecta']));
    const lane = betting.runners.find((r: { mine: boolean }) => r.mine).lane as number;

    const bet = { idempotencyKey: key(3), kind: 'win', lanes: [lane], stake: 500 };
    const first = await me.post(`/api/horse/races/${target.id}/bet`, bet);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ replayed: false });
    const second = await me.post(`/api/horse/races/${target.id}/bet`, bet);
    expect(second.json()).toMatchObject({ replayed: true, betId: first.json().betId });
    expect(ledgerCount('race_bet')).toBe(1);
    expect((await me.get(`/api/horse/races/${target.id}`)).json().tickets).toHaveLength(1);

    const tooBig = await me.post(`/api/horse/races/${target.id}/bet`, {
      ...bet,
      idempotencyKey: key(4),
      stake: 60_000,
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json()).toMatchObject({ rule: 'stake_range' });
    const wrongLane = await me.post(`/api/horse/races/${target.id}/bet`, {
      ...bet,
      idempotencyKey: key(5),
      lanes: [9],
    });
    expect(wrongLane.statusCode).toBe(400);

    server.clock.set(jst(21, 1));
    server.games.race.tick(GUILD);
    const done = (await me.get(`/api/horse/races/${target.id}`)).json();
    expect(done.race.phase).toBe('done');
    expect(done.race.placings).toHaveLength(8);
    expect(done.hasTimeline).toBe(true);
    expect(done.tickets[0].payout).not.toBeNull();
    const timeline = (await me.get(`/api/horse/races/${target.id}/timeline`)).json();
    expect(Value.Check(HorseTimeline, timeline)).toBe(true);
    expect(timeline.frames.length).toBeGreaterThan(0);
    expect(timeline.runners.some((r: { mine: boolean }) => r.mine)).toBe(true);

    const late = await me.post(`/api/horse/races/${target.id}/bet`, {
      ...bet,
      idempotencyKey: key(6),
    });
    expect(late.json()).toMatchObject({ rule: 'bet_unavailable' });
  });

  it('answers 404 for an unknown race and withdraws with a refund', async () => {
    const me = await login();
    expect((await me.get('/api/horse/races/9999')).statusCode).toBe(404);
    expect((await me.get('/api/horse/races/abc')).statusCode).toBe(400);
    server.clock.set(jst(19, 30));
    grant(5000);
    give('horse_voucher', 1);
    const { horse } = (
      await me.post(HORSE_ROUTES.create, { idempotencyKey: key(1), name: 'Ace', ...look })
    ).json();
    const card = (await me.get(HORSE_ROUTES.card)).json();
    const target = card.races.find((r: { phase: string }) => r.phase === 'entry_open');
    await me.post(`/api/horse/races/${target.id}/enter`, {
      idempotencyKey: key(2),
      horseId: horse.id,
    });
    const before = server.economy.getBalance(GUILD, USER);
    const out = await me.post(`/api/horse/races/${target.id}/withdraw`, {
      idempotencyKey: key(3),
      horseId: horse.id,
    });
    expect(out.statusCode).toBe(200);
    expect(server.economy.getBalance(GUILD, USER)).toBe(before + 1000);
  });
});

describe('breeding', () => {
  async function twoParents() {
    const me = await login();
    grant(40_000);
    give('horse_voucher', 2);
    const a = (
      await me.post(HORSE_ROUTES.create, { idempotencyKey: key(1), name: 'Ace', ...look })
    ).json().horse;
    const b = (
      await me.post(HORSE_ROUTES.create, { idempotencyKey: key(2), name: 'Bee', ...look })
    ).json().horse;
    return { me, a, b };
  }

  it('previews the ranges, refuses young parents with the rule, then breeds once per key', async () => {
    const { me, a, b } = await twoParents();
    const young = (await me.get(`${HORSE_ROUTES.breedPreview}?a=${a.id}&b=${b.id}`)).json();
    expect(Value.Check(HorseBreedPreview, young)).toBe(true);
    expect(young.eligible).toMatchObject({ ok: false, rule: 'min_races' });
    expect(young.total).toEqual({ min: 190, max: 210 });

    const refused = await me.post(HORSE_ROUTES.breed, {
      idempotencyKey: key(3),
      parentA: a.id,
      parentB: b.id,
      name: 'Cub',
      silks: '🟥',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ rule: 'min_races' });
    expect(ledgerCount('horse_breeding_fee')).toBe(0);

    server.store.stmt('UPDATE horses SET races = 5').run();
    const ok = (await me.get(`${HORSE_ROUTES.breedPreview}?a=${a.id}&b=${b.id}`)).json();
    expect(ok.eligible).toEqual({ ok: true });
    const before = server.economy.getBalance(GUILD, USER);
    const body = { idempotencyKey: key(4), parentA: a.id, parentB: b.id, name: 'Cub', silks: '🟥' };
    const born = await me.post(HORSE_ROUTES.breed, body);
    expect(born.statusCode).toBe(200);
    expect(born.json()).toMatchObject({
      replayed: false,
      fee: 15_000,
      foal: { name: 'Cub', generation: 1 },
    });
    expect(server.economy.getBalance(GUILD, USER)).toBe(before - 15_000);
    const again = await me.post(HORSE_ROUTES.breed, body);
    expect(again.json()).toMatchObject({ replayed: true });
    expect(ledgerCount('horse_breeding_fee')).toBe(1);
    expect((await me.get(HORSE_ROUTES.stable)).json().horses).toHaveLength(3);
    // Same key, other parents: refused.
    const reused = await me.post(HORSE_ROUTES.breed, { ...body, parentB: a.id, parentA: b.id });
    expect(reused.statusCode).toBe(409);
  });
});

describe('arena', () => {
  it('lists today’s two brackets and takes a bet once per key', async () => {
    const me = await login(jst(8));
    grant(10_000);
    const today = (await me.get(ARENA_ROUTES.today)).json();
    expect(Value.Check(ArenaToday, today)).toBe(true);
    expect(today.tournaments.map((t: { format: string }) => t.format).sort()).toEqual([
      'duel',
      'royale',
    ]);
    const duel = today.tournaments.find((t: { format: string }) => t.format === 'duel');
    expect(duel.fighters).toHaveLength(4);
    expect(duel.status).toBe('semi_betting');

    const bet = {
      idempotencyKey: key(1),
      tournamentId: duel.id,
      fighterId: duel.fighters[0].id,
      amount: 1000,
    };
    const placed = await me.post(ARENA_ROUTES.bet, bet);
    expect(placed.statusCode).toBe(200);
    expect(placed.json().replayed).toBe(false);
    expect((await me.post(ARENA_ROUTES.bet, bet)).json().replayed).toBe(true);
    expect(ledgerCount('arena_bet')).toBe(1);
    const after = (await me.get(ARENA_ROUTES.today)).json();
    const fighter = after.tournaments
      .find((t: { id: number }) => t.id === duel.id)
      .fighters.find((f: { id: number }) => f.id === bet.fighterId);
    expect(fighter.myStake).toBe(1000);
    expect(fighter.betTotal).toBeGreaterThanOrEqual(1000);

    const small = await me.post(ARENA_ROUTES.bet, { ...bet, idempotencyKey: key(2), amount: 50 });
    expect(small.statusCode).toBe(400);
    expect(small.json()).toMatchObject({ rule: 'stake_range' });
    const out = await me.post(ARENA_ROUTES.bet, {
      ...bet,
      idempotencyKey: key(3),
      fighterId: 99_999,
    });
    expect(out.json()).toMatchObject({ rule: 'arena_fighter_out' });
  });

  it('shows the finalists after the semifinals and the champion after the final', async () => {
    const me = await login(jst(8));
    await me.get(ARENA_ROUTES.today);
    server.clock.set(jst(9, 5));
    server.games.arena.advance(GUILD);
    const mid = (await me.get(ARENA_ROUTES.today)).json();
    const duel = mid.tournaments.find((t: { format: string }) => t.format === 'duel');
    expect(duel.status).toBe('final_betting');
    expect(duel.fighters.filter((f: { stage: string }) => f.stage === 'final')).toHaveLength(2);
    server.clock.set(jst(13, 5));
    server.games.arena.advance(GUILD);
    const end = (await me.get(ARENA_ROUTES.today)).json();
    const done = end.tournaments.find((t: { format: string }) => t.format === 'duel');
    expect(done.status).toBe('done');
    expect(done.championId).not.toBeNull();
  });
});

describe('write limit', () => {
  it('answers 429 after 60 writes in a minute', async () => {
    const me = await login();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await me.post(HORSE_ROUTES.carrot, {})).statusCode;
    expect(last).toBe(429);
  });
});
