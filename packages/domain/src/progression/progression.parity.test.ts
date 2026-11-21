/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are untyped JSON */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimDaily, dailySlot, nextDailySlotMs, type DailyState } from './daily.ts';
import {
  applyWithFloor,
  assetGroups,
  emptyParts,
  playerStatus,
  summarizeHistory,
} from './economy-core.ts';
import {
  EMPTY_PLAY_STATE,
  isJackpot,
  recordPlay,
  todayMissions,
  type MissionRow,
} from './missions.ts';
import { pickChampion, settleWeek, weeklyRank, weeklyTop, type WeeklyRow } from './ranking.ts';
import { dayFromIso, isoDate, previousWeekId, weekId, weekLabel } from './time.ts';
import { planTransfer, transferFee } from './transfer.ts';

const read = (name: string): any =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../tests/fixtures/legacy/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const JST = 9;
const BASE_MS = 1_736_121_600_000; // 2025-01-06 09:00 JST

describe('time helpers', () => {
  it('round-trips dates and weeks', () => {
    const fx = read('weekly-ranking/titles');
    const day = dayFromIso(fx.date);
    expect(isoDate(day)).toBe(fx.date);
    expect(weekId(day)).toBe(fx.week_id);
    expect(previousWeekId(day)).toBe(fx.previous_week_id);
    expect(weekLabel(fx.week_id)).toBe(fx.week_label);
    expect(weekId(day + 6)).toBe(fx.week_id);
    expect(weekId(day + 7)).toBe(isoDate(day + 7));
  });
});

describe('daily (legacy parity)', () => {
  const fx = read('daily/claims');
  const base = { offsetHours: JST, streakGuards: 0, dailyBoost: 0, relicBuff: 0, debt: 0 };
  const fresh: DailyState = { streak: 0, lastDay: null, lastSlot: null };

  it('six-hour slots: four a day, repeat in the same slot refused, same-day streak stays 1', () => {
    const slot0 = BASE_MS - 9 * 3_600_000 + 0; // 00:00 JST
    expect(dailySlot(slot0 + 6 * 3_600_000, JST)).toBe(dailySlot(slot0, JST) + 1);
    expect(nextDailySlotMs(slot0 + 1000, JST)).toBe(slot0 + 6 * 3_600_000);
    const a = claimDaily({ ...base, state: fresh, nowMs: slot0 });
    expect(a).toMatchObject({
      ok: true,
      amount: fx.streak_slot0.amount,
      streak: fx.streak_slot0.streak,
    });
    const dup = claimDaily({ ...base, state: a.state, nowMs: slot0 + 1000 });
    expect(dup).toMatchObject({ ok: false, amount: fx.duplicate_slot0.amount });
    const b = claimDaily({ ...base, state: a.state, nowMs: slot0 + 6 * 3_600_000 });
    expect(b).toMatchObject({ ok: true, amount: fx.streak_slot1.amount, streak: 1 });
    const c = claimDaily({ ...base, state: b.state, nowMs: slot0 + 12 * 3_600_000 });
    expect(c).toMatchObject({ ok: true, amount: fx.streak_slot2.amount, streak: 1 });
  });

  it('daily_double doubles the claim and consumes one charge', () => {
    const r = claimDaily({ ...base, state: fresh, nowMs: BASE_MS, dailyBoost: 1 });
    expect(r).toMatchObject({ amount: fx.with_daily_double.amount, boosted: true });
    expect(r.consume).toEqual({ streakGuard: 0, dailyBoost: 1 });
  });

  it('a debtor loses 20 % to Teiai and 30 % of the rest to the debt', () => {
    const r = claimDaily({ ...base, state: fresh, nowMs: BASE_MS, debt: 8000 });
    expect(r).toMatchObject({
      amount: fx.debtor_claim.result.amount,
      skimmed: fx.debtor_claim.result.skimmed,
      repaid: fx.debtor_claim.result.repaid,
    });
    expect(r.credit - r.repaid).toBe(560);
  });

  it('streak: next day +1, a missed day needs a guard, relic_crown scales the amount', () => {
    const today = BASE_MS;
    const d = (n: number): DailyState => ({
      streak: 5,
      lastDay: Math.floor((today + JST * 3_600_000) / 86_400_000) - n,
      lastSlot: null,
    });
    expect(claimDaily({ ...base, state: d(1), nowMs: today }).streak).toBe(6);
    expect(claimDaily({ ...base, state: d(2), nowMs: today }).streak).toBe(1);
    const guarded = claimDaily({ ...base, state: d(2), nowMs: today, streakGuards: 1 });
    expect(guarded).toMatchObject({ streak: 6, guarded: 1 });
    expect(guarded.consume.streakGuard).toBe(1);
    expect(claimDaily({ ...base, state: d(3), nowMs: today, streakGuards: 1 }).streak).toBe(1);
    expect(claimDaily({ ...base, state: fresh, nowMs: today, relicBuff: 0.1 }).amount).toBe(1100);
    expect(
      claimDaily({
        ...base,
        state: { streak: 40, lastDay: d(1).lastDay, lastSlot: null },
        nowMs: today,
      }).amount,
    ).toBe(3000);
    expect(
      claimDaily({
        ...base,
        state: { streak: 0, lastDay: d(-1).lastDay, lastSlot: null },
        nowMs: today,
      }),
    ).toMatchObject({ ok: false, reason: 'clock_rollback' });
  });
});

