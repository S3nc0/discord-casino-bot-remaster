import { createSeededRng, type IntentAck } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../runtime/errors.ts';
import type { BlackjackView } from './blackjack.ts';
import type { ChinchiroView } from './chinchiro.ts';
import { GUILD, INSTANCE, OTHER_USER, USER, eventsOf, scriptedRng, setup } from './test-kit.ts';
import type { RoundSettled } from './types.ts';

const KEY = (n: number): string => `key-${String(n).padStart(16, '0')}`;
const fail = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
};

/** Sum of a player's ledger deltas for one round. */
const roundDelta = (s: ReturnType<typeof setup>, roundId: string, userId = USER): number =>
  s.economy
    .history(GUILD, userId, 100)
    .filter((e) => e.refId === roundId)
    .reduce((sum, e) => sum + e.delta, 0);

describe('slots', () => {
  it('pays 500x on three sevens, through the ledger, with events', () => {
    const s = setup({ rng: scriptedRng({ floats: [0.99, 0.99, 0.99] }) });
    const settled: RoundSettled[] = [];
    s.games.core.onSettled((r) => settled.push(r));
    const { response } = s.games.slots.play(s.caller(), { stake: 100, idempotencyKey: KEY(1) });
    expect(response.reels).toEqual(['7️⃣', '7️⃣', '7️⃣']);
    expect(response.settlement).toMatchObject({
      stake: 100,
      payout: 50_000,
      net: 49_900,
      tier: 'jackpot',
    });
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000 + 49_900);
    const rows = s.economy.history(GUILD, USER).filter((e) => e.refId === response.roundId);
    expect(rows.map((r) => [r.reason, r.delta]).sort()).toEqual([
      ['game_payout', 50_000],
      ['game_stake', -100],
    ]);
    expect(eventsOf(s.events, 'GameSettled')).toMatchObject([
      { userId: USER, game: 'slots', stake: 100, payout: 50_000, net: 49_900, source: 'chat' },
    ]);
    expect(eventsOf(s.events, 'BigWin')).toMatchObject([{ multiplierBps: 5_000_000 }]);
    expect(settled).toMatchObject([{ game: 'slots', tier: 'jackpot', net: 49_900 }]);
  });

  it('feeds the jackpot pool from a loss and pays the whole pool on a hit', () => {
    const s = setup({ rng: scriptedRng({ floats: [0.8, 0.7, 0.4] }) }); // 🔔 🍇 🍋: a miss
    const bank: number[] = [];
    s.games.core.ports.bank.lossShare = (_g, amount) => bank.push(amount);
    const miss = s.games.slots.play(s.caller(), { stake: 200 }).response;
    expect(miss.settlement).toMatchObject({ payout: 0, net: -200, jackpot: 0, jackpotPool: 10 });
    expect(s.games.core.jackpotPool(GUILD)).toBe(10);
    expect(bank).toEqual([6]);

    // Pool above the minimum and a rigged draw: the next loss takes it all.
    s.store.stmt('UPDATE jackpots SET pool = 20000 WHERE guild_id = ?').run(GUILD);
    s.clock.advance(2000);
    const rigged = setup({ rng: scriptedRng({ floats: [0.8, 0.7, 0.4, 0] }) });
    rigged.store
      .stmt('INSERT INTO jackpots (guild_id, pool, updated_at) VALUES (?, 20000, 0)')
      .run(GUILD);
    const hit = rigged.games.slots.play(rigged.caller(), { stake: 1000 }).response;
    expect(hit.settlement.jackpot).toBe(20_050);
    expect(hit.settlement.jackpotPool).toBe(0);
    expect(rigged.economy.getBalance(GUILD, USER)).toBe(3000 - 1000 + 20_050);
    expect(rigged.economy.history(GUILD, USER).some((e) => e.reason === 'jackpot_payout')).toBe(
      true,
    );
    expect(eventsOf(rigged.events, 'Jackpot')).toMatchObject([{ amount: 20_050, game: 'slots' }]);
  });

  it('replays an idempotency key without a second charge, and refuses a changed body', () => {
    const s = setup();
    const first = s.games.slots.play(s.caller(), { stake: 50, idempotencyKey: KEY(2) });
    const balance = s.economy.getBalance(GUILD, USER);
    const again = s.games.slots.play(s.caller(), { stake: 50, idempotencyKey: KEY(2) });
    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(s.economy.getBalance(GUILD, USER)).toBe(balance);
    expect(
      fail(() => s.games.slots.play(s.caller(), { stake: 60, idempotencyKey: KEY(2) })).code,
    ).toBe('conflict');
  });

  it('refuses small or unaffordable bets without leaving a lock, and a second game at once', () => {
    const s = setup();
    expect(fail(() => s.games.slots.play(s.caller(), { stake: 9 })).code).toBe('invalid_payload');
    expect(fail(() => s.games.slots.play(s.caller(), { stake: 3001 })).code).toBe(
      'insufficient_funds',
    );
    expect(s.games.core.sessions.isBusy(GUILD, USER)).toBe(false);
    s.games.slots.play(s.caller(), { stake: 10 });
    // The 1.5 s cooldown after a round.
    expect(fail(() => s.games.slots.play(s.caller(), { stake: 10 })).code).toBe('game_busy');
    s.clock.advance(1500);
    s.games.slots.play(s.caller(), { stake: 10 });
  });

  it('is off when the owner switched the game off', () => {
    const s = setup();
    s.store
      .stmt('INSERT INTO guild_features_off (guild_id, feature) VALUES (?, ?)')
      .run(GUILD, 'casino:slots');
    expect(fail(() => s.games.slots.play(s.caller(), { stake: 100 })).code).toBe(
      'feature_disabled',
    );
  });

  it('uses the guild RTP level', () => {
    const s = setup({ rng: scriptedRng({ floats: [0.99, 0.99, 0.99] }) });
    s.games.core.setRtpLevel(GUILD, 'slots', 6);
    const { response } = s.games.slots.play(s.caller(), { stake: 100 });
    // 500x raw = 50,000; level 6 stretches the 49,900 profit by 1.2114...
    expect(response.settlement.payout).toBeGreaterThan(50_000);
  });
});

