/** Games this module settles. Same ids as `GameId` in @casino/shared. */
export const CASINO_GAMES = ['chinchiro', 'pachinko', 'slots', 'blackjack', 'roulette'] as const;
export type CasinoGame = (typeof CASINO_GAMES)[number];

export function isCasinoGame(value: string): value is CasinoGame {
  return (CASINO_GAMES as readonly string[]).includes(value);
}

/** Smallest bet, in Pelica. There is no upper bound beyond the balance. */
export const MIN_BET = 10;

/** One player holds at most one casino round at a time; this long after it ends (ms). */
export const SESSION_COOLDOWN_MS = 1500;

/** Insurance ticket: refunds half the stake on a total loss, at most this much. */
export const INSURANCE_CAP = 1000;

/** The Teiai bank takes this share of every loss (percent). */
export const LOSS_SHARE_PERCENT = 3;

/** Largest event bonus on one settlement. */
export const EVENT_BONUS_CAP = 10_000;