describe('transfer (legacy parity)', () => {
  const fx = read('transfer/transfers');
  const ok = {
    senderId: '1',
    receiverId: '2',
    senderGames: 5,
    sentToday: 0,
    senderDebt: 0,
    senderBalance: 1_000_000,
    receiverDebt: 0,
  };

  it('10 % ceiling fee', () => {
    expect(transferFee(1005)).toBe(fx.ok_1005_ceiling_fee.fee);
    expect(transferFee(2000)).toBe(fx.ok_2000_to_debtor.result.fee);
    expect(transferFee(1)).toBe(1);
  });

  it('blocks: three-game minimum, daily principal cap, debtor sender', () => {
    expect(planTransfer({ ...ok, amount: 100, senderGames: 2 })).toEqual({
      ok: false,
      error: { code: fx.blocked_min_games.reason.code, params: fx.blocked_min_games.reason.params },
    });
    expect(
      planTransfer({
        ...ok,
        amount: 17_000,
        sentToday: fx.over_daily_cap.reason.params.sent_today,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'transfer_daily_limit', params: fx.over_daily_cap.reason.params },
    });
    expect(planTransfer({ ...ok, amount: 100, senderDebt: 6400 })).toEqual({
      ok: false,
      error: { code: 'debt_blocks', params: { debt: 6400 } },
    });
    expect(planTransfer({ ...ok, amount: 20_000 - 3005, sentToday: 3005 }).ok).toBe(true);
    expect(planTransfer({ ...ok, amount: 5, receiverId: '1' })).toMatchObject({
      ok: false,
      error: { code: 'transfer_self' },
    });
    expect(planTransfer({ ...ok, amount: 1000, senderBalance: 1099 })).toMatchObject({
      ok: false,
      error: { code: 'transfer_insufficient_balance' },
    });
  });

  it('a debtor receiver has 30 % withheld', () => {
    const plan = planTransfer({ ...ok, amount: 2000, receiverDebt: 7000 });
    expect(plan).toMatchObject({ ok: true, fee: 200, receiverWithheld: 600 });
    expect(7000 - 600).toBe(fx.ok_2000_to_debtor.receiver_debt_after);
    expect(3000 + 2000 - 600).toBe(fx.ok_2000_to_debtor.receiver_balance_after);
  });
});

