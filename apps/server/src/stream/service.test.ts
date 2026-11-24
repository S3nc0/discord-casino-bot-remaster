import { manualClock, type DomainEvent } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../db/identity.ts';
import { EconomyService } from '../economy/economy-service.ts';
import { GameRuleError } from '../games/progression/context.ts';
import { createMemoryTeiai } from '../games/progression/ports.ts';
import { ProgressionService } from '../games/progression/service.ts';
import { EventBus } from '../runtime/bus.ts';
import { AppError } from '../runtime/errors.ts';
import { createSeededRng } from '@casino/shared';
import { GUILD, memoryStore, START_MS } from '../runtime/test-kit.ts';
import { StreamService, type StreamActor } from './service.ts';

const S = '100000000000000001'; // streamer
const A = '100000000000000002';
const B = '100000000000000003';
const C = '100000000000000004';
const OWNER = '100000000000000009';
const MIN = 60_000;

function harness() {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const bus = new EventBus((e) => {
    throw e;
  });
  const identity = new IdentityRepo(store, () => clock.now());
  identity.ensureGuild(GUILD, 'approved');
  const economy = new EconomyService({ store, identity, clock, bus });
  const teiai = createMemoryTeiai();
  const progression = new ProgressionService({
    store,
    economy,
    bus,
    clock,
    rng: createSeededRng(1),
    teiai,
    offsetHours: 9,
  });
  const stream = new StreamService({
    store,
    economy,
    identity,
    clock,
    bus,
    teiai,
    transfers: progression,
  });
  const events: DomainEvent[] = [];
  bus.onAnyDomain((e) => events.push(e));
  let seq = 0;
  const key = (): string => `k-${++seq}`;
  const who = (userId: string): StreamActor => ({ guildId: GUILD, userId });
  const grant = (userId: string, amount: number): void => {
    economy.credit({
      guildId: GUILD,
      userId,
      amount,
      reason: 'admin_grant',
      idempotencyKey: `grant:${key()}`,
    });
  };
  const games = (userId: string, n: number): void => {
    economy.ensureMember(GUILD, userId);
    store
      .stmt(
        `INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET games_played = excluded.games_played`,
      )
      .run(GUILD, userId, n);
  };
  const bal = (userId: string): number => economy.getBalance(GUILD, userId);
  const live = (title = 'Boss fight') =>
    stream.start(who(S), { title, idempotencyKey: key() }).stream;
  const open = (streamId: number) =>
    stream.openRound(who(S), { streamId, idempotencyKey: key() }).stream.round!.id;
  const bet = (
    userId: string,
    streamId: number,
    roundId: number,
    side: 'win' | 'lose',
    amount: number,
  ) => stream.bet(who(userId), { streamId, roundId, side, amount, idempotencyKey: key() });
  const lock = (streamId: number, roundId: number) =>
    stream.lock(who(S), { streamId, roundId, idempotencyKey: key() });
  const ofType = <T extends DomainEvent['type']>(type: T) =>
    events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
  const featureOff = () =>
    store
      .stmt(`INSERT INTO guild_features_off (guild_id, feature) VALUES (?, 'stream')`)
      .run(GUILD);
  return {
    store,
    clock,
    economy,
    teiai,
    progression,
    stream,
    events,
    key,
    who,
    grant,
    games,
    bal,
    live,
    open,
    bet,
    lock,
    ofType,
    featureOff,
  };
}