describe('chinchiro', () => {
  it('plays a round: dealer first, player rolls up to three times, then pays', () => {
    // dealer 6-6-3 (me 3); player 1-3-5 (menashi), then 4-4-6 (me 6) wins.
    const s = setup({ rng: scriptedRng({ ints: [6, 6, 3, 1, 3, 5, 4, 4, 6] }) });
    const start = s.games.chinchiro.start(s.caller(), { stake: 100, idempotencyKey: KEY(3) });
    expect(start.response).toMatchObject({ status: 'player_turn', rollsLeft: 3, stake: 100 });
    expect(start.response.dealerRolls[0]?.hand).toEqual({ kind: 'me', value: 3 });
    const id = start.response.roundId;
    expect(s.economy.getBalance(GUILD, USER)).toBe(2900);

    const r1 = s.games.chinchiro.roll(s.caller(), { roundId: id, idempotencyKey: KEY(4) }).response;
    expect(r1).toMatchObject({ status: 'player_turn', rollsLeft: 2 });
    const r2 = s.games.chinchiro.roll(s.caller(), { roundId: id, idempotencyKey: KEY(5) }).response;
    expect(r2.status).toBe('settled');
    expect(r2.result).toMatchObject({ outcome: 'win', multiplier: 1, payout: 200, penalty: 0 });
    expect(s.economy.getBalance(GUILD, USER)).toBe(3100);
    expect(roundDelta(s, id)).toBe(100);
    // A third click on a finished round is stale.
    expect(fail(() => s.games.chinchiro.roll(s.caller(), { roundId: id })).code).toBe('conflict');
  });

  it('charges the multiplier penalty from cash and turns the shortfall into debt', () => {
    // dealer pinzoro (1-1-1); player menashi three times.
    const s = setup({ rng: scriptedRng({ ints: [1, 1, 1, 2, 4, 6, 2, 4, 6, 2, 4, 6] }) });
    const owed: [number, string][] = [];
    s.games.core.ports.debt.owe = (_g, _u, amount, why) => owed.push([amount, why]);
    const id = s.games.chinchiro.start(s.caller(), { stake: 1000 }).response.roundId;
    s.games.chinchiro.roll(s.caller(), { roundId: id });
    s.games.chinchiro.roll(s.caller(), { roundId: id });
    const end = s.games.chinchiro.roll(s.caller(), { roundId: id }).response;
    expect(end.result).toMatchObject({ outcome: 'lose', multiplier: 5, payout: 0, penalty: 4000 });
    // 3,000 - 1,000 stake = 2,000 left, all of it taken; 2,000 more is owed.
    expect(s.economy.getBalance(GUILD, USER)).toBe(0);
    expect(end.result?.settlement).toMatchObject({ net: -5000, penaltyShortfall: 2000 });
    expect(owed).toEqual([[2000, 'chinchiroの倍払い']]);
    const reasons = s.economy
      .history(GUILD, USER)
      .filter((e) => e.refId === id)
      .map((e) => e.reason);
    expect(reasons.sort()).toEqual(['game_penalty', 'game_stake']);
  });

  it('settles on timeout with the last roll, so leaving does not dodge a loss', () => {
    const s = setup({ rng: scriptedRng({ ints: [1, 1, 1] }) });
    const id = s.games.chinchiro.start(s.caller(), { stake: 100 }).response.roundId;
    s.timers.advance(60_000);
    expect(s.games.core.loadRound(id)?.status).toBe('settled');
    // Player counted as menashi against the dealer's pinzoro: stake lost plus 4x penalty.
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000 - 100 - 400);
    expect(s.games.chinchiro.current(s.caller())).toBeNull();
  });

  it("refuses to roll someone else's round", () => {
    const s = setup();
    const id = s.games.chinchiro.start(s.caller(), { stake: 100 }).response.roundId;
    expect(fail(() => s.games.chinchiro.roll(s.caller(OTHER_USER), { roundId: id })).code).toBe(
      'conflict',
    );
  });
});

