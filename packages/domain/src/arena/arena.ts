import type { Rng } from '@casino/shared';
import { Gauss, uniform, weightedIndex } from '../progression/py-random.ts';
import { roundHalfEven } from '../progression/time.ts';

export const ARENA_FORMATS = ['duel', 'royale'] as const;
export type ArenaFormat = (typeof ARENA_FORMATS)[number];

export const SEMI_HOUR = 9;
export const FINAL_HOUR = 13;
export const BASE_POWER_MIN = 20;
export const BASE_POWER_MAX = 80;
export const WEAPON_SCALE = 50_000;
export const TAKEOUT = 0.15;
/** Odds caps are in hundredths (20.00x). */
export const MAX_ODDS_HUNDREDTHS = 2000;
export const FINAL_ODDS_BOOST_PERCENT = 130;
export const LUCK = 0.25;
export const MIN_STAKE = 100;
export const MAX_STAKE = 20_000;
export const SPECTATOR_COUNT: readonly [number, number] = [3, 8];
export const SPECTATOR_BET: readonly [number, number] = [100, 3000];
export const HOUSE_TOPUP_MAX = 5000;
export const MATCH_SUBSIDY_MAX = 5000;
export const ANIM_FRAMES = 6;
/** Share of unspent loser pool that goes to Teiai bank income (catalogs/teiai.yaml). */
export const LOSS_SHARE_BPS = 300;

export const FIGHTER_NAMES = [
  '鉄拳のゴウ',
  '灼熱のレイジ',
  '黒影のクロウ',
  '修羅のバキ',
  '氷牙のユキ',
  '雷鳴のライ',
  '鬼哭のオニマル',
  '疾風のハヤテ',
  '剛腕のゴリウス',
  '影狼のシノビ',
  '爆砕のデストロ',
  '不死身のゾンバ',
  '蛇瞳のメデューサ',
  '怒髪のバーサーカー',
  '無敵のタイタン',
  '影帝のシャドウキング',
] as const;

export const FORMAT_SHAPE: Record<ArenaFormat, { groupSize: number; groups: number }> = {
  duel: { groupSize: 2, groups: 2 },
  royale: { groupSize: 4, groups: 4 },
};

export const TOURNAMENT_STATUSES = ['semi_betting', 'final_betting', 'done'] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];
export type FighterStage = 'semi' | 'final' | 'out';

export interface Fighter {
  id: number;
  name: string;
  basePower: number;
  groupNo: number;
  /** All bets on this fighter across the tournament (weapons). */
  betTotal: number;
}

export function fighterCount(format: ArenaFormat): number {
  const s = FORMAT_SHAPE[format];
  return s.groupSize * s.groups;
}

/** `random.sample` without replacement (CPython's pool algorithm for small populations). */
function sampleNames(rng: Rng, count: number): string[] {
  const pool: string[] = [...FIGHTER_NAMES];
  const out: string[] = [];
  const n = pool.length;
  for (let i = 0; i < Math.min(count, n); i++) {
    const j = rng.int(0, n - i);
    out.push(pool[j] as string);
    pool[j] = pool[n - i - 1] as string;
  }
  for (let i = n; i < count; i++) out.push(`無名の戦士${i + 1}`);
  return out;
}

export function generateFighters(format: ArenaFormat, rng: Rng): Omit<Fighter, 'id'>[] {
  const count = fighterCount(format);
  const size = FORMAT_SHAPE[format].groupSize;
  const names = sampleNames(rng, count);
  return names.map((name, i) => ({
    name,
    basePower: rng.int(BASE_POWER_MIN, BASE_POWER_MAX + 1),
    groupNo: Math.floor(i / size) + 1,
    betTotal: 0,
  }));
}

export function weaponBonus(betTotal: number): number {
  return Math.min(1, Math.max(0, betTotal) / WEAPON_SCALE);
}

export function effectivePower(basePower: number, betTotal: number): number {
  return basePower * (1 + weaponBonus(betTotal));
}

/** Win probability of each fighter within a match, proportional to effective power. */
export function winWeights(fighters: readonly Pick<Fighter, 'basePower' | 'betTotal'>[]): number[] {
  const powers = fighters.map((f) => effectivePower(f.basePower, f.betTotal));
  const total = powers.reduce((a, b) => a + b, 0);
  return powers.map((p) => p / total);
}

/** Odds in hundredths: semis `floor(0.85/p, 0.1)` capped at 20.00; the final is 1.3x that. */
export function arenaOdds(p: number, isFinal: boolean): number {
  const tenths = Math.max(10, Math.min(200, Math.floor(((1 - TAKEOUT) / p) * 10)));
  return Math.min(MAX_ODDS_HUNDREDTHS, isFinal ? tenths * 13 : tenths * 10);
}

