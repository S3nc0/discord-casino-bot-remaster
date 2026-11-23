import type { GameId } from '@casino/shared';
import type { weeklyRank } from '@casino/domain/progression';
import {
  claimDaily,
  dailySlot,
  dayStartMs,
  EMPTY_PLAY_STATE,
  isMissionGame,
  isoDate,
  LEGACY_GAME_NAMES,
  localDayNumber,
  MISSION_COMPLETE_BONUS,
  nextDailySlotMs,
  planTransfer,
  pickChampion,
  previousWeekId,
  recordPlay,
  settleWeek,
  todayMissions,
  weekId,
  type DailyResult,
  type Mission,
  type MissionRow,
  type PlayState,
  type TransferError,
  type WeeklyAward,
  type WeeklyRow,
} from '@casino/domain/progression';
import { relicBuffs } from '@casino/domain/work';
import { Inventory } from '../shop/inventory.ts';
import { creditIncome, emit, type GamesCtx } from './context.ts';
import { AppError } from '../../runtime/errors.ts';

export interface PlayInput {
  guildId: string;
  userId: string;
  game: GameId;
  roundId: string;
  stake: number;
  payout: number;
  net: number;
  /** Mission tags such as `natural` or `double_win`. */
  tags?: readonly string[];
}

export interface TransferOutcome {
  ok: true;
  amount: number;
  fee: number;
  received: number;
  withheld: number;
  senderBalance: number;
}
export type TransferResult = TransferOutcome | { ok: false; error: TransferError };

export interface MissionStatus {
  day: string;
  missions: { mission: Mission; progress: number; done: boolean }[];
}