describe('pachinko', () => {
  it('stakes bet x sets once, pays the aggregate and records the statistics', () => {
    const s = setup({ rng: createSeededRng(99) });
    const { response } = s.games.pachinko.play(s.caller(), {
      stake: 100,
      sets: 3,
      idempotencyKey: KEY(6),
    });
    expect(response.sets).toHaveLength(3);
    expect(response.settlement.stake).toBe(300);
    const rows = s.economy.history(GUILD, USER).filter((e) => e.refId === response.roundId);
    expect(rows.find((r) => r.reason === 'game_stake')?.delta).toBe(-300);
    expect(roundDelta(s, response.roundId)).toBe(response.settlement.net);
    const stored = s.store.db
      .prepare('SELECT COUNT(*) AS n FROM pachinko_sets WHERE round_id = ?')
      .get(response.roundId);
    expect(stored).toEqual({ n: 3 });
    const spins = s.store.db
      .prepare('SELECT COUNT(*) AS n FROM pachinko_spins WHERE round_id = ?')
      .get(response.roundId) as { n: number };
    expect(spins.n).toBe(response.sets.reduce((sum, set) => sum + set.starts, 0));
    expect(eventsOf(s.events, 'GameSettled')).toHaveLength(1);
  });

  it('clamps the set count to 10', () => {
    const s = setup({ rng: createSeededRng(5) });
    const { response } = s.games.pachinko.play(s.caller(), { stake: 10, sets: 50 });
    expect(response.sets).toHaveLength(10);
    expect(response.settlement.stake).toBe(100);
  });
});

