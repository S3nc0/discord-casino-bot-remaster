import type { CasinoGame } from './constants.ts';

/** Per-guild, per-game payout tuning: 1..6, default 3 (the row is absent at 3). */
export const RTP_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type RtpLevel = (typeof RTP_LEVELS)[number];
export const DEFAULT_RTP_LEVEL: RtpLevel = 3;
/** RTP moves 4 percentage points per level. */
export const RTP_STEP = 0.04;

export function isRtpLevel(value: number): value is RtpLevel {
  return (RTP_LEVELS as readonly number[]).includes(value);
}

/** Base return to player and the win share `W` (the part of the RTP a level scales). */
export interface RtpProfile {
  readonly rtp: number;
  readonly w: number;
}

export function rtpFactor(profile: RtpProfile, level: number): number {
  return 1 + ((level - DEFAULT_RTP_LEVEL) * RTP_STEP) / profile.w;
}

export function approxRtp(profile: RtpProfile, level: number): number {
  return profile.rtp + (level - DEFAULT_RTP_LEVEL) * RTP_STEP;
}

/**
 * Scale the winnings of one round: unchanged at level 3 or when the payout does not exceed
 * the bet, else `bet + floor((payout - bet) * factor)`.
 */
export function adjustPayout(
  profile: RtpProfile,
  level: number,
  bet: number,
  payout: number,
): number {
  if (level === DEFAULT_RTP_LEVEL || payout <= bet) return payout;
  return bet + Math.max(0, Math.trunc((payout - bet) * rtpFactor(profile, level)));
}

/** Fixed profiles of the two games whose odds depend on the player's play. */
export const CHINCHIRO_PROFILE: RtpProfile = { rtp: 0.985, w: 0.653 };
export const BLACKJACK_PROFILE: RtpProfile = { rtp: 0.918, w: 0.412 };

/** The level is a policy of the guild owner and is never shown to players. */
export type RtpGame = CasinoGame;