describe('missions (legacy parity)', () => {
  const fx = read('missions/progress');
  const pick = (d: string) => todayMissions(d).map((m) => m.id);

  it('the same three missions for the same day, from the legacy string seed', () => {
    expect(pick(fx.date)).toEqual(fx.today_missions.map((m: { id: string }) => m.id));
    const next = isoDate(dayFromIso(fx.date) + 1);
    expect(pick(next)).toEqual(fx.next_day_missions.map((m: { id: string }) => m.id));
    expect(todayMissions(fx.date)[0]).toMatchObject({
      name: fx.today_missions[0].name,
      reward: 400,
      target: 3,
    });
  });

  it('replays four plays: streaks, completions in roster order, no bonus with 2 of 3', () => {
    let state = EMPTY_PLAY_STATE;
    let rows = new Map<string, MissionRow>();
    const plays = [
      [1000, 1000],
      [1000, -1000],
      [1000, 1000],
      [1000, 3000],
    ] as const;
    const seen: {
      streak: number;
      newBest: boolean;
      completed: [string, number][];
      bonus: number;
    }[] = [];
    for (const [bet, net] of plays) {
      const r = recordPlay(state, rows, { game: 'スロット', bet, net, tags: [] }, fx.date);
      state = r.state;
      rows = new Map([...rows, ...r.rows]);
      seen.push({
        streak: state.winStreak,
        newBest: r.newBest,
        completed: r.completed.map((m) => [m.id, m.reward]),
        bonus: r.bonus,
      });
    }
    expect(seen).toEqual(
      fx.db_plays.map((p: any) => ({
        streak: p.streak,
        newBest: p.new_best,
        completed: p.completed.map(([m, reward]: any) => [m.id, reward]),
        bonus: p.bonus,
      })),
    );
    for (const [m, progress, done] of fx.mission_status_after) {
      expect(rows.get(m.id)).toEqual({ progress, done });
    }
  });

  it('bets under 100 move the win streak but no mission; the third completion pays 500', () => {
    const day = fx.date;
    let r = recordPlay(
      EMPTY_PLAY_STATE,
      new Map(),
      { game: 'スロット', bet: 50, net: 50, tags: [] },
      day,
    );
    expect(r.state).toMatchObject({ winStreak: 1, plays: 1, dayStreak: 0, streakDay: null });
    expect(r.rows.size).toBe(0);
    const done = new Map<string, MissionRow>([
      ['win3', { progress: 3, done: true }],
      ['big3x', { progress: 3, done: true }],
      ['bj_natural', { progress: 0, done: false }],
    ]);
    r = recordPlay(
      EMPTY_PLAY_STATE,
      done,
      { game: 'ブラックジャック', bet: 100, net: 150, tags: ['natural'] },
      day,
    );
    expect(r.completed.map((m) => m.id)).toEqual(['bj_natural']);
    expect(r.bonus).toBe(500);
  });

  it('jackpot threshold is 50x', () => {
    for (const c of fx.jackpot_checks) expect(isJackpot(c.bet, c.net)).toBe(c.is_jackpot);
    expect(isJackpot(100, 5000)).toBe(true);
  });
});

