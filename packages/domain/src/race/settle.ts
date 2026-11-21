import { roundHalfEven } from '../progression/time.ts';
import {
  isHit,
  MAX_RACE_STAKE,
  MAX_STAKE,
  MIN_STAKE,
  PICKS_NEEDED,
  ticketPayout,
  type BetKind,
  type OddsTenths,
} from './odds.ts';
import { MAX_RACES, retireValue } from './horse.ts';

export const PRIZES = [12_000, 5000, 2000] as const;
export const MAJOR_PRIZES = [24_000, 10_000, 4000] as const;
export const MAJOR_HOUSE_TOPUP = 10_000;
/** Pelica of real-entry pool per player horse before prizes are scaled down. */
export const PRIZE_POOL_PER_ENTRY = 1000;
/** Share of lost stakes that goes to Teiai bank income (catalogs/teiai.yaml `loss_share`). */
export const LOSS_SHARE_BPS = 300;

export interface SettleRunner {
  lane: number;
  horseId: number | null;
  ownerId: string | null;
  name: string;
  races: number;
  wins: number;
  places: number;
}

export interface SettleBet {
  id: number;
  userId: string;
  kind: BetKind;
  lanes: number[];
  stake: number;
  odds: OddsTenths;
}

export interface PrizeAward {
  place: 1 | 2 | 3;
  lane: number;
  horseId: number;
  ownerId: string;
  /** After scaling and the `relic_tear` buff. */
  amount: number;
}

export interface HorseUpdate {
  horseId: number;
  ownerId: string;
  races: number;
  wins: number;
  places: number;
  /** True when this was the horse's last (32nd) race. */
  retire: boolean;
  /** Value of the retirement: positive pays the owner, negative is a fee. */
  retireValue: number;
}

export interface RaceSettlement {
  /** Lanes from first to last. */
  placings: number[];
  prizes: PrizeAward[];
  /** Bank cash drawn to top up a major race's prizes. */
  bankTopup: number;
  payouts: { betId: number; userId: string; payout: number; hit: boolean }[];
  horseUpdates: HorseUpdate[];
  /** `int(lost * share)`: income for the Teiai bank. */
  bankIncome: number;
  totalLost: number;
}

/** Share of the table prizes the pool can cover. */
export function prizeScale(realEntries: number, placedTotal: number, topup: number): number {
  if (placedTotal <= 0) return 1;
  return Math.min(1, (realEntries * PRIZE_POOL_PER_ENTRY + topup) / placedTotal);
}

/**
 * Settle a finished race: owner prizes (scaled so the bank is not drained, major races topped
 * up from the bank), bet payouts at the fixed odds, horse records and 32-race retirement.
 * `order` lists runner indexes first to last.
 */
export function settleRace(input: {
  runners: readonly SettleRunner[];
  order: readonly number[];
  major: boolean;
  bets: readonly SettleBet[];
  bankCash: number;
  /** `relic_tear` buff per owner. */
  prizeBuff: ReadonlyMap<string, number>;
}): RaceSettlement {
  const placings = input.order.map((i) => (input.runners[i] as SettleRunner).lane);
  const table = input.major ? MAJOR_PRIZES : PRIZES;

  const realEntries = input.runners.filter((r) => r.ownerId !== null).length;
  const placedHorses = input.order
    .slice(0, 3)
    .map((idx, k) => ({ runner: input.runners[idx] as SettleRunner, place: (k + 1) as 1 | 2 | 3 }))
    .filter((x) => x.runner.ownerId !== null && x.runner.horseId !== null);
  const placedTotal = placedHorses.reduce((sum, x) => sum + (table[x.place - 1] as number), 0);
  let bankTopup = 0;
  if (input.major && placedTotal > realEntries * PRIZE_POOL_PER_ENTRY) {
    const shortfall = placedTotal - realEntries * PRIZE_POOL_PER_ENTRY;
    bankTopup = Math.max(0, Math.min(shortfall, Math.floor(input.bankCash), MAJOR_HOUSE_TOPUP));
  }
  const scale = prizeScale(realEntries, placedTotal, bankTopup);
  const prizes: PrizeAward[] = placedHorses.map(({ runner, place }) => {
    const base = roundHalfEven((table[place - 1] as number) * scale);
    const buff = input.prizeBuff.get(runner.ownerId as string) ?? 0;
    return {
      place,
      lane: runner.lane,
      horseId: runner.horseId as number,
      ownerId: runner.ownerId as string,
      amount: roundHalfEven(base * (1 + buff)),
    };
  });

  let totalLost = 0;
  const payouts = input.bets.map((bet) => {
    const hit = isHit(bet.kind, bet.lanes, placings);
    if (!hit) totalLost += bet.stake;
    return {
      betId: bet.id,
      userId: bet.userId,
      hit,
      payout: hit ? ticketPayout(bet.stake, bet.odds) : 0,
    };
  });

  const horseUpdates: HorseUpdate[] = [];
  input.order.forEach((idx, k) => {
    const r = input.runners[idx] as SettleRunner;
    if (r.ownerId === null || r.horseId === null) return;
    const races = r.races + 1;
    const wins = r.wins + (k === 0 ? 1 : 0);
    const places = r.places + (k < 3 ? 1 : 0);
    const retire = races >= MAX_RACES;
    horseUpdates.push({
      horseId: r.horseId,
      ownerId: r.ownerId,
      races,
      wins,
      places,
      retire,
      retireValue: retire ? retireValue(races, wins, places) : 0,
    });
  });

  return {
    placings,
    prizes,
    bankTopup,
    payouts,
    horseUpdates,
    bankIncome: Math.floor((totalLost * LOSS_SHARE_BPS) / 10_000),
    totalLost,
  };
}

export type BetError =
  | 'select_distinct_horses'
  | 'stake_range'
  | 'max_stake'
  | 'lane_not_running'
  | 'bet_closed'
  | 'bet_unavailable'
  | 'odds_pending';

/** Check one ticket before it is bought. `spent` is what the user already staked in this race. */
export function validateBet(input: {
  kind: BetKind;
  lanes: readonly number[];
  stake: number;
  spent: number;
  runningLanes: ReadonlySet<number>;
  status: 'entry' | 'betting' | 'done';
  nowMs: number;
  betClose: number;
  hasOdds: boolean;
}): BetError | null {
  if (input.status !== 'betting') return 'bet_unavailable';
  if (input.nowMs >= input.betClose) return 'bet_closed';
  if (!input.hasOdds) return 'odds_pending';
  const need = PICKS_NEEDED[input.kind];
  if (input.lanes.length !== need || new Set(input.lanes).size !== need)
    return 'select_distinct_horses';
  if (!input.lanes.every((l) => input.runningLanes.has(l))) return 'lane_not_running';
  if (!Number.isSafeInteger(input.stake) || input.stake < MIN_STAKE || input.stake > MAX_STAKE) {
    return 'stake_range';
  }
  if (input.spent + input.stake > MAX_RACE_STAKE) return 'max_stake';
  return null;
}
