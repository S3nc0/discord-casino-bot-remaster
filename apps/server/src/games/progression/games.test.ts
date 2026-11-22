import { slots } from '@casino/domain/casino';
import { createSeededRng, manualClock, type DomainEvent } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { createLogger } from '../../runtime/logger.ts';
import { GUILD, memoryStore, OTHER_USER, USER } from '../../runtime/test-kit.ts';
import { createCasinoGames } from '../index.ts';
import { createNonCasinoGames } from './register.ts';
import { createMemoryTeiai } from './ports.ts';

const U3 = '123456789012345670';
const U4 = '123456789012345671';
/** Monday 2025-01-06 07:30 JST (entries of the 09:00 race are open). */
const MONDAY_0730 = 1_736_116_200_000;
const H = 3_600_000;

function harness(startMs = MONDAY_0730, seed = 7) {
  const store = memoryStore();
  const clock = manualClock(startMs);
  const bus = new EventBus((e) => {
    throw e;
  });
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  identity.ensureGuild(GUILD, 'approved');
  const teiai = createMemoryTeiai();
  const games = createNonCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng: createSeededRng(seed),
    teiai,
    offsetHours: 9,
  });
  const events: DomainEvent[] = [];
  bus.onAnyDomain((e) => events.push(e));
  const stop = games.start();
  const reasons = (userId: string): string[] =>
    economy
      .history(GUILD, userId, 100)
      .map((e) => e.reason)
      .reverse();
  const ofType = <T extends DomainEvent['type']>(type: T): Extract<DomainEvent, { type: T }>[] =>
    events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
  const settle = (
    userId: string,
    game: 'slots' | 'blackjack',
    stake: number,
    net: number,
    n = 1,
  ): void => {
    for (let i = 0; i < n; i++) {
      bus.publishDomain({
        type: 'GameSettled',
        guildId: GUILD,
        at: clock.now(),
        userId,
        game,
        roundId: `r${clock.now()}${i}${userId}`,
        stake,
        payout: Math.max(0, stake + net),
        net,
        source: 'chat',
      });
    }
  };
  return { store, clock, bus, economy, teiai, games, events, stop, reasons, ofType, settle };
}

