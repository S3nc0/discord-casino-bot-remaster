import type { Rng } from '@casino/shared';

export const BUFF_RATE = 0.01;
export const MERGE_COUNT = 10;
export const STAR_MAX = 3;

export const RELIC_BASES = [
  'relic_fossil',
  'relic_bone',
  'relic_meteor',
  'relic_vase',
  'relic_crown',
  'relic_tear',
] as const;
export type RelicBase = (typeof RELIC_BASES)[number];

export const BUFF_KEYS = ['click', 'wage', 'luck', 'recovery', 'daily', 'prize'] as const;
export type BuffKey = (typeof BUFF_KEYS)[number];

export const RELIC_BUFF: Record<RelicBase, BuffKey> = {
  relic_fossil: 'click',
  relic_bone: 'wage',
  relic_meteor: 'luck',
  relic_vase: 'recovery',
  relic_crown: 'daily',
  relic_tear: 'prize',
};

/** Reference value of an unstarred relic (net worth, display). */
export const RELIC_VALUE: Record<RelicBase, number> = {
  relic_fossil: 1500,
  relic_bone: 4000,
  relic_meteor: 10_000,
  relic_vase: 25_000,
  relic_crown: 60_000,
  relic_tear: 100_000,
};

export function isRelicId(id: string): boolean {
  return id.startsWith('relic_');
}

/** `relic_fossil_s2` → `['relic_fossil', 2]`; unstarred ids have star 0. */
export function splitRelicId(id: string): [string, number] {
  const m = /^(.*)_s(\d+)$/.exec(id);
  return m ? [m[1] as string, Number(m[2])] : [id, 0];
}

export function starId(base: string, star: number): string {
  return star <= 0 ? base : `${base}_s${star}`;
}

export function starMarks(star: number): string {
  return '★'.repeat(Math.max(0, star));
}

function isRelicBase(base: string): base is RelicBase {
  return (RELIC_BASES as readonly string[]).includes(base);
}

/** Value of one relic of any star: `MERGE_COUNT ** star` times the base value. */
export function relicValue(id: string): number {
  const [base, star] = splitRelicId(id);
  return isRelicBase(base) ? RELIC_VALUE[base] * MERGE_COUNT ** star : 0;
}

/** Stacked buffs of everything held (listed relics are not in the inventory, so not counted). */
export function relicBuffs(inventory: ReadonlyMap<string, number>): Record<BuffKey, number> {
  const out: Record<BuffKey, number> = {
    click: 0,
    wage: 0,
    luck: 0,
    recovery: 0,
    daily: 0,
    prize: 0,
  };
  for (const [id, qty] of inventory) {
    if (qty <= 0) continue;
    const [base, star] = splitRelicId(id);
    if (!isRelicBase(base)) continue;
    out[RELIC_BUFF[base]] += qty * BUFF_RATE * MERGE_COUNT ** star;
  }
  for (const key of BUFF_KEYS) out[key] = Math.round(out[key] * 1e6) / 1e6;
  return out;
}

/** Stochastic rounding: `4.35` pays 5 in 35 % of the cases and 4 otherwise. */
export function chanceRound(x: number, rng: Rng): number {
  const whole = Math.floor(x);
  return whole + (rng.float() < x - whole ? 1 : 0);
}

export type MergeError = 'relic_not_relic' | 'relic_max_star' | 'relic_need_more';

/** Ten identical relics become one of the next star. */
export function planMerge(
  id: string,
  qty: number,
): { ok: true; from: string; to: string; consume: number } | { ok: false; error: MergeError } {
  const [base, star] = splitRelicId(id);
  if (!isRelicBase(base)) return { ok: false, error: 'relic_not_relic' };
  if (star >= STAR_MAX) return { ok: false, error: 'relic_max_star' };
  if (qty < MERGE_COUNT) return { ok: false, error: 'relic_need_more' };
  return { ok: true, from: id, to: starId(base, star + 1), consume: MERGE_COUNT };
}
