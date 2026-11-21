import { MIN_BET, pachinko } from '@casino/domain/casino';
import { AppError } from '../../runtime/errors.ts';
import type { GameContext } from './context.ts';
import type { Caller, SettlementSummary } from './types.ts';

export interface PachinkoResult {
  roundId: string;
  /** Bet per set. */
  bet: number;
  sets: pachinko.PachinkoSet[];
  /** Highest single round multiplier of the play (0 when nothing hit). */
  topRound: number;
  settlement: SettlementSummary;
}

export class PachinkoService {
  private readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /**
   * 1–10 sets of 100 balls, one escrow of `stake * sets`, one game for missions and ranking.
   * The RTP level applies per set; the aggregate settles with `rtpDone`.
   */
  play(caller: Caller, params: { stake: number; sets?: number; idempotencyKey?: string }) {
    const { core, idem, rng, clock } = this.ctx;
    const sets = pachinko.clampSets(params.sets ?? 1);
    return idem.run(
      caller,
      params.idempotencyKey,
      'game:bet:pachinko',
      { stake: params.stake, sets },
      (): PachinkoResult => {
        if (!Number.isSafeInteger(params.stake) || params.stake < MIN_BET) {
          throw new AppError('invalid_payload', { message: `minimum bet is ${MIN_BET}` });
        }
        const level = core.rtpLevel(caller.guildId, 'pachinko');
        const outcome = pachinko.play(rng, params.stake, sets, level);
        const row = core.begin(caller, 'pachinko', outcome.total);
        const settlement = core.settle(row, {
          payout: outcome.payout,
          profile: pachinko.PACHINKO_PROFILE,
          rtpDone: true,
        });
        this.record(row.roundId, caller, outcome.sets, clock.now());
        return {
          roundId: row.roundId,
          bet: params.stake,
          sets: outcome.sets,
          topRound: Math.max(0, ...outcome.sets.flatMap((s) => s.spins.flatMap((p) => p.rounds))),
          settlement,
        };
      },
    );
  }

  /** Statistics for the admin view. A failure here never undoes a settled play. */
  private record(roundId: string, caller: Caller, sets: pachinko.PachinkoSet[], at: number): void {
    const { core, logger } = this.ctx;
    try {
      core.store.transaction(() => {
        const insertSet = core.store.stmt(
          'INSERT INTO pachinko_sets (round_id, set_index, guild_id, user_id, starts, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        const insertSpin = core.store.stmt(
          'INSERT INTO pachinko_spins (round_id, set_index, spin_index, omen, tier, hit, rounds) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        sets.forEach((set, i) => {
          insertSet.run(roundId, i, caller.guildId, caller.userId, set.starts, set.raw, at);
          set.spins.forEach((spin, j) => {
            insertSpin.run(
              roundId,
              i,
              j,
              spin.omen,
              spin.tier,
              spin.hit ? 1 : 0,
              JSON.stringify(spin.rounds),
            );
          });
        });
      });
    } catch (error) {
      logger.warn({ err: error, roundId }, 'pachinko statistics not recorded');
    }
  }
}