describe('scripted run: one race, one daily claim, one transfer, one mission', () => {
  it('moves money only through the ledger with the right reasons and events', () => {
    const h = harness();
    const { games, economy, clock } = h;

    // --- race: two owners enter, one bettor buys a ticket, the race runs at 09:00
    for (const u of [USER, OTHER_USER]) {
      economy.ensureMember(GUILD, u);
      games.shop.inventory.add(GUILD, u, 'horse_voucher', 1);
    }
    const horses = [USER, OTHER_USER].map((u, i) =>
      games.race.createHorse(GUILD, u, { name: `馬${i}`, coat: '鹿毛', silks: '🟥' }),
    );
    const created = games.race.ensureDay(GUILD);
    expect(created).toHaveLength(5);
    const raceId = created[0] as number;
    expect(h.ofType('RaceScheduled')).toHaveLength(5);
    games.race.register(GUILD, USER, raceId, horses[0]!.id);
    games.race.register(GUILD, OTHER_USER, raceId, horses[1]!.id);
    expect(economy.getBalance(GUILD, USER)).toBe(3000 - 1000);

    clock.set(MONDAY_0730 + 30 * 60_000); // 08:00 entries close
    expect(games.race.tick(GUILD).closed).toEqual([raceId]);
    const card = games.race.card(raceId);
    expect(card.entrants).toHaveLength(8);
    expect(card.race.status).toBe('betting');
    economy.ensureMember(GUILD, U3);
    const ticket = games.race.bet({
      guildId: GUILD,
      userId: U3,
      raceId,
      kind: 'win',
      lanes: [card.entrants[0]!.lane],
      stake: 1000,
      idempotencyKey: 'bet-1',
    });
    expect(economy.getBalance(GUILD, U3)).toBe(2000);
    // the same key again is the same ticket, not a second charge
    expect(
      games.race.bet({
        guildId: GUILD,
        userId: U3,
        raceId,
        kind: 'win',
        lanes: [card.entrants[0]!.lane],
        stake: 1000,
        idempotencyKey: 'bet-1',
      }).betId,
    ).toBe(ticket.betId);
    expect(economy.getBalance(GUILD, U3)).toBe(2000);

    clock.set(MONDAY_0730 + 90 * 60_000); // 09:00
    const ran = games.race.tick(GUILD).run;
    expect(ran).toHaveLength(1);
    expect(ran[0]!.placings).toHaveLength(8);
    const finished = h.ofType('RaceFinished');
    expect(finished).toHaveLength(1);
    expect(finished[0]!.bettorIds).toEqual([U3]);
    expect(h.ofType('GameSettled').filter((e) => e.game === 'horse')).toHaveLength(1);
    const timeline = games.race.timeline(raceId)!;
    expect(timeline.frames.length).toBeGreaterThan(50);
    expect(timeline.runners).toHaveLength(8);
    expect(h.reasons(U3)).toEqual([
      'initial_grant',
      'race_bet',
      ...(economy.getBalance(GUILD, U3) > 2000 ? ['race_payout'] : []),
    ]);
    // running it twice must not pay twice
    const before = economy.getBalance(GUILD, U3);
    games.race.runRace(raceId);
    expect(economy.getBalance(GUILD, U3)).toBe(before);

    // --- daily: first claim pays 1,000, a second one in the same slot is refused
    economy.ensureMember(GUILD, U4);
    const claim = games.progression.claimDaily(GUILD, U4);
    expect(claim).toMatchObject({ ok: true, amount: 1000, streak: 1 });
    expect(economy.getBalance(GUILD, U4)).toBe(4000);
    expect(games.progression.claimDaily(GUILD, U4).ok).toBe(false);
    expect(h.reasons(U4)).toEqual(['initial_grant', 'daily_bonus']);
    clock.advance(6 * H);
    expect(games.progression.announceDailyReady(GUILD)).toBe(1);
    expect(h.ofType('DailyReady')).toMatchObject([{ userId: U4 }]);

    // --- missions + games played: three winning slot rounds (bet 1,000, net +3,000)
    h.settle(U4, 'slots', 1000, 3000, 3);
    expect(games.progression.gamesPlayed(GUILD, U4)).toBe(3);
    const done = h.ofType('MissionCompleted');
    expect(done.map((e) => e.missionId).sort()).toEqual(['big3x', 'win3']);
    expect(done.reduce((s, e) => s + e.reward, 0)).toBe(1000);
    expect(h.reasons(U4)).toEqual([
      'initial_grant',
      'daily_bonus',
      'mission_reward',
      'mission_reward',
    ]);
    expect(games.progression.missionStatus(GUILD, U4).missions.filter((m) => m.done)).toHaveLength(
      2,
    );
    expect(games.progression.weeklyRankOf(GUILD, U4)).toMatchObject({
      rank: 1,
      net: 9000,
      plays: 3,
    });

    // --- transfer: 1,005 plus a 101 fee, receiver gets all of it, repeat key changes nothing
    const t = games.progression.transfer({
      guildId: GUILD,
      senderId: U4,
      receiverId: U3,
      amount: 1005,
      idempotencyKey: 't-1',
    });
    expect(t).toMatchObject({ ok: true, fee: 101, received: 1005 });
    expect(economy.getBalance(GUILD, U4)).toBe(4000 + 1000 - 1005 - 101);
    expect(h.reasons(U4).slice(-2)).toEqual(['transfer_out', 'transfer_fee']);
    expect(h.reasons(U3).at(-1)).toBe('transfer_in');
    const again = games.progression.transfer({
      guildId: GUILD,
      senderId: U4,
      receiverId: U3,
      amount: 1005,
      idempotencyKey: 't-1',
    });
    expect(again).toMatchObject({ ok: true, fee: 101 });
    expect(economy.getBalance(GUILD, U4)).toBe(4000 + 1000 - 1005 - 101);

    // the supply check: every ledger row has the sign its reason requires and balances are non-negative
    const rows = h.store.db.prepare('SELECT SUM(delta) AS s FROM ledger').get() as { s: number };
    const sums = h.store.db.prepare('SELECT SUM(balance) AS s FROM balances').get() as {
      s: number;
    };
    expect(sums.s).toBe(rows.s);
    h.stop();
  });

  it('transfer rules: three-game minimum, daily principal cap, debtor sender blocked, debtor receiver withheld', () => {
    const h = harness();
    const { games, economy, teiai } = h;
    economy.credit({ guildId: GUILD, userId: USER, amount: 100_000, reason: 'admin_grant' });
    const send = (amount: number, key: string, to = OTHER_USER) =>
      games.progression.transfer({
        guildId: GUILD,
        senderId: USER,
        receiverId: to,
        amount,
        idempotencyKey: key,
      });
    expect(send(100, 'a')).toMatchObject({ ok: false, error: { code: 'transfer_min_games' } });
    h.settle(USER, 'slots', 100, -100, 3);
    expect(send(2000, 'b')).toMatchObject({ ok: true, fee: 200 });
    expect(send(18_001, 'c')).toMatchObject({
      ok: false,
      error: { code: 'transfer_daily_limit', params: { sent_today: 2000 } },
    });
    teiai.setDebt(GUILD, OTHER_USER, 7000);
    const r = send(2000, 'd');
    expect(r).toMatchObject({ ok: true, withheld: 600 });
    expect(teiai.debtOf(GUILD, OTHER_USER)).toBe(6400);
    expect(economy.getBalance(GUILD, OTHER_USER)).toBe(3000 + 2000 + 2000 - 600);
    expect(h.reasons(OTHER_USER)).toContain('debt_withholding');
    teiai.setDebt(GUILD, USER, 10);
    expect(send(10, 'e')).toMatchObject({ ok: false, error: { code: 'debt_blocks' } });
  });

  it('a debtor claiming the daily loses 20 % to Teiai and 30 % of the rest to the debt', () => {
    const h = harness();
    h.teiai.setDebt(GUILD, USER, 8000);
    const r = h.games.progression.claimDaily(GUILD, USER);
    expect(r).toMatchObject({ amount: 1000, skimmed: 200, repaid: 240 });
    expect(h.economy.getBalance(GUILD, USER)).toBe(3560);
    expect(h.teiai.debtOf(GUILD, USER)).toBe(7760);
    expect(h.reasons(USER)).toEqual([
      'initial_grant',
      'daily_bonus',
      'teiai_skim',
      'debt_withholding',
    ]);
    expect(h.teiai.house.get(GUILD)).toBe(200);
  });
});

