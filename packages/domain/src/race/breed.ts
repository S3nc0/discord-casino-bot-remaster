import type { DomainEvent, Rng } from '@casino/shared';
import type { DomainContext, Outcome } from '../index.ts';
import {
  COATS,
  MAX_HORSES,
  MAX_RACES,
  SILKS,
  STAT_KEYS,
  STAT_MAX,
  STAT_MIN,
  STAT_TOTAL,
  statSum,
  validateHorseName,
  type NameError,
  type Stats,
} from './horse.ts';

// Constants of docs/spec/horse-breeding.md (§2, §3, §4).
export const BREED_FEE = 15_000;
export const BREED_MIN_RACES = 4;
export const MAX_FOALS_PER_HORSE = 2;
export const HOUR_MS = 3_600_000;
export const BREED_COOLDOWN_MS = 72 * HOUR_MS;
export const FOAL_MATURITY_MS = 48 * HOUR_MS;
export const FOAL_TOTAL_MIN = 190;
export const FOAL_TOTAL_MAX = 210;
/** Foal base value, used instead of the voucher price wherever a horse is valued. */
export const FOAL_BASE_VALUE = BREED_FEE;
const STEP = 5;

/** The parts of a horse row that breeding reads. */
export interface BreedParent {
  id: number;
  ownerId: string | null;
  name: string;
  stats: Stats;
  coat: string;
  races: number;
  generation: number;
  /** Epoch ms a bred horse can race from; null for voucher and legacy horses. */
  maturesAt: number | null;
  lastBredAt: number | null;
  foalCount: number;
}

export interface BreederState {
  userId: string;
  balance: number;
  debt: number;
  /** Horses the breeder owns now (market listings included). */
  horseCount: number;
}

export type BreedError =
  | 'same_horse'
  | 'not_owner'
  | 'in_debt'
  | 'stable_full'
  | 'insufficient_funds'
  | 'min_races'
  | 'retired_by_age'
  | 'immature'
  | 'foal_limit'
  | 'cooldown'
  | 'invalid_look'
  | NameError;

export interface BreedRejection {
  ok: false;
  error: BreedError;
  /** Name of the horse the rule failed on, when it is about one horse. */
  horse?: string;
  /** For `cooldown` and `immature`: the epoch ms it clears. */
  at?: number;
}

export interface FoalDraft {
  name: string;
  coat: string;
  silks: string;
  stats: Stats;
  generation: number;
  parentAId: number;
  parentBId: number;
  foaledAt: number;
  maturesAt: number;
  baseValue: number;
  fee: number;
}

export interface BreedInput {
  a: BreedParent;
  b: BreedParent;
  name: string;
  silks: string;
}

/** Is this horse allowed to breed right now? First failing rule wins, in spec order. */
export function parentError(p: BreedParent, userId: string, now: number): BreedRejection | null {
  const fail = (error: BreedError, at?: number): BreedRejection => ({
    ok: false,
    error,
    horse: p.name,
    ...(at === undefined ? {} : { at }),
  });
  if (p.ownerId !== userId) return fail('not_owner');
  if (p.races >= MAX_RACES) return fail('retired_by_age');
  if (p.races < BREED_MIN_RACES) return fail('min_races');
  if (p.maturesAt !== null && now < p.maturesAt) return fail('immature', p.maturesAt);
  if (p.foalCount >= MAX_FOALS_PER_HORSE) return fail('foal_limit');
  if (p.lastBredAt !== null && now < p.lastBredAt + BREED_COOLDOWN_MS)
    return fail('cooldown', p.lastBredAt + BREED_COOLDOWN_MS);
  return null;
}

