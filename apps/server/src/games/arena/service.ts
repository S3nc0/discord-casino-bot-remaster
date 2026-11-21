import {
  FINAL_HOUR,
  FORMAT_SHAPE,
  ARENA_FORMATS,
  generateFighters,
  matchOdds,
  MAX_STAKE,
  MIN_STAKE,
  seedSpectators,
  SEMI_HOUR,
  settleMatch,
  simulateMatch,
  battleFrames,
  type ArenaFormat,
  type FighterStage,
  type TournamentStatus,
} from '@casino/domain/arena';
import { isoDate, localDayNumber, localHour } from '@casino/domain/progression';
import { creditIncome, emit, GameRuleError, type GamesCtx } from '../progression/context.ts';

interface FighterRow {
  id: number;
  tournament_id: number;
  name: string;
  base_power: number;
  group_no: number;
  stage: FighterStage;
  result: 'won' | 'lost' | null;
  bet_total: number;
}

interface TournamentRow {
  id: number;
  guild_id: string;
  day: string;
  format: ArenaFormat;
  status: TournamentStatus;
  champion_id: number | null;
}

export interface MatchReport {
  tournamentId: number;
  stage: 'semi' | 'final';
  /** Fighter ids of each match's winner (one per semi group, one for the final). */
  winnerIds: number[];
  /** Cosmetic HP frames per match, same order as `winnerIds`. */
  frames: number[][][];
}