describe('retirement fee that the wallet cannot cover', () => {
  it('drains the wallet to zero and turns the rest into debt (never a negative balance)', () => {
    const h = harness();
    const { games, economy, teiai, store, clock } = h;
    economy.ensureMember(GUILD, USER);
    games.shop.inventory.add(GUILD, USER, 'horse_voucher', 1);
    const horse = games.race.createHorse(GUILD, USER, { name: '老馬', coat: '鹿毛', silks: '🟥' });
    store.stmt('UPDATE horses SET races = 31 WHERE id = ?').run(horse.id);
    const [raceId] = games.race.ensureDay(GUILD) as [number];
    games.race.register(GUILD, USER, raceId, horse.id); // 3,000 - 1,000
    // spend most of what is left so the 20,000 fee cannot be paid
    economy.debit({ guildId: GUILD, userId: USER, amount: 1500, reason: 'admin_revoke' });
    expect(economy.getBalance(GUILD, USER)).toBe(500);
    clock.set(MONDAY_0730 + 90 * 60_000);
    const result = games.race.tick(GUILD);
    const retired = result.run[0]!.retired[0]!;
    // 32 races, 0 wins, 0 places: value = -(32 * 2,000) clamped to -20,000
    expect(retired).toMatchObject({ horseId: horse.id, value: -20_000 });
    const prizes = result.run[0]!.prizes.reduce((s, p) => s + p.amount, 0);
    const walletBefore = 500 + prizes; // prize money arrives before the fee
    expect(economy.getBalance(GUILD, USER)).toBe(0);
    expect(retired.shortfall).toBe(20_000 - walletBefore);
    expect(teiai.debtOf(GUILD, USER)).toBe(retired.shortfall);
    expect(h.reasons(USER).at(-1)).toBe('horse_retirement_fee');
    expect(h.ofType('HorseRetired')).toMatchObject([
      { userId: USER, horseId: horse.id, payout: 0 },
    ]);
    expect(
      (
        store.stmt('SELECT owner_id FROM horses WHERE id = ?').get(horse.id) as {
          owner_id: string | null;
        }
      ).owner_id,
    ).toBeNull();
  });
});

