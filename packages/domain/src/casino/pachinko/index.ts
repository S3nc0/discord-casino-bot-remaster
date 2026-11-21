import type { Rng } from '@casino/shared';
import { adjustPayout, type RtpProfile } from '../common/rtp.ts';

export const BALLS_PER_SET = 100;
export const P_START = 0.07;
export const MAX_SETS = 10;
export const HIT_TARGET = 0.01322;
/** After each round the chain continues with this probability (mean 2 rounds). */
export const CONTINUE = 0.5;

export type Omen = '' | 'blue' | 'red' | 'gold';
export type Tier = '' | 'normal' | 'super' | 'premium';

interface Entry<K extends string> {
  key: K;
  prob: number;
  bonus: number;
}

export const OMEN_TABLE: readonly Entry<Omen>[] = [
  { key: '', prob: 0.75, bonus: 0 },
  { key: 'blue', prob: 0.15, bonus: 0.002 },
  { key: 'red', prob: 0.08, bonus: 0.01 },
  { key: 'gold', prob: 0.02, bonus: 0.08 },
];

export const TIER_TABLE: readonly Entry<Tier>[] = [
  { key: '', prob: 0.85, bonus: 0 },
  { key: 'normal', prob: 0.1, bonus: 0.01 },
  { key: 'super', prob: 0.04, bonus: 0.12 },
  { key: 'premium', prob: 0.01, bonus: 0.45 },
];

export const ROUNDS = [
  { name: 'small', mult: 2, prob: 0.695 },
  { name: 'big', mult: 10, prob: 0.265 },
  { name: 'kakuhen', mult: 30, prob: 0.04 },
] as const;

const sumBonus = (table: readonly Entry<string>[]): number =>
  table.reduce((sum, e) => sum + e.prob * e.bonus, 0);

/** The hit probability of a spin with no omen and no reach. */
export const BASE_HIT = HIT_TARGET - (sumBonus(OMEN_TABLE) + sumBonus(TIER_TABLE));

export function hitProbability(omen: Omen, tier: Tier): number {
  const o = OMEN_TABLE.find((e) => e.key === omen)?.bonus ?? 0;
  const t = TIER_TABLE.find((e) => e.key === tier)?.bonus ?? 0;
  return Math.min(1, BASE_HIT + o + t);
}

/** Weighted draw with `rng.choices` semantics: `random() * total` against cumulative weights. */
function weighted<K extends string>(rng: Rng, table: readonly Entry<K>[]): K {
  const total = table.reduce((sum, e) => sum + e.prob, 0);
  const x = rng.float() * total;
  let cum = 0;
  for (const e of table) {
    cum += e.prob;
    if (x < cum) return e.key;
  }
  return (table[table.length - 1] as Entry<K>).key;
}

export interface PachinkoSpin {
  omen: Omen;
  tier: Tier;
  hitProb: number;
  hit: boolean;
  /** Round multipliers of the chain, empty on a miss. */
  rounds: number[];
}

/** The chain after a hit: draw a round, then continue with probability `CONTINUE`. */
export function rollRounds(rng: Rng): number[] {
  const chain: number[] = [];
  const total = ROUNDS.reduce((sum, r) => sum + r.prob, 0);
  for (;;) {
    const x = rng.float() * total;
    let cum = 0;
    let mult: number = ROUNDS[ROUNDS.length - 1]?.mult ?? 2;
    for (const r of ROUNDS) {
      cum += r.prob;
      if (x < cum) {
        mult = r.mult;
        break;
      }
    }
    chain.push(mult);
    if (rng.float() >= CONTINUE) return chain;
  }
}

export function rollSpin(rng: Rng): PachinkoSpin {
  const omen = weighted(rng, OMEN_TABLE);
  const tier = weighted(rng, TIER_TABLE);
  const hitProb = hitProbability(omen, tier);
  const hit = rng.float() < hitProb;
  return { omen, tier, hitProb, hit, rounds: hit ? rollRounds(rng) : [] };
}

export interface PachinkoSet {
  /** Balls (of 100) that entered the start pocket. */
  starts: number;
  spins: PachinkoSpin[];
  /** Sum of all round multipliers of the set, uncapped. */
  raw: number;
}

export function rollSet(rng: Rng): PachinkoSet {
  let starts = 0;
  for (let i = 0; i < BALLS_PER_SET; i++) if (rng.float() < P_START) starts += 1;
  const spins: PachinkoSpin[] = [];
  for (let i = 0; i < starts; i++) spins.push(rollSpin(rng));
  const raw = spins.reduce((sum, s) => sum + s.rounds.reduce((a, b) => a + b, 0), 0);
  return { starts, spins, raw };
}

export function clampSets(sets: number): number {
  return Math.max(1, Math.min(Math.trunc(sets), MAX_SETS));
}

export interface PachinkoPlay {
  sets: PachinkoSet[];
  /** Total stake: `bet * sets`. */
  total: number;
  /** Sum of the per-set payouts after the RTP level (the pipeline must not adjust again). */
  payout: number;
  /** The same, before the level. */
  rawPayout: number;
}

/**
 * Play `sets` sets of `bet` each. The RTP level applies per set (a set pays `bet * raw`), then
 * the amounts are summed; settle the aggregate with `rtpDone`.
 */
export function play(rng: Rng, bet: number, sets: number, rtpLevel: number): PachinkoPlay {
  const n = clampSets(sets);
  const results: PachinkoSet[] = [];
  for (let i = 0; i < n; i++) results.push(rollSet(rng));
  const profile = PACHINKO_PROFILE;
  const rawPayout = results.reduce((sum, r) => sum + bet * r.raw, 0);
  const payout = results.reduce(
    (sum, r) => sum + adjustPayout(profile, rtpLevel, bet, bet * r.raw),
    0,
  );
  return { sets: results, total: bet * n, payout, rawPayout };
}

/** Mean chain multiplier: `E[round] / (1 - CONTINUE)`. */
const MEAN_CHAIN =
  ROUNDS.reduce((sum, r) => sum + r.mult * r.prob, 0) /
  (1 - CONTINUE) /
  ROUNDS.reduce((sum, r) => sum + r.prob, 0);

/** Chance a set has at least one hit, and the mean payout per bet (analytic). */
export function hitRate(): number {
  return 1 - (1 - P_START * HIT_TARGET) ** BALLS_PER_SET;
}
export function rtp(): number {
  return BALLS_PER_SET * P_START * HIT_TARGET * MEAN_CHAIN;
}

export const PACHINKO_PROFILE: RtpProfile = { rtp: rtp(), w: rtp() - hitRate() };

/** Rank label thresholds of a chain's total multiplier (display). */
export function rankOf(raw: number): 'legend' | 'great' | 'good' | 'small' {
  if (raw >= 100) return 'legend';
  if (raw >= 30) return 'great';
  if (raw >= 10) return 'good';
  return 'small';
}