/** Daily NPC tournaments (1on1 and battle royale) with spectator betting. */
export class ArenaService {
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
  }

  private tournament(id: number): TournamentRow {
    const t = this.ctx.store.stmt('SELECT * FROM arena_tournaments WHERE id = ?').get(id) as
      TournamentRow | undefined;
    if (!t) throw new GameRuleError('tournament_not_found', {}, 'not_found');
    return t;
  }

  fighters(tournamentId: number): FighterRow[] {
    return this.ctx.store
      .stmt('SELECT * FROM arena_fighters WHERE tournament_id = ? ORDER BY id')
      .all(tournamentId) as FighterRow[];
  }

  /** Job (every 30 s): host today's two tournaments when they do not exist yet. */
  ensureToday(guildId: string): number[] {
    const { ctx } = this;
    const day = isoDate(localDayNumber(ctx.clock.now(), ctx.offsetHours));
    const created: number[] = [];
    ctx.store.transaction(() => {
      for (const format of ARENA_FORMATS) {
        const info = ctx.store
          .stmt(
            `INSERT OR IGNORE INTO arena_tournaments (guild_id, day, format, status) VALUES (?, ?, ?, 'semi_betting')`,
          )
          .run(guildId, day, format);
        if (info.changes === 0) continue;
        const id = Number(info.lastInsertRowid);
        created.push(id);
        const ins = ctx.store.stmt(
          `INSERT INTO arena_fighters (tournament_id, name, base_power, group_no, stage) VALUES (?, ?, ?, ?, 'semi')`,
        );
        const ids = generateFighters(format, ctx.rng).map((f) =>
          Number(ins.run(id, f.name, f.basePower, f.groupNo).lastInsertRowid),
        );
        const seed = seedSpectators(ids.length, ctx.teiai.bankCash(guildId), ctx.rng);
        if (seed.spent > 0) ctx.teiai.drawBankCash(guildId, seed.spent);
        for (const b of seed.bets) {
          ctx.store
            .stmt(
              `INSERT INTO arena_bets (tournament_id, guild_id, user_id, fighter_id, stage, amount) VALUES (?, ?, NULL, ?, 'semi', ?)`,
            )
            .run(id, guildId, ids[b.fighterIndex], b.amount);
          ctx.store
            .stmt('UPDATE arena_fighters SET bet_total = bet_total + ? WHERE id = ?')
            .run(b.amount, ids[b.fighterIndex]);
        }
      }
    });
    return created;
  }

  /** Fighters with their current odds for the open stage. */
  board(tournamentId: number): {
    tournament: TournamentRow;
    fighters: (FighterRow & { oddsHundredths: number })[];
  } {
    const t = this.tournament(tournamentId);
    const all = this.fighters(tournamentId);
    const stage: FighterStage = t.status === 'final_betting' ? 'final' : 'semi';
    const out: (FighterRow & { oddsHundredths: number })[] = all.map((f) => ({
      ...f,
      oddsHundredths: 0,
    }));
    const groups =
      stage === 'final'
        ? [all.filter((f) => f.stage === 'final')]
        : [...new Set(all.map((f) => f.group_no))].map((g) => all.filter((f) => f.group_no === g));
    for (const g of groups) {
      const odds = matchOdds(
        g.map((f) => ({ basePower: f.base_power, betTotal: f.bet_total })),
        stage === 'final',
      );
      g.forEach((f, i) => {
        (out.find((o) => o.id === f.id) as { oddsHundredths: number }).oddsHundredths = odds[
          i
        ] as number;
      });
    }
    return { tournament: t, fighters: out };
  }

  bet(input: {
    guildId: string;
    userId: string;
    tournamentId: number;
    fighterId: number;
    amount: number;
    idempotencyKey: string;
  }): void {
    const { ctx } = this;
    ctx.store.transaction(() => {
      ctx.economy.ensureMember(input.guildId, input.userId);
      const t = this.tournament(input.tournamentId);
      if (t.guild_id !== input.guildId || t.status === 'done')
        throw new GameRuleError('arena_closed');
      const f = this.fighters(t.id).find((x) => x.id === input.fighterId);
      const stage: FighterStage = t.status === 'final_betting' ? 'final' : 'semi';
      if (!f || f.stage !== stage) throw new GameRuleError('arena_fighter_out');
      if (
        !Number.isSafeInteger(input.amount) ||
        input.amount < MIN_STAKE ||
        input.amount > MAX_STAKE
      ) {
        throw new GameRuleError(
          'stake_range',
          { min_stake: MIN_STAKE, max_stake: MAX_STAKE },
          'invalid_payload',
        );
      }
      const debit = ctx.economy.debit({
        guildId: input.guildId,
        userId: input.userId,
        amount: input.amount,
        reason: 'arena_bet',
        refType: 'arena',
        refId: String(t.id),
        idempotencyKey: input.idempotencyKey,
      });
      if (debit.replayed) return;
      ctx.store
        .stmt(
          'INSERT INTO arena_bets (tournament_id, guild_id, user_id, fighter_id, stage, amount) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(t.id, input.guildId, input.userId, f.id, stage, input.amount);
      ctx.store
        .stmt('UPDATE arena_fighters SET bet_total = bet_total + ? WHERE id = ?')
        .run(input.amount, f.id);
    });
  }

  /** Job (every 30 s): resolve the semis at 09:00 and the final at 13:00 local time. */
  advance(guildId: string): MatchReport[] {
    const { ctx } = this;
    const hour = localHour(ctx.clock.now(), ctx.offsetHours);
    const open = ctx.store
      .stmt(`SELECT * FROM arena_tournaments WHERE guild_id = ? AND status != 'done'`)
      .all(guildId) as TournamentRow[];
    const reports: MatchReport[] = [];
    for (const t of open) {
      if (t.status === 'semi_betting' && hour >= SEMI_HOUR) reports.push(this.resolve(t, 'semi'));
      else if (t.status === 'final_betting' && hour >= FINAL_HOUR)
        reports.push(this.resolve(t, 'final'));
    }
    return reports;
  }

  private resolve(t: TournamentRow, stage: 'semi' | 'final'): MatchReport {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const all = this.fighters(t.id);
      const groups =
        stage === 'final'
          ? [all.filter((f) => f.stage === 'final')]
          : [...new Set(all.map((f) => f.group_no))].map((g) =>
              all.filter((f) => f.group_no === g),
            );
      const winnerIds: number[] = [];
      const frames: number[][][] = [];
      const perUser = new Map<string, { stake: number; payout: number }>();
      for (const group of groups) {
        const power = group.map((f) => ({ basePower: f.base_power, betTotal: f.bet_total }));
        const winnerIdx = simulateMatch(power, ctx.rng);
        const winner = group[winnerIdx] as FighterRow;
        winnerIds.push(winner.id);
        frames.push(battleFrames(group.length, winnerIdx, ctx.rng));
        const odds = matchOdds(power, stage === 'final');
        const ids = group.map((f) => f.id);
        const bets = (
          ctx.store
            .stmt(
              `SELECT id, user_id, fighter_id, amount FROM arena_bets WHERE tournament_id = ? AND stage = ? AND payout IS NULL`,
            )
            .all(t.id, stage) as {
            id: number;
            user_id: string | null;
            fighter_id: number;
            amount: number;
          }[]
        ).filter((b) => ids.includes(b.fighter_id));
        const result = settleMatch({
          bets: bets.map((b) => ({
            id: b.id,
            userId: b.user_id,
            fighterId: b.fighter_id,
            amount: b.amount,
          })),
          winnerIds: new Set([winner.id]),
          oddsHundredths: new Map(group.map((f, i) => [f.id, odds[i] as number])),
          bankCash: ctx.teiai.bankCash(t.guild_id),
        });
        if (result.subsidy > 0) ctx.teiai.drawBankCash(t.guild_id, result.subsidy);
        if (result.bankIncome > 0)
          ctx.teiai.bankIncome(t.guild_id, result.bankIncome, 'arena leftover');
        const payoutOf = new Map(result.payouts.map((p) => [p.betId, p.payout]));
        for (const b of bets) {
          ctx.store
            .stmt('UPDATE arena_bets SET payout = ? WHERE id = ?')
            .run(payoutOf.get(b.id) ?? 0, b.id);
          if (b.user_id === null) continue;
          const agg = perUser.get(b.user_id) ?? { stake: 0, payout: 0 };
          agg.stake += b.amount;
          agg.payout += payoutOf.get(b.id) ?? 0;
          perUser.set(b.user_id, agg);
        }
        for (const f of group) {
          const won = f.id === winner.id;
          const next: FighterStage = stage === 'semi' ? (won ? 'final' : 'out') : 'out';
          ctx.store
            .stmt('UPDATE arena_fighters SET stage = ?, result = ? WHERE id = ?')
            .run(next, stage === 'final' ? (won ? 'won' : 'lost') : won ? null : 'lost', f.id);
        }
      }
      const at = ctx.clock.now();
      for (const [userId, a] of perUser) {
        if (a.payout > 0)
          creditIncome(ctx, {
            guildId: t.guild_id,
            userId,
            amount: a.payout,
            reason: 'arena_payout',
            refType: 'arena',
            refId: `${t.id}:${stage}`,
            idempotencyKey: `arena:${t.id}:${stage}:${userId}`,
          });
        emit(ctx, {
          type: 'GameSettled',
          guildId: t.guild_id,
          at,
          userId,
          game: 'arena',
          roundId: `arena:${t.id}:${stage}`,
          stake: a.stake,
          payout: a.payout,
          net: a.payout - a.stake,
          source: 'system',
        });
      }
      if (stage === 'semi')
        ctx.store
          .stmt(`UPDATE arena_tournaments SET status = 'final_betting' WHERE id = ?`)
          .run(t.id);
      else
        ctx.store
          .stmt(`UPDATE arena_tournaments SET status = 'done', champion_id = ? WHERE id = ?`)
          .run(winnerIds[0], t.id);
      return { tournamentId: t.id, stage, winnerIds, frames };
    });
  }
}

export { FORMAT_SHAPE };
