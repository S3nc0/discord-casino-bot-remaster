import type { Rng } from '@casino/shared';
import { Gauss, PyRandom } from '../progression/py-random.ts';
import { FORM_ODDS, simulate, type Runner, type Track } from './sim.ts';
import { statSum } from './horse.ts';

export const TAKEOUT = 0.15;
export const COMBO_TAKEOUT = 0.2;
export const MAX_ODDS = 99.9;
export const MAX_COMBO_ODDS = 100.0;
export const ODDS_SIMS = 600;
export const ODDS_SIM_WEIGHT = 0.7;
export const RECORD_PRIOR_RUNS = 4;
export const FIRST_RUN_FACTOR = 0.75;
export const PLACE_CAP = 0.95;
export const ABILITY_PRIOR_WEIGHT = 0.3;

export const BET_KINDS = [
  'win',
  'place',
  'quinella',
  'wide',
  'exacta',
  'trio',
  'trifecta',
] as const;
export type BetKind = (typeof BET_KINDS)[number];
export const MULTI_KINDS: readonly BetKind[] = ['win', 'place'];
export const PICKS_NEEDED: Record<BetKind, number> = {
  win: 1,
  place: 1,
  quinella: 2,
  wide: 2,
  exacta: 2,
  trio: 3,
  trifecta: 3,
};
/** Kinds ordered by finish position. */
const ORDERED: ReadonlySet<BetKind> = new Set(['exacta', 'trifecta']);

export const MIN_STAKE = 100;
export const MAX_STAKE = 50_000;
export const MAX_RACE_STAKE = 150_000;

/** Odds are stored in tenths (4.3x = 43) so no float reaches the database. */
export type OddsTenths = number;

/** Ticket key: `3`, `2-4`, `4>2`, `1-3-5`, `4>2>1`. Lanes are 1-based. */
export function betKey(kind: BetKind, lanes: readonly number[]): string {
  if (lanes.length !== PICKS_NEEDED[kind])
    throw new RangeError(`${kind} needs ${PICKS_NEEDED[kind]} lanes`);
  if (new Set(lanes).size !== lanes.length) throw new RangeError('lanes must differ');
  if (ORDERED.has(kind)) return lanes.join('>');
  return [...lanes].sort((a, b) => a - b).join(lanes.length === 1 ? '' : '-');
}

/** Does the ticket hit? `order` lists lanes from first to last. */
export function isHit(kind: BetKind, lanes: readonly number[], order: readonly number[]): boolean {
  const top = (n: number): number[] => order.slice(0, n);
  const sameSet = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((x) => b.includes(x));
  switch (kind) {
    case 'win':
      return lanes[0] === order[0];
    case 'place':
      return top(3).includes(lanes[0] as number);
    case 'quinella':
      return sameSet(lanes, top(2));
    case 'wide':
      return lanes.every((l) => top(3).includes(l));
    case 'exacta':
      return lanes[0] === order[0] && lanes[1] === order[1];
    case 'trio':
      return sameSet(lanes, top(3));
    case 'trifecta':
      return lanes[0] === order[0] && lanes[1] === order[1] && lanes[2] === order[2];
  }
}

/** Payout of a hit: `floor(stake * odds)`, in integer arithmetic. */
export function ticketPayout(stake: number, oddsTenths: OddsTenths): number {
  return Math.floor((stake * oddsTenths) / 10);
}

function toOdds(prob: number, takeout: number, cap: number): OddsTenths {
  if (!(prob > 0)) return Math.round(cap * 10);
  const tenths = Math.floor(((1 - takeout) / prob) * 10);
  return Math.max(10, Math.min(Math.round(cap * 10), tenths));
}