describe('roulette', () => {
  it('runs a shared table: a betting window, one spin with a timeline, then payment', () => {
    // Pocket 17 (black, odd). Spin draws 17, then two decorative previews.
    const s = setup({ rng: scriptedRng({ ints: [17, 5, 30] }) });
    const alice = s.caller(USER, INSTANCE);
    const bob = s.caller(OTHER_USER, INSTANCE);
    const a = s.games.roulette.placeBet(alice, {
      stake: 300,
      bets: [
        { kind: 'black', targets: [], stake: 100 },
        { kind: 'number', targets: [17], stake: 200 },
      ],
      idempotencyKey: KEY(7),
    }).response;
    expect(a.deadline).toBeGreaterThan(0);
    s.games.roulette.placeBet(bob, {
      stake: 100,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
      roundId: a.tableRound,
    });
    expect(s.games.roulette.snapshot(GUILD, INSTANCE)).toMatchObject({
      phase: 'betting',
      roundId: a.tableRound,
    });
    // A late client holding another round id is refused.
    expect(
      fail(() => s.games.roulette.placeBet(bob, { stake: 10, kind: 'red', roundId: 'rlt_old' }))
        .code,
    ).toBe('conflict');

    s.timers.advance(20_000);
    const spinning = s.games.roulette.snapshot(GUILD, INSTANCE);
    expect(spinning.phase).toBe('spinning');
    expect(spinning.data).toMatchObject({ result: 17, color: 'black' });
    expect((spinning.data as { timeline: unknown[] }).timeline).toHaveLength(4);
    // Nobody is paid before the animation has played.
    expect(s.economy.getBalance(GUILD, USER)).toBe(2700);
    expect(fail(() => s.games.roulette.placeBet(alice, { stake: 10, kind: 'red' })).code).toBe(
      'conflict',
    );

    s.timers.advance(2700);
    const done = s.games.roulette.snapshot(GUILD, INSTANCE);
    expect(done.phase).toBe('result');
    // Alice: black 2x on 100 = 200, straight 36x on 200 = 7,200. Bob lost.
    expect(s.economy.getBalance(GUILD, USER)).toBe(2700 + 7400);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(2900);
    const settled = eventsOf(s.events, 'GameSettled');
    expect(settled.map((e) => [e.userId, e.net]).sort()).toEqual([
      [USER, 7100],
      [OTHER_USER, -100],
    ]);
    expect(settled.every((e) => e.game === 'roulette' && e.instanceId === INSTANCE)).toBe(true);
    // The room heard every change in order.
    const seqs = s.snapshots.filter((x) => x.game === 'roulette').map((x) => x.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(s.snapshots.map((x) => x.instanceId))).toEqual(
      new Set([`table:${INSTANCE}:roulette`]),
    );

    s.timers.advance(6000);
    expect(s.games.roulette.snapshot(GUILD, INSTANCE)).toMatchObject({
      phase: 'idle',
      roundId: null,
    });
    // The next round takes bets again.
    s.clock.advance(2000);
    expect(
      s.games.roulette.placeBet(alice, { stake: 10, kind: 'red' }).response.tableRound,
    ).not.toBe(a.tableRound);
  });

  it('validates the bet before any money moves', () => {
    const s = setup();
    const alice = s.caller(USER, INSTANCE);
    for (const bad of [
      { stake: 100, kind: 'number' }, // needs a number
      { stake: 100, kind: 'red', number: 5 }, // a number is not wanted
      { stake: 100, kind: 'number', number: 37 },
      { stake: 100, kind: 'split' },
      { stake: 100, bets: [{ kind: 'red', targets: [], stake: 50 }] }, // lines do not sum to the stake
      { stake: 5, kind: 'red' },
    ]) {
      expect(fail(() => s.games.roulette.placeBet(alice, bad)).code).toBe('invalid_payload');
    }
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
  });

  it('plays a solo spin for the chat: no room, paid at once', () => {
    const s = setup({ rng: scriptedRng({ ints: [0] }) });
    const { response } = s.games.roulette.playSolo(s.caller(), {
      stake: 100,
      kind: 'number',
      number: 0,
    });
    expect(response).toMatchObject({ result: 0, color: 'green', win: true });
    expect(response.settlement.payout).toBe(3600);
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000 - 100 + 3600);
    expect(s.snapshots).toHaveLength(0);
  });
});