/** Everything that can be checked before any money moves. */
export function checkBreeding(
  input: BreedInput,
  breeder: BreederState,
  now: number,
): { ok: true; name: string } | BreedRejection {
  const { a, b } = input;
  if (a.id === b.id) return { ok: false, error: 'same_horse' };
  const bad = parentError(a, breeder.userId, now) ?? parentError(b, breeder.userId, now);
  if (bad) return bad;
  if (breeder.debt > 0) return { ok: false, error: 'in_debt' };
  if (breeder.horseCount >= MAX_HORSES) return { ok: false, error: 'stable_full' };
  const name = validateHorseName(input.name);
  if (!name.ok) return { ok: false, error: name.error };
  if (!(SILKS as readonly string[]).includes(input.silks))
    return { ok: false, error: 'invalid_look' };
  if (breeder.balance < BREED_FEE) return { ok: false, error: 'insufficient_funds' };
  return { ok: true, name: name.name };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Weighted pick of the total noise, weights 1:2:4:2:1 over -10..+10. */
function totalNoise(rng: Rng): number {
  const r = rng.int(0, 10);
  if (r < 1) return -10;
  if (r < 3) return -5;
  if (r < 7) return 0;
  if (r < 9) return 5;
  return 10;
}

const toward0 = (x: number): number => (x < 0 ? -Math.floor(-x) : Math.floor(x));

/**
 * Foal stats (§3.1). Total: half the parents' excess over 200 (truncated toward 0 to a multiple
 * of 5) plus noise, clamped to 190..210. Shape: halfway regression to 50 plus ±7. Every stat is
 * a multiple of 5 in 20..80 and the total never passes `TOTAL_CAP`.
 */
export function foalStats(a: Stats, b: Stats, rng: Rng): Stats {
  const excess = (statSum(a) + statSum(b)) / 2 - STAT_TOTAL;
  const inherit = toward0(excess / 2 / STEP) * STEP;
  const total = clamp(STAT_TOTAL + inherit + totalNoise(rng), FOAL_TOTAL_MIN, FOAL_TOTAL_MAX);

  const target = {} as Stats;
  for (const k of STAT_KEYS) {
    target[k] = 50 + ((a[k] + b[k]) / 2 - 50) / 2 + rng.int(-7, 8);
  }

  const base = STAT_MIN * STAT_KEYS.length;
  const steps = (total - base) / STEP;
  const weight = (k: (typeof STAT_KEYS)[number]): number => Math.max(1, target[k] - STAT_MIN);
  const sumW = STAT_KEYS.reduce((s, k) => s + weight(k), 0);
  const alloc = {} as Record<(typeof STAT_KEYS)[number], number>;
  const rem: { k: (typeof STAT_KEYS)[number]; r: number }[] = [];
  let given = 0;
  for (const k of STAT_KEYS) {
    const exact = (steps * weight(k)) / sumW;
    alloc[k] = Math.floor(exact);
    given += alloc[k];
    rem.push({ k, r: exact - alloc[k] });
  }
  // Largest remainder first; ties keep speed, stamina, power, guts order (stable sort).
  rem.sort((x, y) => y.r - x.r);
  for (let i = 0; given < steps; i++, given++)
    alloc[(rem[i] as { k: (typeof STAT_KEYS)[number] }).k]++;

  // A stat above 80 hands its extra steps to the lowest stat.
  const maxSteps = (STAT_MAX - STAT_MIN) / STEP;
  let spill = 0;
  for (const k of STAT_KEYS) {
    if (alloc[k] > maxSteps) {
      spill += alloc[k] - maxSteps;
      alloc[k] = maxSteps;
    }
  }
  while (spill > 0) {
    let low: (typeof STAT_KEYS)[number] = STAT_KEYS[0];
    for (const k of STAT_KEYS) if (alloc[k] < alloc[low]) low = k;
    alloc[low]++;
    spill--;
  }
  return {
    speed: STAT_MIN + alloc.speed * STEP,
    stamina: STAT_MIN + alloc.stamina * STEP,
    power: STAT_MIN + alloc.power * STEP,
    guts: STAT_MIN + alloc.guts * STEP,
  };
}

/** Coat: 45% parent A's, 45% parent B's, 10% uniform from `COATS`. */
export function foalCoat(a: string, b: string, rng: Rng): string {
  const r = rng.int(0, 100);
  if (r < 45) return a;
  if (r < 90) return b;
  return COATS[rng.int(0, COATS.length)] as string;
}

/**
 * Breed two horses. Pure: checks, rolls the foal once and returns the draft plus a `HorseFoaled`
 * event draft (`foalId` is 0 until the server inserts the row; `withFoalId` fills it in).
 */
export function breedFoal(
  input: BreedInput,
  breeder: BreederState,
  ctx: DomainContext,
): BreedRejection | { ok: true; outcome: Outcome<FoalDraft> } {
  const now = ctx.clock.now();
  const checked = checkBreeding(input, breeder, now);
  if (!checked.ok) return checked;
  const { a, b } = input;
  const stats = foalStats(a.stats, b.stats, ctx.rng);
  const draft: FoalDraft = {
    name: checked.name,
    coat: foalCoat(a.coat, b.coat, ctx.rng),
    silks: input.silks,
    stats,
    generation: Math.max(a.generation, b.generation) + 1,
    parentAId: a.id,
    parentBId: b.id,
    foaledAt: now,
    maturesAt: now + FOAL_MATURITY_MS,
    baseValue: FOAL_BASE_VALUE,
    fee: BREED_FEE,
  };
  return { ok: true, outcome: { state: draft, events: [] } };
}

/** Build the `HorseFoaled` event once the foal row exists. */
export function foaledEvent(
  guildId: string,
  userId: string,
  foalId: number,
  draft: FoalDraft,
): Extract<DomainEvent, { type: 'HorseFoaled' }> {
  return {
    type: 'HorseFoaled',
    guildId,
    at: draft.foaledAt,
    userId,
    foalId,
    foalName: draft.name,
    parentIds: [draft.parentAId, draft.parentBId],
    statTotal: statSum(draft.stats),
    generation: draft.generation,
    maturesAt: draft.maturesAt,
  };
}

/** Value of a horse for net worth: `max(0, base_value + retire value)`. */
export function valueOf(baseValue: number, retire: number): number {
  return Math.max(0, baseValue + retire);
}
