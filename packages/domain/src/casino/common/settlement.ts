import type { Rng } from '@casino/shared';
import { EVENT_BONUS_CAP, INSURANCE_CAP, LOSS_SHARE_PERCENT } from './constants.ts';
import { drawJackpot, jackpotContribution } from './jackpot.ts';
import { adjustPayout, type RtpProfile } from './rtp.ts';

/**
 * Sudden/manual event bonus: a share of the profit, capped. `boost` is 0.5 for +50 %.
 * Nothing when the round did not profit.
 */
export function eventBonus(bet: number, payout: number, boost: number): number {
  if (boost <= 0 || payout <= bet) return 0;
  return Math.min(Math.trunc((payout - bet) * boost), EVENT_BONUS_CAP);
}

/** Two overlapping events never stack: the better one wins. */
export function bestBoost(scheduled: number, manual: number): number {
  return Math.max(scheduled, manual);
}

/** Half the stake back on a total loss, at most `INSURANCE_CAP`. */
export function insuranceRefund(amount: number): number {
  return Math.min(Math.floor(amount / 2), INSURANCE_CAP);
}

export interface SettlementInput {
  /** What the player has at stake (the whole escrow, doubles included). */
  amount: number;
  /** Gross payout the game produced (stake included), before any adjustment. */
  payout: number;
  /** Guild RTP level for this game (and bet kind), 3 when untouched. */
  rtpLevel: number;
  rtpProfile: RtpProfile;
  /** Pachinko adjusts every set itself; the pipeline must not do it again. */
  rtpDone?: boolean;
  /** Event boost that applies to this game right now (0 = none). */
  boost: number;
  /** The player holds an insurance ticket (used only on a payout of 0). */
  hasInsurance: boolean;
  /** Extra amount owed above the stake (chinchiro multiplier loss), 0 otherwise. */
  penalty: number;
  /** Jackpot pool before this settlement. */
  jackpotPool: number;
}

export interface Settlement {
  /** Payout after the RTP adjustment (what the game paid before bonuses). */
  payout: number;
  /** `adjusted payout - raw payout`; hidden from players. */
  rtpShift: number;
  eventBonus: number;
  /** Insurance refund; > 0 means the ticket was used. */
  insured: number;
  /** `payout + eventBonus + insured`: what is credited for the round. */
  total: number;
  /** Net profit above the stake on which debt withholding applies. */
  withholdable: number;
  /** `max(0, amount - total)`. */
  lost: number;
  /** Teiai bank's share of the loss. */
  bankShare: number;
  /** Added to the jackpot pool. */
  jackpotContribution: number;
  penalty: number;
  /** `total - amount - penalty`. */
  net: number;
  jackpotHit: boolean;
  /** Pool paid out when `jackpotHit` (including this round's contribution). */
  jackpotAmount: number;
  /** Pool left after this settlement. */
  jackpotPoolAfter: number;
}

/**
 * Steps A–F and H of the legacy settlement, as one pure function: RTP adjustment, event
 * bonus, insurance, loss shares, jackpot draw. Moving the money (credit, withholding,
 * penalty, escrow) is the server's job.
 */
export function settle(input: SettlementInput, rng: Rng): Settlement {
  const { amount } = input;
  let payout = input.payout;
  let rtpShift = 0;
  if (!input.rtpDone) {
    const adjusted = adjustPayout(input.rtpProfile, input.rtpLevel, amount, payout);
    rtpShift = adjusted - payout;
    payout = adjusted;
  }
  const bonus = eventBonus(amount, payout, input.boost);
  payout += bonus;
  const insured = payout === 0 && input.hasInsurance ? insuranceRefund(amount) : 0;
  const total = payout + insured;
  const lost = Math.max(0, amount - total);
  const bankShare = Math.floor((lost * LOSS_SHARE_PERCENT) / 100);
  const contribution = jackpotContribution(lost);
  const pool = input.jackpotPool + contribution;
  const jackpotHit = drawJackpot(rng, amount, pool);
  return {
    payout: payout - bonus,
    rtpShift,
    eventBonus: bonus,
    insured,
    total,
    withholdable: Math.max(0, payout - amount),
    lost,
    bankShare,
    jackpotContribution: contribution,
    penalty: Math.max(0, input.penalty),
    net: total - amount - Math.max(0, input.penalty),
    jackpotHit,
    jackpotAmount: jackpotHit ? pool : 0,
    jackpotPoolAfter: jackpotHit ? 0 : pool,
  };
}

/** Big-win tier from `net / bet`: 50× jackpot class, 10× super, 3× big. */
export function winTier(net: number, bet: number): 'jackpot' | 'super' | 'big' | null {
  if (bet <= 0 || net <= 0) return null;
  const ratio = net / bet;
  if (ratio >= 50) return 'jackpot';
  if (ratio >= 10) return 'super';
  if (ratio >= 3) return 'big';
  return null;
}
