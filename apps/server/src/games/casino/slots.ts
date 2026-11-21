import { slots } from '@casino/domain/casino';
import type { GameContext } from './context.ts';
import type { Caller, SettlementSummary } from './types.ts';

export interface SlotsResult {
  roundId: string;
  reels: slots.Reels;
  /** Payout multiple of the bet (0.3, 1.5, 5 ... 500). */
  multiplier: number;
  label: slots.SlotLabel;
  settlement: SettlementSummary;
}

export class SlotsService {
  private readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /** One spin: stake, spin, pay, all at once. */
  play(caller: Caller, params: { stake: number; idempotencyKey?: string }) {
    const { core, idem, rng } = this.ctx;
    return idem.run(
      caller,
      params.idempotencyKey,
      'game:bet:slots',
      { stake: params.stake },
      (): SlotsResult => {
        const row = core.begin(caller, 'slots', params.stake);
        const reels = slots.spinReels(rng);
        const settlement = core.settle(row, {
          payout: slots.slotPayout(params.stake, reels),
          profile: slots.SLOTS_PROFILE,
        });
        return {
          roundId: row.roundId,
          reels,
          multiplier: slots.multiplier(reels),
          label: slots.labelOf(reels),
          settlement,
        };
      },
    );
  }
}
