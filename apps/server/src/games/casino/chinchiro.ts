import { CHINCHIRO_PROFILE, chinchiro as chin } from '@casino/domain/casino';
import { AppError } from '../../runtime/errors.ts';
import type { RoundRow } from './core.ts';
import type { GameContext } from './context.ts';
import type { Caller, SettlementSummary } from './types.ts';

/** The player has this long to click a roll before the last roll (or menashi) stands. */
export const CHINCHIRO_TURN_MS = 60_000;

export interface ChinchiroView {
  roundId: string;
  stake: number;
  status: 'player_turn' | 'settled';
  dealerRolls: chin.ChinchiroRoll[];
  playerRolls: chin.ChinchiroRoll[];
  rollsLeft: number;
  /** Epoch ms when the turn times out (player_turn only). */
  deadline: number | null;
  result?: {
    outcome: chin.ChinchiroResult;
    multiplier: number;
    payout: number;
    penalty: number;
    settlement: SettlementSummary;
  };
}

interface Live {
  round: chin.ChinchiroRound;
  row: RoundRow;
  deadline: number;
  cancel: () => void;
}

export class ChinchiroService {
  private readonly ctx: GameContext;
  private readonly live = new Map<string, Live>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /** Stake and let the dealer roll. The player rolls with `roll`. */
  start(caller: Caller, params: { stake: number; idempotencyKey?: string }) {
    const { core, idem, rng, clock, scheduler } = this.ctx;
    return idem.run(
      caller,
      params.idempotencyKey,
      'game:bet:chinchiro',
      { stake: params.stake },
      () => {
        const row = core.begin(caller, 'chinchiro', params.stake);
        const round = chin.startRound(rng, params.stake);
        const deadline = clock.now() + CHINCHIRO_TURN_MS;
        const live: Live = {
          round,
          row,
          deadline,
          cancel: scheduler.after(CHINCHIRO_TURN_MS, () => this.timeout(row.roundId)),
        };
        this.live.set(row.roundId, live);
        return this.view(live);
      },
    );
  }

  /** One player roll. A scoring hand, or the third roll, ends the round and pays it. */
  roll(caller: Caller, params: { roundId: string; idempotencyKey?: string }) {
    const { idem, rng } = this.ctx;
    return idem.run(caller, params.idempotencyKey, 'game:action:chinchiro', params, () => {
      const live = this.own(caller, params.roundId);
      live.round = chin.playerRoll(rng, live.round);
      if (live.round.status === 'settled') return this.settle(live);
      return this.view(live);
    });
  }

  /** The state of the caller's open round, if any. */
  current(caller: Caller): ChinchiroView | null {
    for (const live of this.live.values()) {
      if (live.row.guildId === caller.guildId && live.row.userId === caller.userId) {
        return this.view(live);
      }
    }
    return null;
  }

  private own(caller: Caller, roundId: string): Live {
    const live = this.live.get(roundId);
    if (!live || live.row.guildId !== caller.guildId || live.row.userId !== caller.userId) {
      throw new AppError('conflict');
    }
    return live;
  }

  private timeout(roundId: string): void {
    const live = this.live.get(roundId);
    if (!live) return;
    try {
      live.round = chin.forceSettle(live.round);
      this.settle(live);
    } catch (error) {
      this.ctx.logger.error({ err: error, roundId }, 'chinchiro timeout settle failed');
    }
  }

  private settle(live: Live): ChinchiroView {
    const { core } = this.ctx;
    const outcome = chin.resolve(live.round);
    const settlement = core.settle(live.row, {
      payout: outcome.payout,
      penalty: outcome.penalty,
      profile: CHINCHIRO_PROFILE,
    });
    live.cancel();
    this.live.delete(live.row.roundId);
    return {
      ...this.view(live),
      result: {
        outcome: outcome.result,
        multiplier: outcome.multiplier,
        payout: outcome.payout,
        penalty: outcome.penalty,
        settlement,
      },
    };
  }

  private view(live: Live): ChinchiroView {
    const { round } = live;
    return {
      roundId: live.row.roundId,
      stake: round.bet,
      status: round.status,
      dealerRolls: round.dealerRolls,
      playerRolls: round.playerRolls,
      rollsLeft: round.status === 'settled' ? 0 : chin.MAX_ROLLS - round.playerRolls.length,
      deadline: round.status === 'settled' ? null : live.deadline,
    };
  }
}