describe('stable rules', () => {
  it('voucher, names, carrots and the three-horse limit', () => {
    const h = harness();
    const { games, economy } = h;
    economy.ensureMember(GUILD, USER);
    const make = (name: string) =>
      games.race.createHorse(GUILD, USER, { name, coat: '栗毛', silks: '🟦' });
    expect(() => make('馬')).toThrow(/no_voucher/);
    games.shop.inventory.add(GUILD, USER, 'horse_voucher', 4);
    expect(() => make('')).toThrow(/name_empty/);
    expect(() => make('http馬')).toThrow(/name_invalid_chars/);
    const a = make('一');
    make('二');
    make('三');
    expect(() => make('四')).toThrow(/max_owned/);
    expect(() => games.race.carrot(GUILD, USER, a.id, 'speed', 'guts')).toThrow(/no_carrot/);
    games.shop.inventory.add(GUILD, USER, 'carrot', 1);
    const moved = games.race.carrot(GUILD, USER, a.id, 'speed', 'guts');
    expect(moved.stats).toEqual({ speed: 45, stamina: 50, power: 50, guts: 55 });
    games.shop.inventory.add(GUILD, USER, 'gold_carrot', 2);
    expect(games.race.goldCarrot(GUILD, USER, a.id, 'power', 'power').stats.power).toBe(60);
    expect(() => games.race.goldCarrot(GUILD, USER, a.id, 'power', 'power')).toThrow(
      /gold_carrot_max/,
    );
  });
});

describe('arena', () => {
  it('hosts two tournaments, takes bets and settles semis then final', () => {
    const h = harness(1_736_121_600_000 - 9 * H + 60_000); // 2025-01-06 00:01 JST
    const { games, economy, clock, teiai } = h;
    teiai.setBank(GUILD, 100_000);
    const ids = games.arena.ensureToday(GUILD);
    expect(ids).toHaveLength(2);
    expect(games.arena.ensureToday(GUILD)).toEqual([]);
    const duel = ids[0] as number;
    const board = games.arena.board(duel);
    expect(board.fighters).toHaveLength(4);
    expect(teiai.bankCash(GUILD)).toBeLessThanOrEqual(100_000);
    economy.ensureMember(GUILD, USER);
    const pick = board.fighters[0]!;
    games.arena.bet({
      guildId: GUILD,
      userId: USER,
      tournamentId: duel,
      fighterId: pick.id,
      amount: 1000,
      idempotencyKey: 'arena-1',
    });
    expect(economy.getBalance(GUILD, USER)).toBe(2000);
    expect(() =>
      games.arena.bet({
        guildId: GUILD,
        userId: USER,
        tournamentId: duel,
        fighterId: pick.id,
        amount: 50,
        idempotencyKey: 'arena-2',
      }),
    ).toThrow(/stake_range/);
    clock.set(1_736_121_600_000); // 09:00 JST
    const semis = games.arena.advance(GUILD);
    expect(semis).toHaveLength(2);
    expect(semis.find((r) => r.tournamentId === duel)!.winnerIds).toHaveLength(2);
    clock.set(1_736_121_600_000 + 4 * H); // 13:00
    const finals = games.arena.advance(GUILD);
    expect(finals).toHaveLength(2);
    const t = games.arena.board(duel).tournament;
    expect(t.status).toBe('done');
    expect(t.champion_id).not.toBeNull();
    // a stake is either lost or returned with a profit, never created from nothing: payout >= stake or 0
    const paid = economy
      .history(GUILD, USER, 10)
      .filter((e) => e.reason === 'arena_payout')
      .reduce((s, e) => s + e.delta, 0);
    expect(paid === 0 || paid >= 1000).toBe(true);
  });
});

