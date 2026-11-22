import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  LIFE_ROUTES,
  LotteryView,
  MissionsView,
  PollsView,
  QuizView,
  RankingView,
  ShopView,
  TransferView,
  WorkView,
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

const key = (() => {
  let n = 0;
  return () => `key-${String(++n).padStart(8, '0')}-abcdefgh`;
})();

/** Log in through the real token flow, as `who`, in the shared test server. */
async function login(who: string) {
  server.discord.state.user = {
    id: who,
    username: `u${who.slice(-3)}`,
    global_name: `Player ${who.slice(-3)}`,
    avatar: null,
  };
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [who],
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
    userId: who,
    get: (url: string) => server.app.inject({ url, headers: headers() }),
    post: (url: string, payload: object) =>
      server.app.inject({ method: 'POST', url, headers: headers(), payload }),
  };
}

const ledger = (userId: string, reason: string) =>
  server.economy
    .history(GUILD, userId, 100)
    .filter((e) => e.reason === reason)
    .map((e) => e.delta);

describe('auth', () => {
  it('every life route needs a session token', async () => {
    server = createTestServer();
    for (const url of Object.values(LIFE_ROUTES)) {
      const get = await server.app.inject({ url, headers: server.signed() });
      const post = await server.app.inject({
        method: 'POST',
        url,
        headers: server.signed(),
        payload: {},
      });
      // A route answers either GET or POST; the other method is a 404. Both refuse the guest.
      expect([get.statusCode, post.statusCode], url).toContain(401);
      expect([get.statusCode, post.statusCode].filter((s) => s !== 401 && s !== 404)).toEqual([]);
    }
  });

  it('refuses a forged token', async () => {
    server = createTestServer();
    const res = await server.app.inject({
      url: LIFE_ROUTES.work,
      headers: { ...server.signed(), authorization: 'Bearer nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('acts on the token user: bodies cannot name another user or guild', async () => {
    server = createTestServer();
    const me = await login(USER);
    const res = await me.post(LIFE_ROUTES.workClick, {
      idempotencyKey: key(),
      userId: OTHER_USER,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_payload' });
  });
});

describe('labor', () => {
  it('shows the state and pays a click once per idempotency key', async () => {
    server = createTestServer();
    const me = await login(USER);
    const view = (await me.get(LIFE_ROUTES.work)).json();
    expect(Value.Check(WorkView, view)).toBe(true);
    const before = server.economy.getBalance(GUILD, USER);

    const k = key();
    const first = (await me.post(LIFE_ROUTES.workClick, { idempotencyKey: k })).json();
    expect(first).toMatchObject({ replayed: false, tooFast: false });
    expect(first.pay).toBeGreaterThan(0);
    expect(first.balance).toBe(before + first.pay);

    const again = (await me.post(LIFE_ROUTES.workClick, { idempotencyKey: k })).json();
    expect(again).toMatchObject({ replayed: true, pay: first.pay, balance: first.balance });
    expect(ledger(USER, 'work_earnings')).toEqual([first.pay]);

    // A new key inside the one-second cooldown pays nothing; after it, it pays again.
    const fast = (await me.post(LIFE_ROUTES.workClick, { idempotencyKey: key() })).json();
    expect(fast.tooFast).toBe(true);
    expect(fast.pay).toBe(0);
    server.clock.advance(1100);
    const next = (await me.post(LIFE_ROUTES.workClick, { idempotencyKey: key() })).json();
    expect(next.tooFast).toBe(false);
    expect(ledger(USER, 'work_earnings')).toHaveLength(2);
  });

  it('a reused key with another body is a conflict', async () => {
    server = createTestServer();
    const me = await login(USER);
    const k = key();
    expect(
      (await me.post(LIFE_ROUTES.workHire, { idempotencyKey: k, kind: 'apprentice' })).statusCode,
    ).toBe(200);
    const clash = await me.post(LIFE_ROUTES.workHire, { idempotencyKey: k, kind: 'miner' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toEqual({ error: 'conflict' });
  });

  it('hires, upgrades and spends through the ledger; refusals carry a rule', async () => {
    server = createTestServer();
    const me = await login(USER);
    const hired = (
      await me.post(LIFE_ROUTES.workHire, { idempotencyKey: key(), kind: 'apprentice' })
    ).json();
    expect(hired.workerId).toBeGreaterThan(0);
    expect(ledger(USER, 'worker_hire')).toEqual([-150]);
    const up = (
      await me.post(LIFE_ROUTES.workUpgrade, { idempotencyKey: key(), tool: 'pick' })
    ).json();
    expect(up.level).toBe(1);
    expect(ledger(USER, 'work_upgrade')).toEqual([-150]);

    // 3000 start, 300 spent: the first dorm level (2000) fits, the second (6000) does not.
    const dorm = await me.post(LIFE_ROUTES.workUpgrade, { idempotencyKey: key(), tool: 'dorm' });
    expect(dorm.statusCode).toBe(200);
    const broke = await me.post(LIFE_ROUTES.workUpgrade, { idempotencyKey: key(), tool: 'dorm' });
    expect(broke.statusCode).toBe(409);
    expect(broke.json()).toMatchObject({
      error: 'insufficient_funds',
      rule: 'insufficient_balance',
    });

    const tired = await me.post(LIFE_ROUTES.workDrink, { idempotencyKey: key() });
    expect(tired.json()).toMatchObject({ error: 'conflict', rule: 'labor_not_tired' });
  });

  it('collects the pot with the 3 % Teiai skim as its own ledger row', async () => {
    server = createTestServer();
    const me = await login(USER);
    server.economy.ensureMember(GUILD, USER);
    await me.get(LIFE_ROUTES.work);
    server.store.db
      .prepare('UPDATE work_state SET pot = 1000 WHERE guild_id = ? AND user_id = ?')
      .run(GUILD, USER);
    const r = (await me.post(LIFE_ROUTES.workCollect, { idempotencyKey: key() })).json();
    expect(r).toMatchObject({ amount: 1000, skimmed: 30, net: 970 });
    expect(ledger(USER, 'work_earnings')).toContain(1000);
    expect(ledger(USER, 'teiai_skim')).toEqual([-30]);
    const nothing = await me.post(LIFE_ROUTES.workCollect, { idempotencyKey: key() });
    expect(nothing.json()).toMatchObject({ rule: 'labor_nothing_to_collect' });
  });

  it('merges ten relics into one of the next star', async () => {
    server = createTestServer();
    const me = await login(USER);
    server.games.shop.inventory.add(GUILD, USER, 'relic_fossil', 10);
    const r = (
      await me.post(LIFE_ROUTES.workMerge, { idempotencyKey: key(), itemId: 'relic_fossil' })
    ).json();
    expect(r.itemId).toBe('relic_fossil_s1');
    const view = (await me.get(LIFE_ROUTES.work)).json();
    expect(view.held).toEqual({ relic_fossil_s1: 1 });
    const few = await me.post(LIFE_ROUTES.workMerge, {
      idempotencyKey: key(),
      itemId: 'relic_bone',
    });
    expect(few.json()).toMatchObject({ rule: 'relic_need_more' });
  });

  it('ranks by earnings', async () => {
    server = createTestServer();
    const me = await login(USER);
    await me.post(LIFE_ROUTES.workClick, { idempotencyKey: key() });
    const rank = (await me.get(`${LIFE_ROUTES.workRanking}?period=today`)).json();
    expect(rank.rows).toHaveLength(1);
    expect(rank.self).toMatchObject({ rank: 1 });
    expect((await me.get(`${LIFE_ROUTES.workRanking}?period=bogus`)).statusCode).toBe(400);
  });
});

describe('shop', () => {
  it('lists the catalog, buys once per key and writes a shop_buy row', async () => {
    server = createTestServer();
    const me = await login(USER);
    const view = (await me.get(LIFE_ROUTES.shop)).json();
    expect(Value.Check(ShopView, view)).toBe(true);
    expect(view.items.find((i: { id: string }) => i.id === 'insider_memo')).toBeUndefined();
    const k = key();
    const bought = (
      await me.post(LIFE_ROUTES.shopBuy, { idempotencyKey: k, itemId: 'title_rookie' })
    ).json();
    expect(bought).toMatchObject({
      replayed: false,
      itemId: 'title_rookie',
      price: 2000,
      balance: 1000,
    });
    const replay = (
      await me.post(LIFE_ROUTES.shopBuy, { idempotencyKey: k, itemId: 'title_rookie' })
    ).json();
    expect(replay).toMatchObject({ replayed: true, balance: 1000 });
    expect(ledger(USER, 'shop_buy')).toEqual([-2000]);
    // One copy at most.
    const dup = await me.post(LIFE_ROUTES.shopBuy, {
      idempotencyKey: key(),
      itemId: 'title_rookie',
    });
    expect(dup.json()).toMatchObject({ rule: 'already_owned' });
    // Too expensive.
    const dear = await me.post(LIFE_ROUTES.shopBuy, {
      idempotencyKey: key(),
      itemId: 'title_emperor',
    });
    expect(dear.statusCode).toBe(409);
    expect(dear.json()).toMatchObject({ error: 'insufficient_funds' });
    expect(ledger(USER, 'shop_buy')).toHaveLength(1);
  });

  it('sells black-market lots blind and seized goods at the aged price', async () => {
    server = createTestServer();
    const me = await login(USER);
    server.economy.ensureMember(GUILD, USER);
    const insert = server.store.db.prepare(
      `INSERT INTO teiai_market (guild_id, item_id, mode, black, qty, start_price, end_price, listed_at, expires_at)
       VALUES (?, ?, 'fixed', ?, 2, 500, 500, ?, ?)`,
    );
    const now = server.clock.now();
    insert.run(GUILD, 'carrot', 1, now - 1000, now + 3_600_000);
    server.store.db
      .prepare('INSERT INTO seized_items (guild_id, item_id, qty, listed_at) VALUES (?, ?, 1, ?)')
      .run(GUILD, 'carrot', now);
    // Mark today's market as planned, so the shop view adds no random lots of its own.
    server.store.db
      .prepare('INSERT INTO teiai_market_days (guild_id, day) VALUES (?, ?)')
      .run(GUILD, Math.floor(now / 86_400_000));
    const view = (await me.get(LIFE_ROUTES.shop)).json();
    const black = view.market.find((l: { black: boolean }) => l.black);
    expect(black).toMatchObject({ itemId: '?', price: 500 });
    expect(view.seized).toHaveLength(1);
    const got = (
      await me.post(LIFE_ROUTES.shopMarketBuy, { idempotencyKey: key(), lotId: black.id })
    ).json();
    expect(got.price).toBe(500);
    expect(got.itemId).not.toBe('?');
    expect(ledger(USER, 'teiai_market_buy')).toEqual([-500]);
    const lot = view.seized[0];
    const seized = (
      await me.post(LIFE_ROUTES.shopSeizedBuy, { idempotencyKey: key(), lotId: lot.id })
    ).json();
    expect(seized).toMatchObject({ itemId: 'carrot', price: lot.price });
    expect(ledger(USER, 'teiai_auction_buy')).toEqual([-lot.price]);
    const gone = await me.post(LIFE_ROUTES.shopSeizedBuy, { idempotencyKey: key(), lotId: lot.id });
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ rule: 'lot_gone' });
  });

  it('debtors cannot buy', async () => {
    server = createTestServer();
    const me = await login(USER);
    server.economy.ensureMember(GUILD, USER);
    server.finance.teiai.addDebtFromExcess(GUILD, USER, 500);
    const view = (await me.get(LIFE_ROUTES.shop)).json();
    expect(view.debt).toBe(500);
    const res = await me.post(LIFE_ROUTES.shopBuy, { idempotencyKey: key(), itemId: 'carrot' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'conflict', rule: 'debt_blocks' });
    expect(ledger(USER, 'shop_buy')).toEqual([]);
  });
});

describe('quiz', () => {
  const post = (me: Awaited<ReturnType<typeof login>>, over: object = {}) =>
    me.post(LIFE_ROUTES.quizPost, {
      idempotencyKey: key(),
      question: 'Capital of Japan?',
      choices: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'],
      reward: 100,
      ...over,
    });

  it('an author posts, another player answers, the reward moves through the ledger', async () => {
    server = createTestServer();
    const author = await login(USER);
    const reader = await login(OTHER_USER);
    server.store.db
      .prepare('INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, 5)')
      .run(GUILD, OTHER_USER);
    const posted = await post(author);
    expect(posted.statusCode).toBe(200);
    const mine = (await author.get(LIFE_ROUTES.quiz)).json();
    expect(Value.Check(QuizView, mine)).toBe(true);
    expect(mine.mine).toHaveLength(1);
    expect(mine.next).toBeNull();

    const quiz = (await reader.get(LIFE_ROUTES.quiz)).json();
    expect(quiz.next.question).toBe('Capital of Japan?');
    expect(quiz.next.choices).toHaveLength(4);
    const right = quiz.next.choices.indexOf('Tokyo');
    const k = key();
    const body = { idempotencyKey: k, quizId: quiz.next.id, choice: right };
    const first = (await reader.post(LIFE_ROUTES.quizAnswer, body)).json();
    expect(first).toMatchObject({ correct: true, reward: 100, answer: right, replayed: false });
    const again = (await reader.post(LIFE_ROUTES.quizAnswer, body)).json();
    expect(again).toMatchObject({ replayed: true, correct: true });
    expect(ledger(OTHER_USER, 'quiz_reward')).toEqual([100]);
    expect(ledger(USER, 'quiz_author_pay')).toEqual([-100]);
    // One try per question.
    const second = await reader.post(LIFE_ROUTES.quizAnswer, { ...body, idempotencyKey: key() });
    expect(second.json()).toMatchObject({ rule: 'quiz_already_answered' });
  });

  it('refuses a bad post with a rule and takes nothing', async () => {
    server = createTestServer();
    const me = await login(USER);
    const dup = await post(me, { choices: ['a', 'a', 'b', 'c'] });
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toMatchObject({ rule: 'choice_duplicate' });
    const dear = await post(me, { reward: 999_999 });
    expect(dear.json()).toMatchObject({ error: 'insufficient_funds' });
    expect((await me.get(LIFE_ROUTES.quiz)).json().mine).toEqual([]);
  });

  it('the author withdraws; a stranger cannot', async () => {
    server = createTestServer();
    const author = await login(USER);
    const other = await login(OTHER_USER);
    await post(author);
    const id = (await author.get(LIFE_ROUTES.quiz)).json().mine[0].id;
    const no = await other.post(LIFE_ROUTES.quizWithdraw, { idempotencyKey: key(), quizId: id });
    expect(no.statusCode).toBe(403);
    const ok = await author.post(LIFE_ROUTES.quizWithdraw, { idempotencyKey: key(), quizId: id });
    expect(ok.statusCode).toBe(200);
    expect((await author.get(LIFE_ROUTES.quiz)).json().mine).toEqual([]);
  });
});

describe('lottery', () => {
  it('shows the pool, buys one ticket per key and reports the draw', async () => {
    server = createTestServer();
    const a = await login(USER);
    const b = await login(OTHER_USER);
    expect((await a.get(LIFE_ROUTES.lottery)).json()).toMatchObject({ current: null, last: null });
    const raffle = server.games.lottery.host({
      guildId: GUILD,
      hostId: USER,
      fee: 500,
      minutes: 5,
    });
    const view = (await a.get(LIFE_ROUTES.lottery)).json();
    expect(Value.Check(LotteryView, view)).toBe(true);
    expect(view.current).toMatchObject({ id: raffle.id, fee: 500, pot: 0, joined: false });

    const k = key();
    const joined = (
      await a.post(LIFE_ROUTES.lotteryJoin, { idempotencyKey: k, raffleId: raffle.id })
    ).json();
    expect(joined).toMatchObject({ replayed: false, balance: 2500 });
    const replay = (
      await a.post(LIFE_ROUTES.lotteryJoin, { idempotencyKey: k, raffleId: raffle.id })
    ).json();
    expect(replay).toMatchObject({ replayed: true });
    const dupe = await a.post(LIFE_ROUTES.lotteryJoin, {
      idempotencyKey: key(),
      raffleId: raffle.id,
    });
    expect(dupe.json()).toMatchObject({ rule: 'raffle_already_joined' });
    await b.post(LIFE_ROUTES.lotteryJoin, { idempotencyKey: key(), raffleId: raffle.id });
    expect(ledger(USER, 'lottery_entry')).toEqual([-500]);
    expect((await a.get(LIFE_ROUTES.lottery)).json().current).toMatchObject({
      pot: 1000,
      entrantCount: 2,
      joined: true,
    });

    server.clock.advance(6 * 60_000);
    server.games.lottery.drawDue(GUILD);
    const after = (await a.get(LIFE_ROUTES.lottery)).json();
    expect(after.current).toBeNull();
    expect(after.last).toMatchObject({
      outcome: 'won',
      prize: 1000,
      entrantCount: 2,
      iEntered: true,
    });
    const prizes = [...ledger(USER, 'lottery_prize'), ...ledger(OTHER_USER, 'lottery_prize')];
    expect(prizes).toEqual([1000]);
  });
});

describe('polls', () => {
  it('creates, votes (changing a vote moves it) and reports the results', async () => {
    server = createTestServer();
    const a = await login(USER);
    const b = await login(OTHER_USER);
    const made = (
      await a.post(LIFE_ROUTES.pollCreate, { idempotencyKey: key(), title: 'Pizza?', minutes: 10 })
    ).json();
    expect(made.poll).toMatchObject({ title: 'Pizza?', mine: true, status: 'open', yes: 0, no: 0 });
    const id = made.poll.id;
    const k = key();
    const vote = (
      await b.post(LIFE_ROUTES.pollVote, { idempotencyKey: k, pollId: id, yes: true })
    ).json();
    expect(vote.poll).toMatchObject({ yes: 1, no: 0, myVote: 'yes', verdict: 'yes' });
    expect(
      (await b.post(LIFE_ROUTES.pollVote, { idempotencyKey: k, pollId: id, yes: true })).json()
        .replayed,
    ).toBe(true);
    const flip = (
      await b.post(LIFE_ROUTES.pollVote, { idempotencyKey: key(), pollId: id, yes: false })
    ).json();
    expect(flip.poll).toMatchObject({ yes: 0, no: 1, myVote: 'no' });
    const list = (await a.get(LIFE_ROUTES.polls)).json();
    expect(Value.Check(PollsView, list)).toBe(true);
    expect(list.polls[0]).toMatchObject({ id, myVote: null, voters: 1 });

    server.clock.advance(11 * 60_000);
    const closed = (await a.get(LIFE_ROUTES.polls)).json();
    expect(closed.polls[0]).toMatchObject({ status: 'closed', verdict: 'no' });
    const late = await b.post(LIFE_ROUTES.pollVote, {
      idempotencyKey: key(),
      pollId: id,
      yes: true,
    });
    expect(late.json()).toMatchObject({ rule: 'poll_closed' });
    const bad = await a.post(LIFE_ROUTES.pollCreate, { idempotencyKey: key(), title: '   ' });
    expect(bad.json()).toMatchObject({ rule: 'poll_title_invalid' });
  });
});

describe('missions and ranking', () => {
  it('lists the day roster with progress that follows the plays', async () => {
    server = createTestServer();
    const me = await login(USER);
    const view = (await me.get(LIFE_ROUTES.missions)).json();
    expect(Value.Check(MissionsView, view)).toBe(true);
    expect(view.missions).toHaveLength(3);
    expect(view.bonus).toBe(500);
    expect(view.resetAt).toBeGreaterThan(view.now);
    expect(view.missions.every((m: { done: boolean }) => !m.done)).toBe(true);
    for (let i = 0; i < 6; i++) {
      server.bus.publishDomain({
        type: 'GameSettled',
        guildId: GUILD,
        at: server.clock.now(),
        userId: USER,
        game: 'slots',
        roundId: `r${i}`,
        stake: 1000,
        payout: 0,
        net: -1000,
        source: 'activity',
      });
    }
    const after = (await me.get(LIFE_ROUTES.missions)).json();
    const progressed = after.missions.filter((m: { progress: number }) => m.progress > 0);
    expect(progressed.length).toBeGreaterThan(0);
  });

  it('ranks the week by net profit and marks who qualifies for the title', async () => {
    server = createTestServer();
    const me = await login(USER);
    await login(OTHER_USER);
    const publish = (userId: string, net: number, n: number) => {
      for (let i = 0; i < n; i++) {
        server.bus.publishDomain({
          type: 'GameSettled',
          guildId: GUILD,
          at: server.clock.now(),
          userId,
          game: 'slots',
          roundId: `${userId}-${i}-${net}`,
          stake: 100,
          payout: Math.max(0, 100 + net),
          net,
          source: 'activity',
        });
      }
    };
    publish(USER, 200, 5);
    publish(OTHER_USER, 900, 2);
    const view = (await me.get(LIFE_ROUTES.ranking)).json();
    expect(Value.Check(RankingView, view)).toBe(true);
    expect(view.rows.map((r: { userId: string }) => r.userId)).toEqual([OTHER_USER, USER]);
    expect(view.rows[0]).toMatchObject({ rank: 1, net: 1800, plays: 2, qualified: false });
    expect(view.rows[1]).toMatchObject({ rank: 2, net: 1000, plays: 5, qualified: true });
    expect(view.self).toMatchObject({ rank: 2, total: 2 });
    expect(view.minPlays).toBe(5);
  });
});

describe('transfer', () => {
  const seedGames = (userId: string, n: number) =>
    server.store.db
      .prepare(
        'INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET games_played = excluded.games_played',
      )
      .run(GUILD, userId, n);

  it('previews the fee, then sends once per key with the fee as its own ledger row', async () => {
    server = createTestServer();
    const me = await login(USER);
    await login(OTHER_USER);
    seedGames(USER, 3);
    const view = (await me.get(LIFE_ROUTES.transfer)).json();
    expect(Value.Check(TransferView, view)).toBe(true);
    expect(view).toMatchObject({ gamesPlayed: 3, dailyLimit: 20_000, feeBps: 1000 });

    const preview = (
      await me.post(LIFE_ROUTES.transferPreview, { receiverId: OTHER_USER, amount: 1001 })
    ).json();
    expect(preview).toMatchObject({
      ok: true,
      amount: 1001,
      fee: 101,
      total: 1102,
      needsConfirm: false,
    });
    expect(server.economy.getBalance(GUILD, USER)).toBe(3000);

    const k = key();
    const sent = (
      await me.post(LIFE_ROUTES.transferSend, {
        idempotencyKey: k,
        receiverId: OTHER_USER,
        amount: 1000,
      })
    ).json();
    expect(sent).toMatchObject({
      replayed: false,
      amount: 1000,
      fee: 100,
      received: 1000,
      balance: 1900,
    });
    const replay = (
      await me.post(LIFE_ROUTES.transferSend, {
        idempotencyKey: k,
        receiverId: OTHER_USER,
        amount: 1000,
      })
    ).json();
    expect(replay).toMatchObject({ replayed: true, balance: 1900 });
    expect(ledger(USER, 'transfer_out')).toEqual([-1000]);
    expect(ledger(USER, 'transfer_fee')).toEqual([-100]);
    expect(ledger(OTHER_USER, 'transfer_in')).toEqual([1000]);
    expect(server.economy.getBalance(GUILD, OTHER_USER)).toBe(4000);
    expect((await me.get(LIFE_ROUTES.transfer)).json().sentToday).toBe(1000);
  });

  it('applies the limits: min games, daily limit, balance, self, unknown member', async () => {
    server = createTestServer();
    const me = await login(USER);
    await login(OTHER_USER);
    const send = (amount: number, receiverId = OTHER_USER) =>
      me.post(LIFE_ROUTES.transferSend, { idempotencyKey: key(), receiverId, amount });
    expect((await send(100)).json()).toMatchObject({
      rule: 'transfer_min_games',
      params: { min_games: 3 },
    });
    seedGames(USER, 3);
    expect((await send(100, USER)).json()).toMatchObject({ rule: 'transfer_self' });
    expect((await send(100, '999999999999999999')).json()).toMatchObject({
      rule: 'transfer_unknown_member',
    });
    expect((await send(20_001)).json()).toMatchObject({ rule: 'transfer_daily_limit' });
    const broke = await send(2800);
    expect(broke.statusCode).toBe(409);
    expect(broke.json()).toMatchObject({
      error: 'insufficient_funds',
      rule: 'transfer_insufficient_balance',
    });
    const preview = (
      await me.post(LIFE_ROUTES.transferPreview, { receiverId: OTHER_USER, amount: 20_001 })
    ).json();
    expect(preview).toMatchObject({ ok: false, rule: 'transfer_daily_limit' });
    expect(ledger(USER, 'transfer_out')).toEqual([]);
  });

  it('searches the guild members by name, leaving the caller out', async () => {
    server = createTestServer();
    const me = await login(USER);
    await login(OTHER_USER);
    const all = (await me.get(`${LIFE_ROUTES.transferMembers}?q=`)).json();
    expect(all.members.map((m: { userId: string }) => m.userId)).toEqual([OTHER_USER]);
    const hit = (await me.get(`${LIFE_ROUTES.transferMembers}?q=${OTHER_USER.slice(-3)}`)).json();
    expect(hit.members).toHaveLength(1);
    expect((await me.get(`${LIFE_ROUTES.transferMembers}?q=zzz`)).json().members).toEqual([]);
  });
});

describe('rate limit', () => {
  it('stops a flood of writes with 429 and a retry hint', async () => {
    server = createTestServer();
    const me = await login(USER);
    let last = 0;
    for (let i = 0; i < 160 && last !== 429; i++) {
      last = (await me.post(LIFE_ROUTES.workClick, { idempotencyKey: key() })).statusCode;
    }
    expect(last).toBe(429);
  });
});