/** Win probabilities from records, ability and form. Sums to 1. */
export function recordWinProbs(runners: readonly Runner[]): number[] {
  const n = runners.length;
  const sums = runners.map((r) => statSum(r));
  const total = sums.reduce((a, b) => a + b, 0);
  const raw = runners.map((r, i) => {
    const share = (sums[i] as number) / total;
    const prior = ABILITY_PRIOR_WEIGHT * share + (1 - ABILITY_PRIOR_WEIGHT) * (1 / n);
    let p = (r.wins + RECORD_PRIOR_RUNS * prior) / (r.races + RECORD_PRIOR_RUNS);
    if (r.races === 0) p *= FIRST_RUN_FACTOR;
    return p * FORM_ODDS[r.form];
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
}

/** Top-3 probabilities from records (sum to `min(3, n)`), capped at 0.95. */
export function recordPlaceProbs(runners: readonly Runner[]): number[] {
  const n = runners.length;
  const k = Math.min(3, n);
  const flat = k / n;
  const sums = runners.map((r) => statSum(r));
  const total = sums.reduce((a, b) => a + b, 0);
  const raw = runners.map((r, i) => {
    const share = (sums[i] as number) / total;
    const prior = ABILITY_PRIOR_WEIGHT * (share * k) + (1 - ABILITY_PRIOR_WEIGHT) * flat;
    let p = (r.places + RECORD_PRIOR_RUNS * prior) / (r.races + RECORD_PRIOR_RUNS);
    if (r.races === 0) p *= FIRST_RUN_FACTOR;
    return p * FORM_ODDS[r.form];
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => Math.min(PLACE_CAP, (x / sum) * k));
}

/** Win and top-3 frequencies over `sims` trial races with one fixed-seed generator. */
export function estimate(
  runners: readonly Runner[],
  track: Track,
  sims: number = ODDS_SIMS,
  rng: Rng = new PyRandom(0),
): { win: number[]; place: number[] } {
  const n = runners.length;
  const win = new Array<number>(n).fill(0);
  const place = new Array<number>(n).fill(0);
  // One generator for all trials, including its cached second gaussian (like one Random).
  const gauss = new Gauss(rng);
  for (let s = 0; s < sims; s++) {
    const { order } = simulate(runners, track, rng, false, gauss);
    win[order[0] as number] = (win[order[0] as number] as number) + 1;
    for (const i of order.slice(0, Math.min(3, n))) place[i] = (place[i] as number) + 1;
  }
  return { win: win.map((x) => x / sims), place: place.map((x) => x / sims) };
}

export interface BlendedProbs {
  win: number[];
  place: number[];
}

/** `0.7 * simulated + 0.3 * record` (record only when `sims` is 0). */
export function blendedProbs(
  runners: readonly Runner[],
  track: Track,
  options: { sims?: number; simWeight?: number } = {},
): BlendedProbs {
  const sims = options.sims ?? ODDS_SIMS;
  const weight = sims > 0 ? (options.simWeight ?? ODDS_SIM_WEIGHT) : 0;
  const recWin = recordWinProbs(runners);
  const recPlace = recordPlaceProbs(runners);
  if (weight === 0) return { win: recWin, place: recPlace };
  const sim = estimate(runners, track, sims);
  return {
    win: recWin.map((p, i) => weight * (sim.win[i] as number) + (1 - weight) * p),
    place: recPlace.map((p, i) =>
      Math.min(PLACE_CAP, weight * (sim.place[i] as number) + (1 - weight) * p),
    ),
  };
}

/** `[win, place]` odds per runner (the legacy `make_odds`). */
export function makeOdds(
  runners: readonly Runner[],
  track: Track,
  options: { sims?: number; simWeight?: number } = {},
): [OddsTenths, OddsTenths][] {
  const probs = blendedProbs(runners, track, options);
  return runners.map((_, i) => [
    toOdds(probs.win[i] as number, TAKEOUT, MAX_ODDS),
    toOdds(probs.place[i] as number, TAKEOUT, MAX_ODDS),
  ]);
}

/** Harville: probability that `a`, `b`, `c` finish 1st, 2nd, 3rd (`c` omitted for the top two). */
function harville(w: readonly number[], a: number, b: number, c?: number): number {
  const wa = w[a] as number;
  const wb = w[b] as number;
  let p = wa * (wb / (1 - wa));
  if (c !== undefined) p *= (w[c] as number) / (1 - wa - wb);
  return p;
}

/** Every ticket of the race with its fixed odds, keyed `kind` → ticket key → tenths. */
export function makeAllOdds(
  runners: readonly Runner[],
  track: Track,
  options: { sims?: number; simWeight?: number } = {},
): Record<BetKind, Record<string, OddsTenths>> {
  const probs = blendedProbs(runners, track, options);
  const n = runners.length;
  const lanes = runners.map((r) => r.lane);
  const out = {} as Record<BetKind, Record<string, OddsTenths>>;
  for (const k of BET_KINDS) out[k] = {};
  const w = probs.win;
  for (let i = 0; i < n; i++) {
    const lane = String(lanes[i]);
    (out.win as Record<string, number>)[lane] = toOdds(w[i] as number, TAKEOUT, MAX_ODDS);
    (out.place as Record<string, number>)[lane] = toOdds(
      probs.place[i] as number,
      TAKEOUT,
      MAX_ODDS,
    );
  }
  const combo = (kind: BetKind, ls: number[], prob: number): void => {
    (out[kind] as Record<string, number>)[betKey(kind, ls)] = toOdds(
      prob,
      COMBO_TAKEOUT,
      MAX_COMBO_ODDS,
    );
  };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const la = lanes[a] as number;
      const lb = lanes[b] as number;
      combo('exacta', [la, lb], harville(w, a, b));
      if (a < b) combo('quinella', [la, lb], harville(w, a, b) + harville(w, b, a));
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        const lc = lanes[c] as number;
        combo('trifecta', [la, lb, lc], harville(w, a, b, c));
        if (a < b && b < c) {
          const perms = [
            harville(w, a, b, c),
            harville(w, a, c, b),
            harville(w, b, a, c),
            harville(w, b, c, a),
            harville(w, c, a, b),
            harville(w, c, b, a),
          ];
          combo(
            'trio',
            [la, lb, lc],
            perms.reduce((x, y) => x + y, 0),
          );
        }
      }
    }
  }
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      let p = 0;
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        p +=
          harville(w, a, b, c) +
          harville(w, a, c, b) +
          harville(w, b, a, c) +
          harville(w, b, c, a) +
          harville(w, c, a, b) +
          harville(w, c, b, a);
      }
      combo('wide', [lanes[a] as number, lanes[b] as number], p);
    }
  }
  return out;
}