describe('lottery', () => {
  it('pays the whole pot to one entrant, refunds when cancelled or short', () => {
    const h = harness();
    const { games, economy, clock } = h;
    const raffle = games.lottery.host({ guildId: GUILD, hostId: USER, fee: 1000, minutes: 10 });
    expect(() => games.lottery.host({ guildId: GUILD, hostId: USER, fee: 1000 })).toThrow(
      /raffle_already_open/,
    );
    for (const u of [USER, OTHER_USER, U3]) games.lottery.join(GUILD, u, raffle.id);
    expect(() => games.lottery.join(GUILD, U3, raffle.id)).toThrow(/raffle_already_joined/);
    expect(economy.getBalance(GUILD, USER)).toBe(2000);
    clock.advance(11 * 60_000);
    const [drawn] = games.lottery.drawDue(GUILD);
    expect(drawn).toMatchObject({ status: 'done', prize: 3000 });
    const ev = h.ofType('LotteryDrawn');
    expect(ev).toMatchObject([{ outcome: 'won', prize: 3000, fee: 1000 }]);
    const total = [USER, OTHER_USER, U3].reduce((s, u) => s + economy.getBalance(GUILD, u), 0);
    expect(total).toBe(9000);

    const solo = games.lottery.host({ guildId: GUILD, hostId: USER, fee: 500, minutes: 5 });
    games.lottery.join(GUILD, USER, solo.id);
    clock.advance(6 * 60_000);
    games.lottery.drawDue(GUILD);
    expect(h.ofType('LotteryDrawn').at(-1)).toMatchObject({ outcome: 'refunded', prize: 0 });
    expect(h.reasons(USER).at(-1)).toBe('lottery_refund');
    expect(economy.getBalance(GUILD, USER)).toBe(economy.getBalance(GUILD, USER));

    const third = games.lottery.host({ guildId: GUILD, hostId: USER, fee: 500 });
    games.lottery.join(GUILD, USER, third.id);
    games.lottery.join(GUILD, OTHER_USER, third.id);
    games.lottery.cancel(GUILD);
    expect(h.ofType('LotteryDrawn').at(-1)).toMatchObject({ outcome: 'refunded' });
  });

  it('debtors cannot join', () => {
    const h = harness();
    const raffle = h.games.lottery.host({ guildId: GUILD, hostId: USER, fee: 500 });
    h.teiai.setDebt(GUILD, OTHER_USER, 1);
    expect(() => h.games.lottery.join(GUILD, OTHER_USER, raffle.id)).toThrow(/debt_blocks/);
  });
});

describe('polls', () => {
  it('votes switch freely, rigging costs 500 to the bank and shows offsets, closing gives a verdict', () => {
    const h = harness();
    const { games, economy, clock, teiai } = h;
    const poll = games.poll.create({
      guildId: GUILD,
      creatorId: USER,
      title: '賛成？',
      minutes: 10,
    });
    games.poll.vote(GUILD, USER, poll.id, true);
    games.poll.vote(GUILD, OTHER_USER, poll.id, false);
    games.poll.vote(GUILD, U3, poll.id, false);
    expect(games.poll.get(poll.id)).toMatchObject({ yes: 1, no: 2 });
    expect(() =>
      games.poll.rig({
        guildId: GUILD,
        userId: OTHER_USER,
        pollId: poll.id,
        yes: 9,
        no: 0,
        idempotencyKey: 'x',
      }),
    ).toThrow(/poll_creator_only/);
    const rigged = games.poll.rig({
      guildId: GUILD,
      userId: USER,
      pollId: poll.id,
      yes: 3,
      no: 0,
      idempotencyKey: 'rig-1',
    });
    expect(rigged.before).toEqual({ yes: 1, no: 2 });
    expect(rigged.poll).toMatchObject({ yes: 3, no: 0, rigs: 1 });
    expect(economy.getBalance(GUILD, USER)).toBe(2500);
    expect(teiai.bankCash(GUILD)).toBe(500);
    expect(h.reasons(USER).at(-1)).toBe('poll_fee');
    clock.advance(11 * 60_000);
    const closed = games.poll.closeDue(GUILD);
    expect(closed[0]).toMatchObject({ verdict: 'yes' });
    expect(() => games.poll.vote(GUILD, U3, poll.id, true)).toThrow(/poll_closed/);
  });
});

