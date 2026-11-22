import {
  DEFAULT_MINUTES,
  drawLottery,
  MAX_MINUTES,
  MIN_FEE,
  randomFee,
  validateJoin,
  type LotteryStatus,
} from '@casino/domain/lottery';
import { creditIncome, emit, GameRuleError, type GamesCtx } from '../progression/context.ts';

interface RaffleRow {
  id: number;
  guild_id: string;
  host_id: string;
  fee: number;
  closes_at: number;
  status: LotteryStatus;
  winner_id: string | null;
  prize: number;
}

export interface RaffleView extends RaffleRow {
  entrants: string[];
}

/** Admin-hosted guild raffle: one open at a time, one winner takes the pot or everyone is refunded. */
export class LotteryService {
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
  }

  private entrants(id: number): string[] {
    return (
      this.ctx.store
        .stmt('SELECT user_id FROM raffle_entries WHERE raffle_id = ? ORDER BY at, user_id')
        .all(id) as { user_id: string }[]
    ).map((r) => r.user_id);
  }

  current(guildId: string): RaffleView | null {
    const r = this.ctx.store
      .stmt(`SELECT * FROM raffles WHERE guild_id = ? AND status = 'open'`)
      .get(guildId) as RaffleRow | undefined;
    return r ? { ...r, entrants: this.entrants(r.id) } : null;
  }

  /** The most recent raffle that is over (drawn, refunded or cancelled), for the result panel. */
  latestEnded(guildId: string): RaffleView | null {
    const r = this.ctx.store
      .stmt(
        `SELECT * FROM raffles WHERE guild_id = ? AND status != 'open' ORDER BY id DESC LIMIT 1`,
      )
      .get(guildId) as RaffleRow | undefined;
    return r ? { ...r, entrants: this.entrants(r.id) } : null;
  }

  host(input: { guildId: string; hostId: string; fee?: number; minutes?: number }): RaffleView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      if (this.current(input.guildId)) throw new GameRuleError('raffle_already_open');
      const fee = input.fee ?? randomFee(ctx.rng);
      const minutes = input.minutes ?? DEFAULT_MINUTES;
      if (!Number.isInteger(fee) || fee < MIN_FEE)
        throw new GameRuleError('raffle_fee_min', { min_fee: MIN_FEE }, 'invalid_payload');
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)
        throw new GameRuleError('raffle_minutes', { max_minutes: MAX_MINUTES }, 'invalid_payload');
      ctx.economy.ensureMember(input.guildId, input.hostId);
      const info = ctx.store
        .stmt(
          `INSERT INTO raffles (guild_id, host_id, fee, closes_at, status) VALUES (?, ?, ?, ?, 'open')`,
        )
        .run(input.guildId, input.hostId, fee, ctx.clock.now() + minutes * 60_000);
      return this.get(Number(info.lastInsertRowid)) as RaffleView;
    });
  }

  get(id: number): RaffleView | null {
    const r = this.ctx.store.stmt('SELECT * FROM raffles WHERE id = ?').get(id) as
      RaffleRow | undefined;
    return r ? { ...r, entrants: this.entrants(id) } : null;
  }

  join(guildId: string, userId: string, raffleId: number): void {
    const { ctx } = this;
    ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const r = this.get(raffleId);
      if (!r || r.guild_id !== guildId) throw new GameRuleError('raffle_closed', {}, 'not_found');
      const error = validateJoin({
        nowMs: ctx.clock.now(),
        closesMs: r.closes_at,
        status: r.status,
        alreadyJoined: r.entrants.includes(userId),
        debt: ctx.teiai.debtOf(guildId, userId),
        balance: ctx.economy.getBalance(guildId, userId),
        fee: r.fee,
      });
      if (error) throw new GameRuleError(error, { fee: r.fee });
      ctx.economy.debit({
        guildId,
        userId,
        amount: r.fee,
        reason: 'lottery_entry',
        refType: 'raffle',
        refId: String(raffleId),
        idempotencyKey: `raffle:${raffleId}:join`,
      });
      ctx.store
        .stmt('INSERT INTO raffle_entries (raffle_id, guild_id, user_id, at) VALUES (?, ?, ?, ?)')
        .run(raffleId, guildId, userId, ctx.clock.now());
    });
  }

  cancel(guildId: string): RaffleView | null {
    const r = this.current(guildId);
    return r ? this.close(r.id, true) : null;
  }

  /** Job (every 20 s): draw every raffle whose time has come. */
  drawDue(guildId: string): RaffleView[] {
    const due = this.ctx.store
      .stmt(`SELECT id FROM raffles WHERE guild_id = ? AND status = 'open' AND closes_at <= ?`)
      .all(guildId, this.ctx.clock.now()) as { id: number }[];
    return due.map((d) => this.close(d.id, false));
  }

  private close(id: number, cancelled: boolean): RaffleView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const r = this.get(id) as RaffleView;
      if (r.status !== 'open') return r;
      const result = drawLottery(r.entrants, r.fee, ctx.rng, cancelled);
      if (result.outcome === 'won') {
        creditIncome(ctx, {
          guildId: r.guild_id,
          userId: result.winnerId,
          amount: result.prize,
          reason: 'lottery_prize',
          refType: 'raffle',
          refId: String(id),
          idempotencyKey: `raffle:${id}:prize`,
        });
        ctx.store
          .stmt(`UPDATE raffles SET status = 'done', winner_id = ?, prize = ? WHERE id = ?`)
          .run(result.winnerId, result.prize, id);
      } else {
        for (const userId of r.entrants) {
          ctx.economy.credit({
            guildId: r.guild_id,
            userId,
            amount: r.fee,
            reason: 'lottery_refund',
            refType: 'raffle',
            refId: String(id),
            idempotencyKey: `raffle:${id}:refund`,
          });
        }
        ctx.store
          .stmt(`UPDATE raffles SET status = ? WHERE id = ?`)
          .run(cancelled ? 'cancelled' : 'done', id);
      }
      emit(ctx, {
        type: 'LotteryDrawn',
        guildId: r.guild_id,
        at: ctx.clock.now(),
        lotteryId: id,
        outcome: result.outcome,
        ...(result.outcome === 'won' ? { winnerId: result.winnerId } : {}),
        prize: result.prize,
        fee: r.fee,
        entrantIds: r.entrants,
      });
      return this.get(id) as RaffleView;
    });
  }
}
