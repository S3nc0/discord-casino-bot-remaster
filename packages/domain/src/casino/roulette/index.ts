import type { Rng } from '@casino/shared';
import type { RtpProfile } from '../common/rtp.ts';

/** European wheel: pockets 0..36. */
export const POCKETS = 37;

export const RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteColor = 'green' | 'red' | 'black';

export function colorOf(n: number): RouletteColor {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

export const BET_KINDS = [
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'number',
] as const;
export type RouletteKind = (typeof BET_KINDS)[number];

export function isRouletteKind(value: string): value is RouletteKind {
  return (BET_KINDS as readonly string[]).includes(value);
}

/** Total payout multiple (stake included) of each bet kind. */
export const BET_MULT: Readonly<Record<RouletteKind, number>> = {
  red: 2,
  black: 2,
  even: 2,
  odd: 2,
  low: 2,
  high: 2,
  dozen1: 3,
  dozen2: 3,
  dozen3: 3,
  number: 36,
};

export interface RouletteBet {
  kind: RouletteKind;
  /** Only for `number`: 0..36. */
  number?: number;
}

/** Whether a bet is well formed: `number` needs 0..36, every other kind rejects a number. */
export function validateBet(bet: {
  kind: string;
  number?: number | undefined;
}): RouletteBet | null {
  if (!isRouletteKind(bet.kind)) return null;
  if (bet.kind === 'number') {
    const n = bet.number;
    return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 36
      ? { kind: 'number', number: n }
      : null;
  }
  return bet.number === undefined ? { kind: bet.kind } : null;
}

export function spin(rng: Rng): number {
  return rng.int(0, POCKETS);
}

export function wins(bet: RouletteBet, result: number): boolean {
  switch (bet.kind) {
    case 'red':
      return RED.has(result);
    case 'black':
      return result !== 0 && !RED.has(result);
    case 'even':
      return result !== 0 && result % 2 === 0;
    case 'odd':
      return result % 2 === 1;
    case 'low':
      return result >= 1 && result <= 18;
    case 'high':
      return result >= 19 && result <= 36;
    case 'dozen1':
      return result >= 1 && result <= 12;
    case 'dozen2':
      return result >= 13 && result <= 24;
    case 'dozen3':
      return result >= 25 && result <= 36;
    case 'number':
      return result === bet.number;
  }
}

export function payoutOf(bet: RouletteBet, stake: number, result: number): number {
  return wins(bet, result) ? stake * BET_MULT[bet.kind] : 0;
}

/** Exact RTP and win share of a bet kind: `p = hits / 37`, `RTP = p * mult`, `W = p * (mult - 1)`. */
export function rouletteProfile(kind: RouletteKind): RtpProfile {
  let hits = 0;
  for (let n = 0; n < POCKETS; n++) {
    if (wins(kind === 'number' ? { kind, number: 0 } : { kind }, n)) hits += 1;
  }
  const p = hits / POCKETS;
  const mult = BET_MULT[kind];
  return { rtp: p * mult, w: p * (mult - 1) };
}

/** Cosmetic timeline of one spin (ms from the start): ball starts, two previews, the result. */
export const SPIN_STEP_MS = 900;

export interface SpinFrame {
  atMs: number;
  kind: 'start' | 'bounce' | 'slow' | 'result';
  /** Decorative pocket shown in `bounce` and `slow`; the final one in `result`. */
  pocket?: number;
}

/**
 * The animation the room plays: three steps of 0.9 s, previews drawn from the rng (unrelated to
 * the result, as in the original) and the real pocket last.
 */
export function spinTimeline(rng: Rng, result: number): SpinFrame[] {
  return [
    { atMs: 0, kind: 'start' },
    { atMs: SPIN_STEP_MS, kind: 'bounce', pocket: spin(rng) },
    { atMs: SPIN_STEP_MS * 2, kind: 'slow', pocket: spin(rng) },
    { atMs: SPIN_STEP_MS * 3, kind: 'result', pocket: result },
  ];
}