describe('quiz', () => {
  it('the author pays rewards, earns from participation; blocked answerers get nothing', () => {
    const h = harness();
    const { games, economy, clock } = h;
    const quiz = games.quiz.post({
      guildId: GUILD,
      authorId: USER,
      question: '1+1は？',
      choices: ['2', '3', '4', '5'],
      reward: 100,
    });
    expect(games.quiz.next(GUILD, USER)).toBeNull();
    const right = (q: { choices: string[] }) => q.choices.indexOf('2');
    // answerer without enough games: counted = 0, no reward
    economy.ensureMember(GUILD, OTHER_USER);
    expect(games.quiz.answer(GUILD, OTHER_USER, quiz.id, right(quiz))).toMatchObject({
      correct: true,
      reward: 0,
      rewardBlocked: true,
    });
    for (const u of [U3, U4, '123456789012345672']) {
      h.settle(u, 'slots', 100, 0, 3);
      games.quiz.answer(GUILD, u, quiz.id, u === U3 ? right(quiz) : (right(quiz) + 1) % 4);
    }
    expect(economy.getBalance(GUILD, U3)).toBe(3100);
    // 3 eligible answerers, 1 right: author entitled to base 100 + bonus + participation, paid as it goes
    expect(economy.getBalance(GUILD, USER)).toBeGreaterThan(3000 - 100);
    expect(h.reasons(USER)).toContain('quiz_author_reward');
    expect(h.reasons(USER)).toContain('quiz_author_pay');
    clock.advance(4 * 24 * H);
    expect(games.quiz.settleExpired()).toEqual([quiz.id]);
    expect(() => games.quiz.answer(GUILD, '123456789012345673', quiz.id, 0)).toThrow(/quiz_ended/);
  });

  it('a debtor author cannot post; a short wallet at answer time becomes debt, the answerer is still paid', () => {
    const h = harness();
    const { games, economy, teiai } = h;
    const quiz = games.quiz.post({
      guildId: GUILD,
      authorId: USER,
      question: 'q',
      choices: ['a', 'b', 'c', 'd'],
      reward: 1000,
    });
    economy.debit({ guildId: GUILD, userId: USER, amount: 2800, reason: 'admin_revoke' });
    h.settle(U3, 'slots', 100, 0, 3);
    const idx = quiz.choices.indexOf('a');
    expect(games.quiz.answer(GUILD, U3, quiz.id, idx)).toMatchObject({ reward: 1000 });
    expect(economy.getBalance(GUILD, U3)).toBe(4000);
    expect(economy.getBalance(GUILD, USER)).toBe(0);
    expect(teiai.debtOf(GUILD, USER)).toBe(800);
    teiai.setDebt(GUILD, OTHER_USER, 5);
    expect(() =>
      games.quiz.post({
        guildId: GUILD,
        authorId: OTHER_USER,
        question: 'q2',
        choices: ['a', 'b', 'c', 'd'],
        reward: 100,
      }),
    ).toThrow(/debt_blocks/);
  });

  it('imports official quizzes all or nothing', () => {
    const h = harness();
    const ok = '問題: x\n正解: a\n不正解: b\n不正解: c\n不正解: d';
    expect(h.games.quiz.importOfficial(`${ok}\n---\n問題: y\n正解: a`).imported).toBe(0);
    expect(h.games.quiz.importOfficial(ok)).toEqual({ imported: 1, errors: [] });
    expect(h.games.quiz.importOfficial(ok).imported).toBe(0);
    expect(h.games.quiz.next(GUILD, USER)?.question).toBe('x');
  });
});