describe('blackjack', () => {
  const view = (r: { response: BlackjackView }): BlackjackView => r.response;

  it('plays a solo hand to the end and the ledger matches the payout', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = setup({ rng: createSeededRng(seed) });
      let v = view(s.games.blackjack.startSolo(s.caller(), { stake: 100 }));
      const id = v.roundId;
      expect(v.shared).toBe(false);
      if (v.phase === 'player') {
        expect(v.dealer[1]).toBeNull(); // the hole card is hidden while a seat plays
        while (v.phase === 'player') {
          const act = (v.seats[0]?.value ?? 0) < 17 ? 'hit' : 'stand';
          v = view(s.games.blackjack[act](s.caller(), { roundId: id }));
        }
      }
      expect(v.phase).toBe('settled');
      expect(v.dealer.every((c) => c !== null)).toBe(true);
      const seat = v.seats[0]!;
      expect(seat.settlement?.payout).toBe(seat.payout);
      expect(roundDelta(s, id)).toBe(seat.settlement?.net);
      expect(s.economy.getBalance(GUILD, USER)).toBe(3000 + (seat.settlement?.net ?? 0));
      expect(eventsOf(s.events, 'GameSettled')).toHaveLength(1);
      expect(s.games.core.sessions.isBusy(GUILD, USER)).toBe(false);
    }
  });

  it('doubles: extra stake from cash, one card, then pays on the whole escrow', () => {
    let tested = 0;
    for (let seed = 1; seed <= 60 && tested < 5; seed++) {
      const s = setup({ rng: createSeededRng(seed) });
      const v = view(s.games.blackjack.startSolo(s.caller(), { stake: 100 }));
      if (v.phase !== 'player') continue;
      tested += 1;
      const done = view(
        s.games.blackjack.double(s.caller(), { roundId: v.roundId, idempotencyKey: KEY(8) }),
      );
      expect(done.phase).toBe('settled');
      const seat = done.seats[0]!;
      expect(seat).toMatchObject({ doubled: true, stake: 200 });
      expect(seat.cards).toHaveLength(3);
      const stakes = s.economy
        .history(GUILD, USER)
        .filter((e) => e.reason === 'game_stake')
        .map((e) => e.delta);
      expect(stakes.sort()).toEqual([-100, -100]);
      expect(roundDelta(s, v.roundId)).toBe(seat.settlement?.net);
    }
    expect(tested).toBeGreaterThan(0);
  });

  it('cannot double without the cash, unless Teiai lends', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = setup({ rng: createSeededRng(seed) });
      const v = view(s.games.blackjack.startSolo(s.caller(), { stake: 3000 }));
      if (v.phase !== 'player') continue;
      expect(fail(() => s.games.blackjack.double(s.caller(), { roundId: v.roundId })).code).toBe(
        'insufficient_funds',
      );
      expect(
        fail(() => s.games.blackjack.double(s.caller(), { roundId: v.roundId, credit: true })).code,
      ).toBe('insufficient_funds');
      // A credit port that lends (and posts its own ledger row) makes it work.
      s.games.core.ports.credit.borrowForDouble = (g, u, need) => {
        s.economy.credit({ guildId: g, userId: u, amount: need, reason: 'loan_borrow' });
        return true;
      };
      const done = view(s.games.blackjack.double(s.caller(), { roundId: v.roundId, credit: true }));
      expect(done.seats[0]).toMatchObject({ doubled: true, stake: 6000 });
      return;
    }
    throw new Error('no playable hand found');
  });

  it('seats several players at a shared table against one dealer, in turn', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup({ rng: createSeededRng(seed) });
      const alice = s.caller(USER, INSTANCE);
      const bob = s.caller(OTHER_USER, INSTANCE);
      const t = view(s.games.blackjack.bet(alice, { stake: 100 }));
      expect(t).toMatchObject({ shared: true, phase: 'betting' });
      view(s.games.blackjack.bet(bob, { stake: 200, roundId: t.roundId }));
      expect(fail(() => s.games.blackjack.bet(bob, { stake: 10 })).code).toBe('conflict'); // one seat each
      const dealt = view(s.games.blackjack.deal(alice, { roundId: t.roundId }));
      if (dealt.phase === 'settled') continue; // a natural ended the hand
      expect(dealt.phase).toBe('player');
      // Only the seat whose turn it is may act.
      const first = dealt.seats[dealt.turn]!;
      const other = first.userId === USER ? bob : alice;
      expect(fail(() => s.games.blackjack.stand(other, { roundId: t.roundId })).code).toBe(
        'conflict',
      );
      let v = dealt;
      while (v.phase === 'player') {
        const who = v.seats[v.turn]!;
        v = view(s.games.blackjack.stand(s.caller(who.userId, INSTANCE), { roundId: t.roundId }));
      }
      expect(v.phase).toBe('settled');
      expect(v.seats).toHaveLength(2);
      const net = v.seats.reduce((sum, seat) => sum + (seat.settlement?.net ?? 0), 0);
      expect(s.economy.getBalance(GUILD, USER) + s.economy.getBalance(GUILD, OTHER_USER)).toBe(
        6000 + net,
      );
      expect(eventsOf(s.events, 'GameSettled')).toHaveLength(2);
      // The table clears after its result window.
      s.timers.advance(8000);
      expect(s.games.blackjack.snapshot(GUILD, INSTANCE)).toMatchObject({
        phase: 'idle',
        roundId: null,
      });
      return;
    }
    throw new Error('no playable table found');
  });

  it('deals when the window closes and stands a seat that runs out of time', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup({ rng: createSeededRng(seed) });
      const alice = s.caller(USER, INSTANCE);
      const t = view(s.games.blackjack.bet(alice, { stake: 100 }));
      s.timers.advance(15_000);
      const snap = s.games.blackjack.snapshot(GUILD, INSTANCE);
      if (snap.phase === 'settled') continue;
      expect(snap.phase).toBe('player');
      expect(s.snapshots.some((x) => x.game === 'blackjack' && x.phase === 'player')).toBe(true);
      s.timers.advance(30_000);
      expect(s.games.blackjack.snapshot(GUILD, INSTANCE).phase).toBe('settled');
      expect(
        s.store.db.prepare('SELECT status FROM game_rounds WHERE table_round = ?').all(t.roundId),
      ).toEqual([{ status: 'settled' }]);
      return;
    }
    throw new Error('no playable table found');
  });
});

