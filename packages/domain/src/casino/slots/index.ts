import type { Rng } from '@casino/shared';
import type { RtpProfile } from '../common/rtp.ts';

export const SLOT_SYMBOLS = [
  { symbol: '🍒', weight: 10, threeMult: 5 },
  { symbol: '🍋', weight: 8, threeMult: 8 },
  { symbol: '🍇', weight: 6, threeMult: 15 },
  { symbol: '🔔', weight: 4, threeMult: 30 },
  { symbol: '💎', weight: 2, threeMult: 100 },
  { symbol: '7️⃣', weight: 1, threeMult: 500 },
] as const;

export type SlotSymbol = (typeof SLOT_SYMBOLS)[number]['symbol'];
export type Reels = readonly [SlotSymbol, SlotSymbol, SlotSymbol];

const CHERRY: SlotSymbol = '🍒';
/** Two cherries pay 1.5×, one cherry 0.3× (a small loss), in tenths of the bet. */
export const CHERRY_TWO_TENTHS = 15;
export const CHERRY_ONE_TENTHS = 3;

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const CUMULATIVE: number[] = [];
SLOT_SYMBOLS.reduce((sum, s) => {
  CUMULATIVE.push(sum + s.weight);
  return sum + s.weight;
}, 0);

/** One reel: a weighted draw (`floor(random * 31)` against the cumulative weights). */
export function drawSymbol(rng: Rng): SlotSymbol {
  const x = rng.float() * TOTAL_WEIGHT;
  const index = CUMULATIVE.findIndex((cum) => x < cum);
  return SLOT_SYMBOLS[index < 0 ? SLOT_SYMBOLS.length - 1 : index]!.symbol;
}

export function spinReels(rng: Rng): Reels {
  return [drawSymbol(rng), drawSymbol(rng), drawSymbol(rng)];
}

/** Payout multiplier in tenths of the bet (so the payout stays integer). */
export function multiplierTenths(reels: Reels): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_SYMBOLS.find((s) => s.symbol === a)!.threeMult * 10;
  const cherries = reels.filter((r) => r === CHERRY).length;
  if (cherries === 2) return CHERRY_TWO_TENTHS;
  if (cherries === 1) return CHERRY_ONE_TENTHS;
  return 0;
}

export function multiplier(reels: Reels): number {
  return multiplierTenths(reels) / 10;
}

/** `floor(bet * multiplier)`, in integers. */
export function slotPayout(bet: number, reels: Reels): number {
  return Math.floor((bet * multiplierTenths(reels)) / 10);
}

export type SlotLabel =
  | { kind: 'jackpot' }
  | { kind: 'triple'; symbol: SlotSymbol }
  | { kind: 'cherry2' }
  | { kind: 'cherry1' }
  | { kind: 'miss' };

export function labelOf(reels: Reels): SlotLabel {
  const [a, b, c] = reels;
  if (a === b && b === c) return a === '7️⃣' ? { kind: 'jackpot' } : { kind: 'triple', symbol: a };
  const cherries = reels.filter((r) => r === CHERRY).length;
  if (cherries === 2) return { kind: 'cherry2' };
  if (cherries === 1) return { kind: 'cherry1' };
  return { kind: 'miss' };
}

/** Exact base RTP and win share over all 31³ weighted outcomes. */
function profile(): RtpProfile {
  let rtp = 0;
  let w = 0;
  const total = TOTAL_WEIGHT ** 3;
  for (const x of SLOT_SYMBOLS) {
    for (const y of SLOT_SYMBOLS) {
      for (const z of SLOT_SYMBOLS) {
        const p = (x.weight * y.weight * z.weight) / total;
        const m = multiplier([x.symbol, y.symbol, z.symbol]);
        rtp += p * m;
        w += p * Math.max(0, m - 1);
      }
    }
  }
  return { rtp, w };
}

export const SLOTS_PROFILE: RtpProfile = profile();
