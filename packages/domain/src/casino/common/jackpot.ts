import type { Rng } from '@casino/shared';

/** Share of every loss that feeds the guild's shared jackpot (percent). */
export const JACKPOT_SHARE_PERCENT = 5;
/** The chance is `bet / PELICA_PER_CERTAIN`: this bet is a sure hit before the cap. */
export const PELICA_PER_CERTAIN = 2_000_000;
/** No settlement hits with more than this chance (reached at a 40,000 bet). */
export const JACKPOT_MAX_CHANCE = 0.02;
/** The jackpot cannot hit while the pool is below this. */
export const JACKPOT_MIN_POOL = 10_000;

/** What a loss adds to the pool: `floor(lost * 5%)`. */
export function jackpotContribution(lost: number): number {
  return lost <= 0 ? 0 : Math.floor((lost * JACKPOT_SHARE_PERCENT) / 100);
}

export function jackpotChance(bet: number, pool: number): number {
  if (bet <= 0 || pool < JACKPOT_MIN_POOL) return 0;
  return Math.min(JACKPOT_MAX_CHANCE, bet / PELICA_PER_CERTAIN);
}

/** One draw per settlement (none when the chance is 0). */
export function drawJackpot(rng: Rng, bet: number, pool: number): boolean {
  const p = jackpotChance(bet, pool);
  return p > 0 && rng.float() < p;
}