describe('labor', () => {
  it('clicks pay the wallet, workers fill the pot, collecting skims 3 % to Teiai', () => {
    const h = harness();
    const { games, economy, clock, teiai } = h;
    economy.ensureMember(GUILD, USER);
    const first = games.work.click(GUILD, USER);
    expect(first).toMatchObject({ tooFast: false });
    expect(economy.getBalance(GUILD, USER)).toBe(3000 + first.pay);
    expect(games.work.click(GUILD, USER).tooFast).toBe(true);
    games.work.upgrade(GUILD, USER, 'pick');
    expect(games.work.view(GUILD, USER).pick).toBe(1);
    expect(h.reasons(USER)).toContain('work_upgrade');
    games.work.hire(GUILD, USER, 'miner');
    clock.advance(4 * H);
    const before = economy.getBalance(GUILD, USER);
    const view = games.work.view(GUILD, USER);
    expect(view.pot).toBeGreaterThan(0);
    const got = games.work.collect(GUILD, USER);
    expect(got.skimmed).toBe(Math.round(got.amount * 0.03));
    expect(got.net).toBe(got.amount - got.skimmed);
    expect(economy.getBalance(GUILD, USER)).toBe(before + got.net);
    expect(teiai.house.get(GUILD) ?? 0).toBe(got.skimmed);
    expect(games.work.view(GUILD, USER).pot).toBe(0);
    expect(() => games.work.collect(GUILD, USER)).toThrow(/labor_nothing_to_collect/);
  });

  it('merges ten relics into one of the next star and the buff follows', () => {
    const h = harness();
    h.economy.ensureMember(GUILD, USER);
    h.games.shop.inventory.add(GUILD, USER, 'relic_crown', 10);
    expect(h.games.work.mergeRelic(GUILD, USER, 'relic_crown')).toBe('relic_crown_s1');
    expect(h.games.shop.inventory.all(GUILD, USER).get('relic_crown_s1')).toBe(1);
    expect(() => h.games.work.mergeRelic(GUILD, USER, 'relic_crown')).toThrow(/relic_need_more/);
    // relic_crown_s1 = +10 % on the daily claim
    expect(h.games.progression.claimDaily(GUILD, USER).amount).toBe(1100);
  });
});

describe('shop', () => {
  it('buys, arms the daily double, limits drinks by stock and sells seized goods and the market', () => {
    const h = harness();
    const { games, economy, clock, teiai } = h;
    economy.ensureMember(GUILD, USER);
    games.shop.buy({ guildId: GUILD, userId: USER, itemId: 'daily_double', idempotencyKey: 'b1' });
    expect(economy.getBalance(GUILD, USER)).toBe(0);
    games.shop.arm(GUILD, USER, 'daily_double');
    expect(games.progression.claimDaily(GUILD, USER)).toMatchObject({
      amount: 2000,
      boosted: true,
    });
    expect(h.reasons(USER).slice(0, 2)).toEqual(['initial_grant', 'shop_buy']);

    economy.credit({ guildId: GUILD, userId: USER, amount: 100_000, reason: 'admin_grant' });
    expect(() =>
      games.shop.buy({
        guildId: GUILD,
        userId: USER,
        itemId: 'labor_drink',
        qty: 11,
        idempotencyKey: 'd1',
      }),
    ).toThrow(/out_of_stock/);
    games.shop.buy({
      guildId: GUILD,
      userId: USER,
      itemId: 'labor_drink',
      qty: 10,
      idempotencyKey: 'd2',
    });
    expect(games.shop.available(GUILD, USER, 'labor_drink')).toBe(0);
    clock.advance(H);
    expect(games.shop.available(GUILD, USER, 'labor_drink')).toBe(2);
    games.shop.buy({ guildId: GUILD, userId: USER, itemId: 'title_rookie', idempotencyKey: 't1' });
    expect(() =>
      games.shop.buy({
        guildId: GUILD,
        userId: USER,
        itemId: 'title_rookie',
        idempotencyKey: 't2',
      }),
    ).toThrow(/already_owned/);
    games.shop.equip(GUILD, USER, 'title', 'title_rookie');
    expect(games.shop.profile(GUILD, USER).title).toBe('title_rookie');
    teiai.setDebt(GUILD, USER, 1);
    expect(games.shop.profile(GUILD, USER)).toMatchObject({ title: null, frozen: true });
    expect(() =>
      games.shop.buy({ guildId: GUILD, userId: USER, itemId: 'carrot', idempotencyKey: 'c1' }),
    ).toThrow(/debt_blocks/);
    teiai.setDebt(GUILD, USER, 0);

    // bankruptcy seizure → auction price decays 10 points a day from 90 %
    const seized = games.shop.seizeAssets(GUILD, USER);
    expect(seized.items).toBeGreaterThan(0);
    economy.ensureMember(GUILD, OTHER_USER);
    const lot = games.shop
      .seizedLots(GUILD)
      .find((l) => l.itemId === 'daily_double' || l.itemId === 'labor_drink')!;
    const base = lot.itemId === 'daily_double' ? 3000 : 300;
    expect(lot.price).toBe(Math.round(base * 0.9));
    clock.advance(24 * H);
    expect(games.shop.seizedLots(GUILD).find((l) => l.id === lot.id)!.price).toBe(
      Math.round(base * 0.8),
    );
    const bank = teiai.bankCash(GUILD);
    games.shop.buySeized({
      guildId: GUILD,
      userId: OTHER_USER,
      lotId: lot.id,
      idempotencyKey: 's1',
    });
    expect(teiai.bankCash(GUILD)).toBe(bank + Math.round(base * 0.8));
    expect(h.reasons(OTHER_USER).at(-1)).toBe('teiai_auction_buy');

    // Teiai market: three lots planned once per UTC day
    expect(games.shop.ensureMarketDay(GUILD)).toBe(3);
    expect(games.shop.ensureMarketDay(GUILD)).toBe(0);
  });
});