describe('ports', () => {
  it('applies the event boost, then insurance on a total loss, then withholds from income', () => {
    const consumed: string[] = [];
    const withheld: number[] = [];
    const s = setup({
      rng: scriptedRng({ floats: [0.99, 0.99, 0.99] }),
      ports: {
        eventBoost: () => 0.5,
        debt: {
          withhold: (_g, _u, income) => (withheld.push(income), Math.floor(income * 0.3)),
          owe: () => {},
        },
      },
    });
    const { response } = s.games.slots.play(s.caller(), { stake: 100 });
    // 50,000 payout; bonus = min(49,900 * 0.5, 10,000) = 10,000; income 59,900; 30 % withheld.
    expect(response.settlement).toMatchObject({
      eventBonus: 10_000,
      withheld: 17_970,
      payout: 60_000,
    });
    expect(withheld).toEqual([59_900]);
    const reasons = s.economy.history(GUILD, USER).map((e) => e.reason);
    expect(reasons).toContain('debt_withholding');

    const t = setup({
      rng: scriptedRng({ floats: [0.8, 0.7, 0.4] }),
      ports: { insurance: { has: () => true, consume: (_g, u) => consumed.push(u) } },
    });
    const lost = t.games.slots.play(t.caller(), { stake: 400 }).response;
    expect(lost.settlement).toMatchObject({ insured: 200, payout: 200, net: -200 });
    expect(consumed).toEqual([USER]);
    expect(t.economy.history(GUILD, USER).some((e) => e.reason === 'game_refund')).toBe(true);
  });
});

describe('crash recovery', () => {
  it('refunds every round still open at start-up, once', () => {
    const s = setup();
    const id = s.games.chinchiro.start(s.caller(), { stake: 500 }).response.roundId;
    expect(s.economy.getBalance(GUILD, USER)).toBe(2500);
    // A fresh process: same database, new services.
    const fresh = setup();
    fresh.store.db.exec('SELECT 1');
    expect(s.games.recover()).toBe(1);
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
    expect(s.games.core.loadRound(id)?.status).toBe('refunded');
    expect(s.games.recover()).toBe(0);
    expect(s.economy.history(GUILD, USER).filter((e) => e.reason === 'game_refund')).toHaveLength(
      1,
    );
  });
});