export function matchOdds(
  fighters: readonly Pick<Fighter, 'basePower' | 'betTotal'>[],
  isFinal: boolean,
): number[] {
  return winWeights(fighters).map((p) => arenaOdds(p, isFinal));
}

/** Winner index. Weight is power times a gaussian luck factor, floored at 0.01. */
export function simulateMatch(
  fighters: readonly Pick<Fighter, 'basePower' | 'betTotal'>[],
  rng: Rng,
  gauss: Gauss = new Gauss(rng),
): number {
  const weights = fighters.map((f) =>
    Math.max(0.01, effectivePower(f.basePower, f.betTotal) * gauss.draw(1, LUCK)),
  );
  return weightedIndex(rng, weights);
}

export interface SpectatorBet {
  fighterIndex: number;
  amount: number;
}

/** NPC spectators seed each fighter's pool from the bank (up to 5,000 per tournament). */
export function seedSpectators(
  fighterCount_: number,
  bankCash: number,
  rng: Rng,
): { bets: SpectatorBet[]; spent: number } {
  let left = Math.min(HOUSE_TOPUP_MAX, Math.max(0, Math.floor(bankCash)));
  const bets: SpectatorBet[] = [];
  let spent = 0;
  for (let i = 0; i < fighterCount_; i++) {
    const n = rng.int(SPECTATOR_COUNT[0], SPECTATOR_COUNT[1] + 1);
    for (let k = 0; k < n; k++) {
      const amount = rng.int(SPECTATOR_BET[0], SPECTATOR_BET[1] + 1);
      if (amount > left) continue;
      left -= amount;
      spent += amount;
      bets.push({ fighterIndex: i, amount });
    }
  }
  return { bets, spent };
}

export interface MatchBet {
  id: number;
  /** Null for NPC spectators: they fund the loser pool but are never paid. */
  userId: string | null;
  fighterId: number;
  amount: number;
}

export interface MatchSettlement {
  payouts: { betId: number; userId: string; payout: number }[];
  subsidy: number;
  scale: number;
  losersPool: number;
  leftover: number;
  /** `floor(leftover * share)`: income for the Teiai bank. */
  bankIncome: number;
}

/**
 * Anti-inflation settlement of one match. Winning players always get their stake back; the
 * profit comes from the losing bets, topped up by the bank (max 5,000) and scaled down when
 * even that is not enough. `oddsHundredths` maps fighter id to the odds at settlement time.
 */
export function settleMatch(input: {
  bets: readonly MatchBet[];
  winnerIds: ReadonlySet<number>;
  oddsHundredths: ReadonlyMap<number, number>;
  bankCash: number;
}): MatchSettlement {
  const losersPool = input.bets
    .filter((b) => !input.winnerIds.has(b.fighterId))
    .reduce((sum, b) => sum + b.amount, 0);
  const winners = input.bets.filter(
    (b): b is MatchBet & { userId: string } =>
      b.userId !== null && input.winnerIds.has(b.fighterId),
  );
  const profits = winners.map((b) => {
    const rate = input.oddsHundredths.get(b.fighterId) ?? 100;
    return Math.max(0, roundHalfEven((b.amount * rate) / 100) - b.amount);
  });
  const due = profits.reduce((a, b) => a + b, 0);
  let subsidy = 0;
  if (due > losersPool) {
    subsidy = Math.min(
      due - losersPool,
      Math.min(MATCH_SUBSIDY_MAX, Math.max(0, Math.floor(input.bankCash))),
    );
  }
  const scale = due <= 0 ? 1 : Math.min(1, (losersPool + subsidy) / due);
  let paidProfit = 0;
  const payouts = winners.map((b, i) => {
    const paid = roundHalfEven((profits[i] as number) * scale);
    paidProfit += paid;
    return { betId: b.id, userId: b.userId, payout: b.amount + paid };
  });
  const leftover = Math.max(0, losersPool + subsidy - paidProfit);
  return {
    payouts,
    subsidy,
    scale,
    losersPool,
    leftover,
    bankIncome: Math.floor((leftover * LOSS_SHARE_BPS) / 10_000),
  };
}

/** Cosmetic battle frames (HP of every fighter, 7 frames from full health). */
export function battleFrames(count: number, winnerIndex: number, rng: Rng): number[][] {
  const hp = new Array<number>(count).fill(100);
  const frames: number[][] = [[...hp]];
  for (let step = 1; step <= ANIM_FRAMES; step++) {
    for (let i = 0; i < count; i++) {
      if (i === winnerIndex) hp[i] = Math.max(20, (hp[i] as number) - uniform(rng, 0, 10));
      else hp[i] = Math.max(0, (hp[i] as number) - uniform(rng, 12, 25));
      if (step === ANIM_FRAMES && i !== winnerIndex) hp[i] = 0;
    }
    frames.push(hp.map((x) => Math.round(x * 10) / 10));
  }
  return frames;
}