describe('weekly ranking (legacy parity)', () => {
  const fx = read('weekly-ranking/titles');
  const rows: WeeklyRow[] = [
    { userId: '200000000000000001', net: 12_000, plays: 6 },
    { userId: '200000000000000002', net: 5000, plays: 5 },
    { userId: '200000000000000003', net: 30_000, plays: 3 },
  ];
  const tuple = (r: WeeklyRow): [number, number, number] => [Number(r.userId), r.net, r.plays];

  it('standings, ranks and the champion skip players under five plays', () => {
    expect(weeklyTop(rows).map(tuple)).toEqual(fx.weekly_top);
    expect(weeklyRank(rows, '200000000000000001')).toMatchObject({
      rank: fx.rank_user1[0],
      net: fx.rank_user1[1],
      plays: fx.rank_user1[2],
      total: fx.rank_user1[3],
    });
    expect(weeklyRank(rows, '200000000000000003')).toMatchObject({ rank: 1, total: 3 });
    expect(weeklyRank(rows, '999')).toBeNull();
    expect(tuple(pickChampion(rows) as WeeklyRow)).toEqual(fx.weekly_award.champion);
  });

  it('awards once per week and clears the previous holders', () => {
    const award = settleWeek({
      week: fx.week_id,
      lastWeek: fx.previous_week_id,
      rows,
      holders: [],
      priorWins: new Map(),
    });
    expect(award?.champion && tuple(award.champion)).toEqual(fx.weekly_award.champion);
    expect(award?.wins).toBe(fx.weekly_award.wins);
    expect(award?.previous).toEqual(fx.weekly_award.previous);
    expect(
      settleWeek({
        week: fx.week_id,
        lastWeek: fx.week_id,
        rows,
        holders: [],
        priorWins: new Map(),
      }),
    ).toBeNull();
    const repeat = settleWeek({
      week: fx.week_id,
      lastWeek: null,
      rows,
      holders: ['200000000000000001', '5'],
      priorWins: new Map([['200000000000000001', 2]]),
    });
    expect(repeat).toMatchObject({ wins: 3, previous: ['5'] });
    const none = settleWeek({
      week: fx.week_id,
      lastWeek: null,
      rows: [{ userId: '1', net: -5, plays: 9 }],
      holders: ['7'],
      priorWins: new Map(),
    });
    expect(none).toMatchObject({ champion: null, previous: ['7'] });
  });
});

describe('economy core (legacy parity)', () => {
  const fx = read('economy-core/core');

  it('floor clamp keeps the cash balance at zero', () => {
    expect(applyWithFloor(3000, -5000)).toEqual({
      after: fx.per_guild_isolation.after_floor_clamp_guild_a,
      actual: -3000,
    });
    expect(applyWithFloor(0, -10)).toEqual({ after: 0, actual: 0 });
  });

  it('balance sheet groups', () => {
    for (const [uid, parts] of Object.entries(fx.assets.parts) as [string, any][]) {
      const g = assetGroups({
        ...emptyParts(),
        ...parts,
        debt: 0 - parts.debt,
        loans_owed: 0 - parts.loans_owed,
      });
      expect(g).toEqual(fx.assets.groups[uid]);
    }
    expect(assetGroups({ ...emptyParts(), cash: 100, items: 50, debt: -30 })).toEqual({
      liquid: 100,
      fixed: 50,
      gross: 150,
      liabilities: 30,
      net: 120,
    });
  });

  it('statuses', () => {
    expect(playerStatus({ debt: 0, bankrupt: false, netWorth: 10 })).toBe('katagi');
    expect(playerStatus({ debt: 1, bankrupt: false, netWorth: 10 })).toBe('underground');
    expect(playerStatus({ debt: 15_000, bankrupt: false, netWorth: 10 })).toBe('grace');
    expect(playerStatus({ debt: 0, bankrupt: true, netWorth: 10 })).toBe('bankrupt');
    expect(playerStatus({ debt: 0, bankrupt: false, netWorth: 1_000_000 })).toBe('wealthy');
  });

  it('history folds a game and a transfer with its fee into one line', () => {
    const rows = [
      {
        id: 5,
        delta: 900,
        balanceAfter: 5000,
        reason: 'game_payout',
        refType: 'round',
        refId: 'r1',
        createdAt: 5,
      },
      {
        id: 4,
        delta: -500,
        balanceAfter: 4100,
        reason: 'game_stake',
        refType: 'round',
        refId: 'r1',
        createdAt: 4,
      },
      {
        id: 3,
        delta: -100,
        balanceAfter: 4600,
        reason: 'daily_bonus',
        refType: null,
        refId: null,
        createdAt: 3,
      },
    ];
    const out = summarizeHistory(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'game', delta: 400, bet: 500, rows: 2 });
  });
});