function refusal(fn: () => unknown): { rule: string; code: string; params: unknown } {
  try {
    fn();
  } catch (error) {
    if (error instanceof GameRuleError) {
      return { rule: error.rule, code: error.code, params: error.params };
    }
    if (error instanceof AppError) return { rule: '', code: error.code, params: {} };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('StreamService: panel', () => {
  it('starts one live panel per streamer, with the streamer account created', () => {
    const h = harness();
    const s = h.live();
    expect(s).toMatchObject({ status: 'live', title: 'Boss fight', url: null, round: null });
    expect(s.endsAt - s.startedAt).toBe(24 * 60 * MIN);
    expect(h.economy.hasAccount(GUILD, S)).toBe(true);
    expect(refusal(() => h.live())).toMatchObject({ rule: 'stream_already_live' });
    expect(h.stream.list(h.who(A))).toMatchObject({ streams: [{ id: s.id }], mine: null });
    expect(h.stream.list(h.who(S)).mine).toBe(s.id);
    expect(h.ofType('StreamStarted')).toHaveLength(1);
  });

  it('checks title and URL', () => {
    const h = harness();
    const start = (title: string, url?: string) =>
      refusal(() => h.stream.start(h.who(S), { title, url, idempotencyKey: h.key() }));
    expect(start('   ')).toMatchObject({ rule: 'stream_bad_title', params: { max: 100 } });
    expect(start('ok', 'ftp://x')).toMatchObject({ rule: 'stream_bad_url' });
    const s = h.stream.start(h.who(S), {
      title: ' ok ',
      url: 'https://example.com/live',
      idempotencyKey: h.key(),
    }).stream;
    expect(s).toMatchObject({ title: 'ok', url: 'https://example.com/live' });
  });

  it('stores the Activity location, never anything else', () => {
    const h = harness();
    const s = h.stream.start(h.who(S), {
      title: 'x',
      location: { channelId: '555555555555555555' },
      idempotencyKey: h.key(),
    }).stream;
    expect(s.location).toEqual({ channelId: '555555555555555555', source: 'activity' });
  });
});

describe('StreamService: tips', () => {
  it('moves money exactly like a transfer, ref_type stream', () => {
    const h = harness();
    const s = h.live();
    h.games(A, 3);
    const r = h.stream.tip(h.who(A), {
      streamId: s.id,
      amount: 1000,
      message: 'gl',
      idempotencyKey: h.key(),
    });
    expect(r).toMatchObject({
      amount: 1000,
      fee: 100,
      received: 1000,
      withheld: 0,
      replayed: false,
    });
    expect(h.bal(A)).toBe(3000 - 1100);
    expect(h.bal(S)).toBe(3000 + 1000);
    expect(r.stream).toMatchObject({ tips: 1000, tipCount: 1 });
    expect(r.stream.recentTips[0]).toMatchObject({ tipperId: A, amount: 1000, message: 'gl' });
    const rows = h.store
      .stmt(
        `SELECT reason, delta, ref_type, ref_id FROM ledger WHERE ref_type = 'stream' ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      { reason: 'transfer_out', delta: -1000, ref_type: 'stream', ref_id: String(s.id) },
      { reason: 'transfer_fee', delta: -100, ref_type: 'stream', ref_id: String(s.id) },
      { reason: 'transfer_in', delta: 1000, ref_type: 'stream', ref_id: String(s.id) },
    ]);
    expect(h.ofType('StreamTipped')[0]).toMatchObject({ tipperId: A, amount: 1000, tips: 1000 });
  });

  it('a tip and a transfer with the same inputs write the same legs, apart from the reference', () => {
    // Two worlds in the same state: one tips the streamer, the other transfers to them.
    const run = (how: 'tip' | 'transfer') => {
      const h = harness();
      const s = h.live();
      h.games(A, 3);
      h.grant(A, 10_000);
      h.teiai.setDebt(GUILD, S, 7000);
      const key = 'same-key-0001';
      if (how === 'tip') {
        h.stream.tip(h.who(A), { streamId: s.id, amount: 2000, idempotencyKey: key });
      } else {
        h.progression.transfer({
          guildId: GUILD,
          senderId: A,
          receiverId: S,
          amount: 2000,
          idempotencyKey: key,
        });
      }
      const legs = h.store
        .stmt(
          `SELECT user_id, reason, delta, balance_after, ref_type, ref_id, idempotency_key FROM ledger
           WHERE reason IN ('transfer_out', 'transfer_fee', 'transfer_in', 'debt_withholding') ORDER BY id`,
        )
        .all() as Record<string, unknown>[];
      return {
        legs,
        refs: legs.map((l) => [l.ref_type, l.ref_id]),
        debt: h.teiai.debtOf(GUILD, S),
        balances: [h.bal(A), h.bal(S)],
        sent: h.progression.sentToday(GUILD, A),
        streamId: s.id,
      };
    };
    const tip = run('tip');
    const transfer = run('transfer');
    const strip = (legs: Record<string, unknown>[], scope: string) =>
      legs.map(({ ref_type: _t, ref_id: _i, idempotency_key: k, ...rest }) => ({
        ...rest,
        // The receiver's key carries the scope (stream / transfer); the rest is the same key.
        key: String(k).replace(`${scope}:`, ''),
      }));
    expect(tip.legs).toHaveLength(4);
    expect(strip(tip.legs, 'stream')).toEqual(strip(transfer.legs, 'transfer'));
    expect(tip.refs).toEqual(Array(4).fill(['stream', String(tip.streamId)]));
    expect(transfer.refs).toEqual(Array(4).fill(['transfer', 'same-key-0001']));
    expect(tip.debt).toBe(transfer.debt);
    expect(tip.balances).toEqual(transfer.balances);
    expect(tip.sent).toBe(transfer.sent);
  });

  it('refuses self tips, small tips, too few games and debt', () => {
    const h = harness();
    const s = h.live();
    const tip = (userId: string, amount: number) =>
      refusal(() =>
        h.stream.tip(h.who(userId), { streamId: s.id, amount, idempotencyKey: h.key() }),
      );
    expect(tip(S, 500)).toMatchObject({ rule: 'stream_self_tip', code: 'forbidden' });
    h.games(A, 2);
    expect(tip(A, 99)).toMatchObject({ rule: 'stream_tip_min', params: { min: 100 } });
    expect(tip(A, 100)).toMatchObject({ rule: 'transfer_min_games', params: { min_games: 3 } });
    h.games(A, 3);
    h.teiai.setDebt(GUILD, A, 10);
    expect(tip(A, 100)).toMatchObject({ rule: 'stream_debt' });
    h.teiai.setDebt(GUILD, A, 0);
    expect(tip(A, 2800)).toMatchObject({
      rule: 'transfer_insufficient_balance',
      code: 'insufficient_funds',
    });
    expect(h.bal(A)).toBe(3000);
  });

  it('shares the 20,000 daily cap with transfers', () => {
    const h = harness();
    const s = h.live();
    h.games(A, 3);
    h.grant(A, 50_000);
    h.economy.ensureMember(GUILD, B);
    const t = h.progression.transfer({
      guildId: GUILD,
      senderId: A,
      receiverId: B,
      amount: 15_000,
      idempotencyKey: 'tx-1',
    });
    expect(t.ok).toBe(true);
    expect(
      refusal(() =>
        h.stream.tip(h.who(A), { streamId: s.id, amount: 5001, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({
      rule: 'transfer_daily_limit',
      params: { daily_limit: 20_000, sent_today: 15_000 },
    });
    h.stream.tip(h.who(A), { streamId: s.id, amount: 5000, idempotencyKey: h.key() });
    expect(h.progression.sentToday(GUILD, A)).toBe(20_000);
    // ...and a transfer after the tip sees the tip in the cap
    const after = h.progression.transfer({
      guildId: GUILD,
      senderId: A,
      receiverId: B,
      amount: 100,
      idempotencyKey: 'tx-2',
    });
    expect(after).toMatchObject({ ok: false, error: { code: 'transfer_daily_limit' } });
  });

  it('withholds the streamer debt from a tip and previews the confirm step', () => {
    const h = harness();
    const s = h.live();
    h.games(A, 3);
    h.grant(A, 10_000);
    h.teiai.setDebt(GUILD, S, 100_000);
    expect(h.stream.previewTip(h.who(A), s.id, 5000)).toMatchObject({
      ok: true,
      fee: 500,
      total: 5500,
      needsConfirm: true,
    });
    expect(h.stream.previewTip(h.who(S), s.id, 5000)).toMatchObject({
      ok: false,
      rule: 'stream_self_tip',
    });
    const r = h.stream.tip(h.who(A), { streamId: s.id, amount: 1000, idempotencyKey: h.key() });
    expect(r.withheld).toBeGreaterThan(0);
    expect(r.received).toBe(1000 - r.withheld);
    expect(h.bal(S)).toBe(3000 + 1000 - r.withheld);
  });
});

describe('StreamService: rounds and bets', () => {
  it('escrows bets and enforces side, cap, self-bet and debt', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.grant(A, 20_000);
    const no = (userId: string, side: 'win' | 'lose', amount: number, roundId = r) =>
      refusal(() => h.bet(userId, s.id, roundId, side, amount));
    expect(no(S, 'win', 100)).toMatchObject({ rule: 'stream_self_bet', code: 'forbidden' });
    expect(no(A, 'win', 99)).toMatchObject({ rule: 'stream_bet_min', params: { min: 100 } });
    expect(no(A, 'win', 100, r + 1)).toMatchObject({ rule: 'stream_round_changed' });
    const first = h.bet(A, s.id, r, 'win', 6000);
    expect(first).toMatchObject({ side: 'win', total: 6000, balance: 23_000 - 6000 });
    expect(first.stream.me).toMatchObject({ bet: { side: 'win', amount: 6000 }, betRoom: 4000 });
    expect(no(A, 'lose', 100)).toMatchObject({ rule: 'stream_other_side' });
    expect(no(A, 'win', 4001)).toMatchObject({
      rule: 'stream_bet_max',
      params: { max: 10_000, already: 6000 },
    });
    expect(h.bet(A, s.id, r, 'win', 4000).total).toBe(10_000);
    h.teiai.setDebt(GUILD, B, 1);
    expect(no(B, 'lose', 100)).toMatchObject({ rule: 'stream_debt' });
    h.teiai.setDebt(GUILD, B, 0);
    h.economy.ensureMember(GUILD, B);
    expect(no(B, 'lose', 3001)).toMatchObject({ code: 'insufficient_funds' });
    expect(h.bal(B)).toBe(3000);
    const rows = h.store
      .stmt(
        `SELECT reason, delta, ref_type FROM ledger WHERE user_id = ? AND reason = 'stream_bet'`,
      )
      .all(A);
    expect(rows).toEqual([
      { reason: 'stream_bet', delta: -6000, ref_type: 'stream_round' },
      { reason: 'stream_bet', delta: -4000, ref_type: 'stream_round' },
    ]);
    expect(h.ofType('StreamBetPlaced').at(-1)).toMatchObject({
      winTotal: 10_000,
      loseTotal: 0,
      bettors: 1,
    });
    expect(refusal(() => h.open(s.id))).toMatchObject({ rule: 'stream_round_active' });
  });

  it('only the streamer runs the round, and settle needs a locked round (D3-1)', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    const settle = (userId: string) =>
      refusal(() =>
        h.stream.settle(h.who(userId), {
          streamId: s.id,
          roundId: r,
          winner: 'win',
          idempotencyKey: h.key(),
        }),
      );
    expect(settle(A)).toMatchObject({ rule: 'stream_not_streamer', code: 'forbidden' });
    expect(settle(S)).toMatchObject({ rule: 'stream_not_locked' });
    expect(refusal(() => h.lock(s.id, r + 5))).toMatchObject({ rule: 'stream_round_changed' });
    h.lock(s.id, r);
    expect(refusal(() => h.lock(s.id, r))).toMatchObject({ rule: 'stream_no_open_round' });
    expect(refusal(() => h.bet(A, s.id, r, 'win', 100))).toMatchObject({
      rule: 'stream_no_open_round',
    });
    expect(h.ofType('StreamRoundLocked')).toMatchObject([{ cause: 'streamer' }]);
  });

  it('pays the worked example and gives the rake to the Teiai bank', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 1000);
    h.bet(B, s.id, r, 'win', 3000 - 0);
    h.grant(C, 0 + 1);
    h.bet(C, s.id, r, 'lose', 2000);
    h.lock(s.id, r);
    const done = h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r,
      winner: 'win',
      idempotencyKey: h.key(),
    });
    expect(done.result).toMatchObject({
      outcome: 'win',
      refunded: false,
      cause: 'streamer',
      winTotal: 4000,
      loseTotal: 2000,
      rake: 100,
      payoutCount: 2,
      payouts: [
        { userId: B, amount: 4425 },
        { userId: A, amount: 1475 },
      ],
    });
    expect(h.bal(A)).toBe(3000 - 1000 + 1475);
    expect(h.bal(B)).toBe(3000 - 3000 + 4425);
    expect(h.bal(C)).toBe(3001 - 2000);
    expect(h.teiai.bank.get(GUILD)).toBe(100);
    expect(done.stream.round).toBeNull();
    const audit = h.stream.audit(GUILD);
    expect(audit).toMatchObject([
      {
        roundId: r,
        streamId: s.id,
        streamerId: S,
        outcome: 'win',
        cause: 'streamer',
        actorId: S,
        reason: null,
        bettors: 3,
        rake: 100,
        refunded: false,
        top: [
          { userId: B, amount: 4425 },
          { userId: A, amount: 1475 },
        ],
      },
    ]);
    expect(audit[0]?.lockedAt).not.toBeNull();
    // a second settle with a new key is refused; nothing more is paid
    expect(
      refusal(() =>
        h.stream.settle(h.who(S), {
          streamId: s.id,
          roundId: r,
          winner: 'lose',
          idempotencyKey: h.key(),
        }),
      ),
    ).toMatchObject({ rule: 'stream_no_round' });
    expect(h.bal(A)).toBe(3475);
  });

  it('withholds Teiai debt from the profit only', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 1000);
    h.bet(C, s.id, r, 'lose', 2000);
    h.teiai.setDebt(GUILD, A, 1_000_000);
    h.lock(s.id, r);
    h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r,
      winner: 'win',
      idempotencyKey: h.key(),
    });
    // payout 1000 + 1900; profit 1900 → 30 % withheld = 570
    const rows = h.store
      .stmt(
        `SELECT reason, delta FROM ledger WHERE user_id = ? AND ref_type = 'stream_round' ORDER BY id`,
      )
      .all(A);
    expect(rows).toEqual([
      { reason: 'stream_bet', delta: -1000 },
      { reason: 'stream_payout', delta: 2900 },
      { reason: 'debt_withholding', delta: -570 },
    ]);
  });

  it('refunds a one-sided round and a void exactly', () => {
    const h = harness();
    const s = h.live();
    const r1 = h.open(s.id);
    h.bet(A, s.id, r1, 'win', 700);
    h.lock(s.id, r1);
    const one = h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r1,
      winner: 'lose',
      idempotencyKey: h.key(),
    });
    expect(one.result).toMatchObject({
      refunded: true,
      rake: 0,
      payouts: [{ userId: A, amount: 700 }],
    });
    expect(h.bal(A)).toBe(3000);
    const r2 = h.open(s.id);
    h.bet(A, s.id, r2, 'win', 500);
    h.bet(B, s.id, r2, 'lose', 800);
    // void works while bets are still open
    const v = h.stream.voidRound(h.who(S), {
      streamId: s.id,
      roundId: r2,
      idempotencyKey: h.key(),
    });
    expect(v.result).toMatchObject({ outcome: 'void', refunded: true, cause: 'streamer' });
    expect([h.bal(A), h.bal(B)]).toEqual([3000, 3000]);
    // r1 was declared (and refunded as one-sided): it counts as paid
    expect(
      refusal(() =>
        h.stream.voidRound(h.who(S), { streamId: s.id, roundId: r1, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({ rule: 'stream_round_settled' });
    expect(
      refusal(() =>
        h.stream.voidRound(h.who(S), { streamId: s.id, roundId: r2, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({ rule: 'stream_no_round' });
    const r3 = h.open(s.id);
    expect(
      refusal(() =>
        h.stream.voidRound(h.who(S), { streamId: s.id, roundId: r2, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({ rule: 'stream_round_changed' });
    expect(r3).toBeGreaterThan(r2);
  });

  it('auto-locks 10 minutes after opening, to the millisecond, and the job persists it', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 100);
    h.clock.advance(10 * MIN - 1);
    h.bet(A, s.id, r, 'win', 100);
    h.clock.advance(1);
    expect(refusal(() => h.bet(A, s.id, r, 'win', 100))).toMatchObject({
      rule: 'stream_no_open_round',
    });
    const view = h.stream.view(h.who(A), s.id);
    expect(view.round).toMatchObject({ status: 'locked', lockedAt: view.round?.autoLockAt });
    expect(view.me.betRoom).toBe(0);
    expect(h.stream.lockDue(GUILD)).toBe(1);
    expect(h.stream.lockDue(GUILD)).toBe(0);
    expect(h.ofType('StreamRoundLocked')).toMatchObject([{ roundId: r, cause: 'auto' }]);
  });

  it('settles a round past autoLockAt before the job ran', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 100);
    h.clock.advance(10 * MIN);
    const done = h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r,
      winner: 'win',
      idempotencyKey: h.key(),
    });
    expect(done.result.refunded).toBe(true);
    expect(h.stream.audit(GUILD)[0]?.lockedAt).toBe(START_MS + 10 * MIN);
    expect(h.stream.lockDue(GUILD)).toBe(0);
  });
});

describe('StreamService: end, close, feature switch, replays, owner void', () => {
  it('end voids the active round and refunds everyone', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'lose', 1500);
    const e = h.stream.end(h.who(S), { streamId: s.id, idempotencyKey: h.key() });
    expect(e.voided).toMatchObject({ outcome: 'void', cause: 'stream_end', refunded: true });
    expect(e.stream).toMatchObject({ status: 'ended', round: null });
    expect(h.bal(A)).toBe(3000);
    expect(h.ofType('StreamEnded')).toMatchObject([{ cause: 'streamer' }]);
    expect(
      refusal(() => h.stream.end(h.who(S), { streamId: s.id, idempotencyKey: h.key() })),
    ).toMatchObject({
      rule: 'stream_ended',
    });
    expect(
      refusal(() => h.stream.end(h.who(A), { streamId: s.id, idempotencyKey: h.key() })),
    ).toMatchObject({
      rule: 'stream_not_streamer',
    });
    // a new panel can be opened now
    expect(h.live().id).toBeGreaterThan(s.id);
  });

  it('closeDue ends panels past 24 h and voids their round (cause timeout)', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 300);
    h.clock.advance(24 * 60 * MIN - 1);
    expect(h.stream.closeDue(GUILD)).toBe(0);
    h.clock.advance(1);
    expect(h.stream.closeDue(GUILD)).toBe(1);
    expect(h.stream.closeDue(GUILD)).toBe(0);
    expect(h.bal(A)).toBe(3000);
    expect(h.stream.view(h.who(A), s.id).status).toBe('ended');
    expect(h.ofType('StreamEnded')).toMatchObject([{ cause: 'timeout' }]);
    expect(h.stream.audit(GUILD)[0]).toMatchObject({ cause: 'timeout', actorId: null });
  });

  it('feature off blocks start, tip and bet but never open, lock, settle, void or end', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 500);
    h.bet(B, s.id, r, 'lose', 500);
    h.games(A, 3);
    h.featureOff();
    expect(h.stream.isEnabled(GUILD)).toBe(false);
    expect(refusal(() => h.bet(A, s.id, r, 'win', 100))).toMatchObject({
      code: 'feature_disabled',
    });
    expect(
      refusal(() =>
        h.stream.tip(h.who(A), { streamId: s.id, amount: 100, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({ code: 'feature_disabled' });
    expect(
      refusal(() => h.stream.start(h.who(B), { title: 'x', idempotencyKey: h.key() })),
    ).toMatchObject({ code: 'feature_disabled' });
    h.lock(s.id, r);
    h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r,
      winner: 'lose',
      idempotencyKey: h.key(),
    });
    const r2 = h.open(s.id);
    h.stream.voidRound(h.who(S), { streamId: s.id, roundId: r2, idempotencyKey: h.key() });
    h.stream.end(h.who(S), { streamId: s.id, idempotencyKey: h.key() });
    expect(h.bal(B)).toBe(3000 + 475);
  });

  it('replays a write with the same key and pays once', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    const bet = {
      streamId: s.id,
      roundId: r,
      side: 'win' as const,
      amount: 400,
      idempotencyKey: 'bet-1',
    };
    const first = h.stream.bet(h.who(A), bet);
    const again = h.stream.bet(h.who(A), bet);
    expect([first.replayed, again.replayed]).toEqual([false, true]);
    expect(again.total).toBe(400);
    expect(h.bal(A)).toBe(2600);
    // same key, different body
    expect(refusal(() => h.stream.bet(h.who(A), { ...bet, amount: 500 }))).toMatchObject({
      code: 'conflict',
    });
    h.bet(B, s.id, r, 'lose', 400);
    h.lock(s.id, r);
    const settle = {
      streamId: s.id,
      roundId: r,
      winner: 'win' as const,
      idempotencyKey: 'settle-1',
    };
    const a = h.stream.settle(h.who(S), settle);
    const b = h.stream.settle(h.who(S), settle);
    expect([a.replayed, b.replayed]).toEqual([false, true]);
    expect(b.result).toEqual(a.result);
    expect(h.bal(A)).toBe(2600 + 400 + 380);
    expect(h.ofType('StreamRoundSettled')).toHaveLength(1);
  });

  it('owner void refunds with a reason and an audit row (D3-2)', () => {
    const h = harness();
    const s = h.live();
    const r = h.open(s.id);
    h.bet(A, s.id, r, 'win', 800);
    h.bet(B, s.id, r, 'lose', 200);
    const fail = (target: string, reason = 'collusion') =>
      refusal(() => h.stream.ownerVoid({ guildId: GUILD, ownerId: OWNER, target, reason }));
    expect(fail(`round:${r}`, '  ')).toMatchObject({
      rule: 'stream_void_reason',
      params: { max: 200 },
    });
    expect(fail(`round:${r}`, 'x'.repeat(201))).toMatchObject({ rule: 'stream_void_reason' });
    expect(fail('round:999')).toMatchObject({ rule: 'stream_void_target' });
    expect(fail('stream:999')).toMatchObject({ rule: 'stream_void_target' });
    expect(fail('nonsense')).toMatchObject({ rule: 'stream_void_target' });
    expect(
      refusal(() =>
        h.stream.ownerVoid({
          guildId: '999999999999999999',
          ownerId: OWNER,
          target: String(r),
          reason: 'x',
        }),
      ),
    ).toMatchObject({ rule: 'stream_void_target' });
    const v = h.stream.ownerVoid({
      guildId: GUILD,
      ownerId: OWNER,
      target: `stream:${s.id}`,
      reason: ' collusion ',
    });
    expect(v).toMatchObject({ streamId: s.id, roundId: r, refunded: 1000 });
    expect(v.result).toMatchObject({ outcome: 'void', cause: 'owner', refunded: true });
    expect([h.bal(A), h.bal(B)]).toEqual([3000, 3000]);
    expect(h.stream.auditOf(GUILD, r)).toMatchObject({
      cause: 'owner',
      actorId: OWNER,
      reason: 'collusion',
    });
    expect(h.stream.view(h.who(A), s.id).status).toBe('live');
    expect(fail(String(r))).toMatchObject({ rule: 'stream_no_round' });
    // a paid round cannot be voided
    const r2 = h.open(s.id);
    h.bet(A, s.id, r2, 'win', 100);
    h.bet(B, s.id, r2, 'lose', 100);
    h.lock(s.id, r2);
    h.stream.settle(h.who(S), {
      streamId: s.id,
      roundId: r2,
      winner: 'win',
      idempotencyKey: h.key(),
    });
    expect(fail(`round:${r2}`)).toMatchObject({ rule: 'stream_round_settled' });
    expect(
      refusal(() =>
        h.stream.voidRound(h.who(S), { streamId: s.id, roundId: r2, idempotencyKey: h.key() }),
      ),
    ).toMatchObject({ rule: 'stream_round_settled' });
    // owner void works with the feature off
    h.featureOff();
    const r3 = h.open(s.id);
    expect(
      h.stream.ownerVoid({ guildId: GUILD, ownerId: OWNER, target: String(r3), reason: 'x' })
        .roundId,
    ).toBe(r3);
  });

  it('publishes events only after commit and tells change listeners', () => {
    const h = harness();
    const changes: string[] = [];
    h.stream.onChange((c) => changes.push(c.kind));
    const s = h.live();
    h.stream.attachPanel(GUILD, s.id, '666666666666666666', '777777777777777777');
    expect(h.stream.panel(GUILD, s.id)).toEqual({
      channelId: '666666666666666666',
      messageId: '777777777777777777',
      status: 'live',
    });
    // a refused write publishes nothing
    const before = h.events.length;
    refusal(() => h.bet(S, s.id, 1, 'win', 100));
    expect(h.events.length).toBe(before);
    expect(changes).toEqual(['started', 'panel']);
  });
});