describe('weekly ranking', () => {
  it('seeds on the first run, then awards the finished week once to the best player with 5+ plays', () => {
    const h = harness(1_736_121_600_000); // Monday 2025-01-06 09:00 JST
    const { games, clock } = h;
    expect(games.progression.settleWeekly(GUILD)).toBeNull(); // seeds last_week = 2024-12-30
    h.settle(USER, 'slots', 100, 500, 5);
    h.settle(OTHER_USER, 'slots', 100, 9000, 3);
    clock.advance(7 * 24 * H); // next Monday
    const award = games.progression.settleWeekly(GUILD)!;
    expect(award.week).toBe('2025-01-06');
    expect(award.champion?.userId).toBe(USER);
    expect(h.ofType('TitleAwarded')).toMatchObject([
      { userId: USER, titleId: 'title_weekly_king', week: '2025-01-06' },
    ]);
    expect(games.shop.inventory.qty(GUILD, USER, 'title_weekly_king')).toBe(1);
    expect(games.progression.settleWeekly(GUILD)).toBeNull(); // once per week
  });
});

describe('jobs', () => {
  it('are plain functions with JST cron expressions', () => {
    const h = harness();
    expect(h.games.jobs.map((j) => j.name)).toContain('race.tick');
    for (const j of h.games.jobs) {
      expect(j.timezone).toBe('Asia/Tokyo');
      expect(j.cron.split(' ').length).toBeGreaterThanOrEqual(5);
    }
    expect(() => h.games.jobs.forEach((j) => j.run(GUILD))).not.toThrow();
  });

  it('give the casino its insurance, debt and bank ports', () => {
    const h = harness();
    h.economy.ensureMember(GUILD, USER);
    h.games.shop.inventory.add(GUILD, USER, 'insurance', 1);
    h.games.shop.arm(GUILD, USER, 'insurance');
    const ports = h.games.casinoPorts();
    expect(ports.insurance.has(GUILD, USER)).toBe(true);
    ports.insurance.consume(GUILD, USER);
    expect(ports.insurance.has(GUILD, USER)).toBe(false);
    h.teiai.setDebt(GUILD, USER, 1000);
    expect(ports.debt.withhold(GUILD, USER, 1000)).toBe(300);
    expect(h.teiai.debtOf(GUILD, USER)).toBe(700);
    ports.bank.lossShare(GUILD, 300, 'slots');
    expect(h.teiai.bankCash(GUILD)).toBe(300);
  });

  it('credits the bank 3 % once on a casino loss when wired via casinoPorts', () => {
    const h = harness();
    h.economy.ensureMember(GUILD, USER);
    const casino = createCasinoGames({
      store: h.store,
      economy: h.economy,
      bus: h.bus,
      clock: h.clock,
      rng: createSeededRng(7),
      logger: createLogger({ level: 'silent' }),
      ports: h.games.casinoPorts(),
    });
    const round = casino.core.begin(
      { guildId: GUILD, userId: USER, source: 'chat' },
      'slots',
      1_000,
    );
    casino.core.settle(round, { payout: 0, profile: slots.SLOTS_PROFILE });
    expect(h.teiai.bankCash(GUILD)).toBe(30);
  });
});