/** Daily claims, transfers, missions, the weekly ranking and the play counters they all share. */
export class ProgressionService {
  readonly inventory: Inventory;
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
    this.inventory = new Inventory(ctx.store);
  }

  /** Listen to `GameSettled` so a game played in chat or in the Activity counts the same. */
  subscribe(): () => void {
    return this.ctx.bus.onDomain('GameSettled', (e) => {
      this.recordPlay({
        guildId: e.guildId,
        userId: e.userId,
        game: e.game,
        roundId: e.roundId,
        stake: e.stake,
        payout: e.payout,
        net: e.net,
      });
    });
  }

  private day(): number {
    return localDayNumber(this.ctx.clock.now(), this.ctx.offsetHours);
  }

  // ------------------------------------------------------------------ plays

  playState(guildId: string, userId: string): PlayState & { gamesPlayed: number } {
    const r = this.ctx.store
      .stmt('SELECT * FROM play_state WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as Record<string, number | string | null> | undefined;
    if (!r) return { ...EMPTY_PLAY_STATE, gamesPlayed: 0 };
    return {
      winStreak: r.win_streak as number,
      bestStreak: r.best_streak as number,
      dayStreak: r.day_streak as number,
      streakDay: r.streak_day as string | null,
      plays: r.plays as number,
      wins: r.wins as number,
      netTotal: r.net_total as number,
      gamesPlayed: r.games_played as number,
    };
  }

  gamesPlayed(guildId: string, userId: string): number {
    return this.playState(guildId, userId).gamesPlayed;
  }

  /**
   * One finished game. Every game with a stake counts for the totals (arena excepted, as in
   * the legacy bot); the five casino games also drive streaks, missions and the weekly ranking.
   */
  recordPlay(input: PlayInput): { completed: Mission[]; bonus: number } {
    const { ctx } = this;
    const { guildId, userId } = input;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const at = ctx.clock.now();
      const counts = input.game !== 'arena';
      if (counts) {
        ctx.store
          .stmt(
            `INSERT INTO play_state (guild_id, user_id, games_played, total_wagered, total_won, biggest_win)
             VALUES (@g, @u, 1, @stake, @payout, @big)
             ON CONFLICT (guild_id, user_id) DO UPDATE SET
               games_played = games_played + 1, total_wagered = total_wagered + @stake,
               total_won = total_won + @payout, biggest_win = MAX(biggest_win, @big)`,
          )
          .run({
            g: guildId,
            u: userId,
            stake: input.stake,
            payout: input.payout,
            big: Math.max(0, input.net),
          });
      }
      if (!isMissionGame(input.game)) return { completed: [], bonus: 0 };

      const dayNo = localDayNumber(at, ctx.offsetHours);
      const dayIso = isoDate(dayNo);
      const state = this.playState(guildId, userId);
      const rows = new Map<string, MissionRow>();
      for (const r of ctx.store
        .stmt(
          'SELECT mission_id, progress, done FROM missions WHERE guild_id = ? AND user_id = ? AND day = ?',
        )
        .all(guildId, userId, dayIso) as { mission_id: string; progress: number; done: number }[]) {
        rows.set(r.mission_id, { progress: r.progress, done: r.done === 1 });
      }
      const rec = recordPlay(
        state,
        rows,
        {
          game: LEGACY_GAME_NAMES[input.game],
          bet: input.stake,
          net: input.net,
          tags: input.tags ?? [],
        },
        dayIso,
      );
      const s = rec.state;
      ctx.store
        .stmt(
          `INSERT INTO play_state (guild_id, user_id, win_streak, best_streak, day_streak, streak_day, plays, wins, net_total)
           VALUES (@g, @u, @ws, @bs, @ds, @sd, @p, @w, @n)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET
             win_streak = @ws, best_streak = @bs, day_streak = @ds, streak_day = @sd,
             plays = @p, wins = @w, net_total = @n`,
        )
        .run({
          g: guildId,
          u: userId,
          ws: s.winStreak,
          bs: s.bestStreak,
          ds: s.dayStreak,
          sd: s.streakDay,
          p: s.plays,
          w: s.wins,
          n: s.netTotal,
        });
      ctx.store
        .stmt(
          `INSERT INTO weekly_stats (guild_id, week, user_id, net, plays) VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (guild_id, week, user_id) DO UPDATE SET net = net + excluded.net, plays = plays + 1`,
        )
        .run(guildId, weekId(dayNo), userId, input.net);
      for (const [id, row] of rec.rows) {
        ctx.store
          .stmt(
            `INSERT INTO missions (guild_id, user_id, day, mission_id, progress, done) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (guild_id, user_id, day, mission_id) DO UPDATE SET progress = excluded.progress, done = excluded.done`,
          )
          .run(guildId, userId, dayIso, id, row.progress, row.done ? 1 : 0);
      }
      for (const m of rec.completed) {
        creditIncome(ctx, {
          guildId,
          userId,
          amount: m.reward,
          reason: 'mission_reward',
          refType: 'mission',
          refId: `${dayIso}:${m.id}`,
          idempotencyKey: `mission:${dayIso}:${m.id}`,
        });
        emit(ctx, {
          type: 'MissionCompleted',
          guildId,
          at,
          userId,
          missionId: m.id,
          reward: m.reward,
        });
      }
      if (rec.bonus > 0) {
        creditIncome(ctx, {
          guildId,
          userId,
          amount: rec.bonus,
          reason: 'mission_reward',
          refType: 'mission',
          refId: `${dayIso}:all`,
          idempotencyKey: `mission:${dayIso}:all`,
        });
        emit(ctx, {
          type: 'MissionCompleted',
          guildId,
          at,
          userId,
          missionId: 'all_clear',
          reward: rec.bonus,
        });
      }
      return { completed: rec.completed, bonus: rec.bonus };
    });
  }

  missionStatus(guildId: string, userId: string): MissionStatus {
    const dayIso = isoDate(this.day());
    const rows = this.ctx.store
      .stmt(
        'SELECT mission_id, progress, done FROM missions WHERE guild_id = ? AND user_id = ? AND day = ?',
      )
      .all(guildId, userId, dayIso) as { mission_id: string; progress: number; done: number }[];
    const byId = new Map(rows.map((r) => [r.mission_id, r]));
    return {
      day: dayIso,
      missions: todayMissions(dayIso).map((mission) => ({
        mission,
        progress: byId.get(mission.id)?.progress ?? 0,
        done: byId.get(mission.id)?.done === 1,
      })),
    };
  }

  // ------------------------------------------------------------------ daily

  private dailyState(
    guildId: string,
    userId: string,
  ): { streak: number; lastDay: number | null; lastSlot: number | null } {
    const r = this.ctx.store
      .stmt(
        'SELECT streak, last_day, last_slot FROM daily_claims WHERE guild_id = ? AND user_id = ?',
      )
      .get(guildId, userId) as
      { streak: number; last_day: number | null; last_slot: number | null } | undefined;
    return r
      ? { streak: r.streak, lastDay: r.last_day, lastSlot: r.last_slot }
      : { streak: 0, lastDay: null, lastSlot: null };
  }

  /** Can the player claim now, and when does the next slot open? */
  dailyStatus(
    guildId: string,
    userId: string,
  ): { claimable: boolean; nextSlotAt: number; streak: number } {
    const now = this.ctx.clock.now();
    const st = this.dailyState(guildId, userId);
    const lastSlot = st.lastSlot ?? (st.lastDay === null ? null : st.lastDay + 719_163);
    return {
      claimable: lastSlot === null || dailySlot(now, this.ctx.offsetHours) > lastSlot,
      nextSlotAt: nextDailySlotMs(now, this.ctx.offsetHours),
      streak: st.streak,
    };
  }

  claimDaily(guildId: string, userId: string): DailyResult {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const now = ctx.clock.now();
      const buffs = relicBuffs(this.inventory.all(guildId, userId));
      const profile = ctx.store
        .stmt('SELECT daily_boost FROM profiles WHERE guild_id = ? AND user_id = ?')
        .get(guildId, userId) as { daily_boost: number } | undefined;
      const result = claimDaily({
        state: this.dailyState(guildId, userId),
        nowMs: now,
        offsetHours: ctx.offsetHours,
        streakGuards: this.inventory.qty(guildId, userId, 'streak_guard'),
        dailyBoost: profile?.daily_boost ?? 0,
        relicBuff: buffs.daily,
        debt: ctx.teiai.debtOf(guildId, userId),
      });
      if (!result.ok) return result;
      const slot = result.state.lastSlot as number;
      if (result.consume.streakGuard > 0) {
        this.inventory.take(guildId, userId, 'streak_guard', result.consume.streakGuard);
      }
      if (result.consume.dailyBoost > 0) {
        ctx.store
          .stmt(
            'UPDATE profiles SET daily_boost = daily_boost - 1 WHERE guild_id = ? AND user_id = ? AND daily_boost > 0',
          )
          .run(guildId, userId);
      }
      const key = `daily:${slot}`;
      // Gross credit, then the Teiai cut and the debt withholding (30 % of what is left) as sink rows.
      const ref = { refType: 'daily', refId: String(slot) } as const;
      ctx.economy.credit({
        guildId,
        userId,
        amount: result.amount,
        reason: 'daily_bonus',
        ...ref,
        idempotencyKey: key,
      });
      if (result.skimmed > 0) {
        ctx.economy.debit({
          guildId,
          userId,
          amount: result.skimmed,
          reason: 'teiai_skim',
          ...ref,
          idempotencyKey: `${key}:skim`,
        });
        ctx.teiai.houseIncome(guildId, result.skimmed, 'daily skim');
      }
      if (result.repaid > 0) {
        ctx.economy.debit({
          guildId,
          userId,
          amount: result.repaid,
          reason: 'debt_withholding',
          ...ref,
          idempotencyKey: `${key}:w`,
        });
        ctx.teiai.repayDebt(guildId, userId, result.repaid);
      }
      ctx.store
        .stmt(
          `INSERT INTO daily_claims (guild_id, user_id, streak, last_day, last_slot) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET streak = excluded.streak, last_day = excluded.last_day, last_slot = excluded.last_slot`,
        )
        .run(guildId, userId, result.state.streak, result.state.lastDay, slot);
      return result;
    });
  }

  /** Job: at each slot start, tell every player who can claim again. One event per slot and player. */
  announceDailyReady(guildId: string): number {
    const { ctx } = this;
    const now = ctx.clock.now();
    const slot = dailySlot(now, ctx.offsetHours);
    const rows = ctx.store
      .stmt(
        `SELECT user_id FROM daily_claims
         WHERE guild_id = ? AND (last_slot IS NULL OR last_slot < ?) AND (ready_slot IS NULL OR ready_slot < ?)`,
      )
      .all(guildId, slot, slot) as { user_id: string }[];
    ctx.store.transaction(() => {
      for (const { user_id } of rows) {
        ctx.store
          .stmt('UPDATE daily_claims SET ready_slot = ? WHERE guild_id = ? AND user_id = ?')
          .run(slot, guildId, user_id);
        emit(ctx, { type: 'DailyReady', guildId, at: now, userId: user_id });
      }
    });
    return rows.length;
  }

  // ------------------------------------------------------------------ transfer

  /** Principal sent today (fees excluded), from the ledger. */
  sentToday(guildId: string, userId: string): number {
    const start = dayStartMs(this.day(), this.ctx.offsetHours);
    const r = this.ctx.store
      .stmt(
        `SELECT COALESCE(-SUM(delta), 0) AS sent FROM ledger WHERE guild_id = ? AND user_id = ? AND reason = 'transfer_out' AND created_at >= ?`,
      )
      .get(guildId, userId, start) as { sent: number };
    return r.sent;
  }

  /**
   * Send Pelica. The receiver's account is created first (legacy quirk), then the checks run in
   * the legacy order. `idempotencyKey` makes a repeated request return the first result.
   */
  transfer(input: {
    guildId: string;
    senderId: string;
    receiverId: string;
    amount: number;
    idempotencyKey: string;
  }): TransferResult {
    const { ctx } = this;
    const { guildId, senderId, receiverId, amount, idempotencyKey } = input;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, senderId);
      ctx.economy.ensureMember(guildId, receiverId);
      const plan = planTransfer({
        senderId,
        receiverId,
        amount,
        senderGames: this.gamesPlayed(guildId, senderId),
        sentToday: this.sentToday(guildId, senderId),
        senderDebt: ctx.teiai.debtOf(guildId, senderId),
        senderBalance: ctx.economy.getBalance(guildId, senderId),
        receiverDebt: ctx.teiai.debtOf(guildId, receiverId),
      });
      if (!plan.ok) {
        // A retry of an already executed transfer must not turn into a limit error.
        const prior = ctx.economy
          .history(guildId, senderId, 50)
          .find((e) => e.idempotencyKey === `${idempotencyKey}:out`);
        if (prior) return this.replayed(guildId, senderId, idempotencyKey, -prior.delta);
        return plan;
      }
      const ref = { refType: 'transfer', refId: idempotencyKey } as const;
      const out = ctx.economy.debit({
        guildId,
        userId: senderId,
        amount: plan.amount,
        reason: 'transfer_out',
        ...ref,
        idempotencyKey: `${idempotencyKey}:out`,
      } as Parameters<typeof ctx.economy.debit>[0]);
      if (out.replayed) return this.replayed(guildId, senderId, idempotencyKey, plan.amount);
      ctx.economy.debit({
        guildId,
        userId: senderId,
        amount: plan.fee,
        reason: 'transfer_fee',
        ...ref,
        idempotencyKey: `${idempotencyKey}:fee`,
      } as Parameters<typeof ctx.economy.debit>[0]);
      const { withheld } = creditIncome(ctx, {
        guildId,
        userId: receiverId,
        amount: plan.amount,
        reason: 'transfer_in',
        ...ref,
        idempotencyKey: `${idempotencyKey}:in`,
      });
      return {
        ok: true,
        amount: plan.amount,
        fee: plan.fee,
        received: plan.amount,
        withheld,
        senderBalance: ctx.economy.getBalance(guildId, senderId),
      };
    });
  }

  private replayed(
    guildId: string,
    senderId: string,
    key: string,
    amount: number,
  ): TransferOutcome {
    const fee = this.ctx.economy
      .history(guildId, senderId, 50)
      .find((e) => e.idempotencyKey === `${key}:fee`);
    return {
      ok: true,
      amount,
      fee: fee ? -fee.delta : 0,
      received: amount,
      withheld: 0,
      senderBalance: this.ctx.economy.getBalance(guildId, senderId),
    };
  }

  // ------------------------------------------------------------------ weekly ranking

  weeklyRows(guildId: string, week: string): WeeklyRow[] {
    return (
      this.ctx.store
        .stmt('SELECT user_id, net, plays FROM weekly_stats WHERE guild_id = ? AND week = ?')
        .all(guildId, week) as { user_id: string; net: number; plays: number }[]
    ).map((r) => ({ userId: r.user_id, net: r.net, plays: r.plays }));
  }

  /** Top `top` of the week, ranked in SQL (`sortStandings` order: ids compare as numbers). */
  weeklyStandings(guildId: string, week = weekId(this.day()), top = 5): WeeklyRow[] {
    return (
      this.ctx.store
        .stmt(
          `SELECT user_id, net, plays FROM weekly_stats WHERE guild_id = ? AND week = ?
           ORDER BY net DESC, plays ASC, length(user_id) ASC, user_id ASC LIMIT ?`,
        )
        .all(guildId, week, top) as { user_id: string; net: number; plays: number }[]
    ).map((r) => ({ userId: r.user_id, net: r.net, plays: r.plays }));
  }

  /** The player's place in the week, counted in SQL without loading the standings. */
  weeklyRankOf(
    guildId: string,
    userId: string,
    week = weekId(this.day()),
  ): ReturnType<typeof weeklyRank> {
    const mine = this.ctx.store
      .stmt('SELECT net, plays FROM weekly_stats WHERE guild_id = ? AND week = ? AND user_id = ?')
      .get(guildId, week, userId) as { net: number; plays: number } | undefined;
    if (!mine) return null;
    const counts = this.ctx.store
      .stmt(
        `SELECT COUNT(*) AS total,
                SUM(net > ? OR (net = ? AND (plays < ? OR (plays = ? AND (length(user_id) < ?
                  OR (length(user_id) = ? AND user_id < ?)))))) AS ahead
         FROM weekly_stats WHERE guild_id = ? AND week = ?`,
      )
      .get(
        mine.net,
        mine.net,
        mine.plays,
        mine.plays,
        userId.length,
        userId.length,
        userId,
        guildId,
        week,
      ) as { total: number; ahead: number };
    return { rank: counts.ahead + 1, net: mine.net, plays: mine.plays, total: counts.total };
  }

  /** The latest weekly champion and how many weeks they won in total. */
  lastChampion(
    guildId: string,
  ): { userId: string; week: string; net: number; wins: number } | null {
    const r = this.ctx.store
      .stmt(
        'SELECT user_id, week, net FROM weekly_champions WHERE guild_id = ? ORDER BY week DESC LIMIT 1',
      )
      .get(guildId) as { user_id: string; week: string; net: number } | undefined;
    if (!r) return null;
    const wins = (
      this.ctx.store
        .stmt('SELECT COUNT(*) AS n FROM weekly_champions WHERE guild_id = ? AND user_id = ?')
        .get(guildId, r.user_id) as { n: number }
    ).n;
    return { userId: r.user_id, week: r.week, net: r.net, wins };
  }

  /**
   * Job (every 5 minutes, per guild): after Monday 00:00 settle the week that just ended once.
   * The first run only seeds `weekly_state`, so a new guild does not announce an empty past week.
   */
  settleWeekly(guildId: string): WeeklyAward | null {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const prev = previousWeekId(this.day());
      const last =
        (
          ctx.store.stmt('SELECT last_week FROM weekly_state WHERE guild_id = ?').get(guildId) as
            { last_week: string } | undefined
        )?.last_week ?? null;
      if (last === null) {
        ctx.store
          .stmt('INSERT INTO weekly_state (guild_id, last_week) VALUES (?, ?)')
          .run(guildId, prev);
        return null;
      }
      const rows = this.weeklyRows(guildId, prev);
      const holders = (
        ctx.store
          .stmt(
            `SELECT user_id FROM inventory WHERE guild_id = ? AND item_id = 'title_weekly_king' AND qty > 0`,
          )
          .all(guildId) as { user_id: string }[]
      ).map((r) => r.user_id);
      const wins = new Map(
        (
          ctx.store
            .stmt(
              'SELECT user_id, COUNT(*) AS n FROM weekly_champions WHERE guild_id = ? GROUP BY user_id',
            )
            .all(guildId) as { user_id: string; n: number }[]
        ).map((r) => [r.user_id, r.n]),
      );
      const award = settleWeek({ week: prev, lastWeek: last, rows, holders, priorWins: wins });
      if (!award) return null;
      ctx.store
        .stmt(`DELETE FROM inventory WHERE guild_id = ? AND item_id = 'title_weekly_king'`)
        .run(guildId);
      ctx.store
        .stmt(`UPDATE profiles SET title = NULL WHERE guild_id = ? AND title = 'title_weekly_king'`)
        .run(guildId);
      const champ = pickChampion(rows);
      if (champ) {
        ctx.store
          .stmt(
            'INSERT OR REPLACE INTO weekly_champions (guild_id, week, user_id, net) VALUES (?, ?, ?, ?)',
          )
          .run(guildId, prev, champ.userId, champ.net);
        this.inventory.add(guildId, champ.userId, 'title_weekly_king', 1);
        emit(ctx, {
          type: 'TitleAwarded',
          guildId,
          at: ctx.clock.now(),
          userId: champ.userId,
          titleId: 'title_weekly_king',
          week: prev,
        });
      }
      ctx.store.stmt('UPDATE weekly_state SET last_week = ? WHERE guild_id = ?').run(prev, guildId);
      return award;
    });
  }

  /** Bonus paid when all three missions of a day are done (exposed for the UI). */
  static readonly COMPLETE_BONUS = MISSION_COMPLETE_BONUS;

  assertMember(guildId: string, userId: string): void {
    if (!this.ctx.economy.hasAccount(guildId, userId)) throw new AppError('not_found');
  }
}