describe('every game, one round each, through the socket handlers', () => {
  it('plays chinchiro, slots, pachinko, blackjack and roulette and balances the ledger', () => {
    const s = setup({ rng: createSeededRng(2024) });
    const h = s.games.handlers;
    const scope = { userId: USER, guildId: GUILD, instanceId: INSTANCE };
    let n = 100;
    const bet = (
      game: 'chinchiro' | 'slots' | 'pachinko' | 'blackjack' | 'roulette',
      extra: object = {},
    ) => {
      s.clock.advance(2000);
      return h.bet!(scope, { idempotencyKey: KEY(n++), game, stake: 100, ...extra }) as {
        ok: boolean;
        balance: number;
        roundId?: string;
        result?: unknown;
        error?: string;
      };
    };
    const act = (game: 'chinchiro' | 'blackjack', roundId: string, action: string) =>
      h.action!(scope, { idempotencyKey: KEY(n++), game, roundId, action }) as {
        ok: boolean;
        result?: unknown;
        error?: string;
      };

    const slots = bet('slots');
    expect(slots).toMatchObject({ ok: true });

    const pachinko = bet('pachinko', { args: { sets: 2 }, stake: 100 });
    expect(pachinko).toMatchObject({ ok: true });

    const chin = bet('chinchiro');
    expect(chin.ok).toBe(true);
    let cv = chin.result as ChinchiroView;
    while (cv.status === 'player_turn') {
      const r = act('chinchiro', cv.roundId, 'roll');
      expect(r.ok).toBe(true);
      cv = r.result as ChinchiroView;
    }

    const rl = bet('roulette', { bets: [{ kind: 'red', targets: [], stake: 100 }] });
    expect(rl.ok).toBe(true);
    s.timers.advance(20_000 + 2700 + 6000);

    const bjBet = bet('blackjack');
    expect(bjBet.ok).toBe(true);
    const tableId = (bjBet.result as BlackjackView).roundId;
    const dealt = act('blackjack', tableId, 'deal');
    expect(dealt.ok).toBe(true);
    let bv = dealt.result as BlackjackView;
    while (bv.phase === 'player') {
      bv = act('blackjack', tableId, 'stand').result as BlackjackView;
    }
    s.timers.advance(8000);

    // Everything the games did is in the ledger and adds up to the balance.
    const ledger = s.economy.history(GUILD, USER, 500);
    expect(ledger.reduce((sum, e) => sum + e.delta, 0)).toBe(s.economy.getBalance(GUILD, USER));
    const stakes = ledger.filter((e) => e.reason === 'game_stake');
    expect(stakes.map((e) => -e.delta).sort((a, b) => a - b)).toEqual([100, 100, 100, 100, 200]);
    const games = new Set(eventsOf(s.events, 'GameSettled').map((e) => e.game));
    expect(games).toEqual(new Set(['slots', 'pachinko', 'chinchiro', 'roulette', 'blackjack']));
    expect(
      s.store.db.prepare("SELECT COUNT(*) AS n FROM game_rounds WHERE status = 'open'").get(),
    ).toEqual({ n: 0 });
  });

  it('rejects client errors as typed refusals and limits the rate per user', () => {
    const s = setup();
    const h = s.games.handlers;
    const scope = { userId: USER, guildId: GUILD, instanceId: INSTANCE };
    expect(
      h.action!(scope, { idempotencyKey: KEY(300), game: 'slots', roundId: 'x', action: 'spin' }),
    ).toMatchObject({
      ok: false,
      error: 'invalid_payload',
    });
    expect(h.bet!(scope, { idempotencyKey: KEY(301), game: 'horse', stake: 100 })).toMatchObject({
      ok: false,
      error: 'feature_disabled',
    });
    expect(h.bet!(scope, { idempotencyKey: KEY(302), game: 'slots', stake: 5 })).toMatchObject({
      ok: false,
      error: 'invalid_payload',
    });
    let limited = 0;
    for (let i = 0; i < 20; i++) {
      const r = h.bet!(scope, {
        idempotencyKey: KEY(400 + i),
        game: 'slots',
        stake: 5,
      }) as IntentAck;
      if (!r.ok && r.error === 'rate_limited') limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect(h.tableSnapshot!(scope, 'slots')).toBeNull();
    expect(h.tableSnapshot!(scope, 'roulette')).toMatchObject({ game: 'roulette', phase: 'idle' });
  });
});
