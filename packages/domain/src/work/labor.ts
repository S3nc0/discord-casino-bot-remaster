import type { Rng } from '@casino/shared';
import { PyRandom } from '../progression/py-random.ts';
import { clamp, MS_DAY, MS_HOUR, roundHalfEven } from '../progression/time.ts';
import { chanceRound, type RelicBase } from './relics.ts';

export const MAX_LEVEL = 10;
export const BASE_PAY = 10;
export const PAY_PER_LEVEL = 4;
export const UPGRADE_COST = [
  150, 400, 900, 1800, 3500, 7000, 14_000, 28_000, 56_000, 112_000,
] as const;
export const DORM_COST = [2000, 6000, 15_000, 40_000, 100_000] as const;
export const DORM_MAX = 5;
export const SLOTS_BASE = 5;
export const MAX_CLICKS_PER_DAY = 500;
export const OVER_CAP_PAY = 1;
export const CLICK_INTERVAL_MS = 1000;
export const FATIGUE_MAX = 100;
export const RECOVER_PER_SEC = 0.1;
export const DRINK_RECOVER = 60;
export const MIN_PAY_RATE = 0.2;
export const CRIT_BASE = 0.05;
export const CRIT_PER_LEVEL = 0.01;
export const CRIT_WORKER_BONUS = 0.002;
export const CRIT_MAX = 0.3;
export const CRIT_MULT = 5;
export const CRIT_ORE_CHANCE = 0.15;
export const COMBO_SIZE = 10;
export const COMBO_BONUS = 0.2;
export const TERRAIN_HIT_BONUS = 0.05;
export const TERRAIN_FATIGUE_CUT = 0.2;
export const TERRAIN_SILVER_MULT = 2;
export const CONTRACT_DAYS = 1;
export const STOCK_HOURS = 24;
export const FOREMAN_LUCK = 0.25;
export const FINDS_KEEP = 40;
export const CLICK_LOG_DAYS = 14;
export const CLICK_GAP_MAX = 600;
export const MECH_MIN_CLICKS = 100;
export const MECH_CV_MAX = 0.1;
export const SUSPECT_HOURS = 3;

export const TOOLS = ['pick', 'glove'] as const;
export type Tool = (typeof TOOLS)[number];

export function clampLevel(level: number): number {
  return clamp(Math.trunc(level), 0, MAX_LEVEL);
}

export function payPerClick(pick: number): number {
  return BASE_PAY + PAY_PER_LEVEL * clampLevel(pick);
}

export function fatigueGain(glove: number): number {
  const g = clampLevel(glove);
  const early = Math.min(g, 5);
  return Math.round((3.0 - 0.4 * early - 0.1 * (g - early)) * 1e9) / 1e9;
}

export function payRate(fatigue: number): number {
  return 1 - 0.8 * (fatigue / FATIGUE_MAX);
}

export function clickPay(pick: number, fatigue: number): number {
  return Math.max(1, roundHalfEven(payPerClick(pick) * payRate(fatigue)));
}

/** Fatigue after `dtSec` of rest; the vase buff speeds recovery. */
export function fatigueNow(fatigue: number, dtSec: number, recoveryBuff = 0): number {
  return clamp(fatigue - Math.max(0, dtSec) * RECOVER_PER_SEC * (1 + recoveryBuff), 0, FATIGUE_MAX);
}

/** Cost of the next level of a tool, or null at the maximum. */
export function upgradeCost(level: number): number | null {
  return UPGRADE_COST[level] ?? null;
}

export function dormCost(level: number): number | null {
  return DORM_COST[level] ?? null;
}

export function slotsOf(dorm: number): number {
  return SLOTS_BASE + clamp(Math.trunc(dorm), 0, DORM_MAX);
}

/** Pelica spent on a tool up to `level` (net worth "tools"). */
export function upgradeSpent(level: number): number {
  return UPGRADE_COST.slice(0, clampLevel(level)).reduce((a, b) => a + b, 0);
}

export function dormSpent(level: number): number {
  return DORM_COST.slice(0, clamp(Math.trunc(level), 0, DORM_MAX)).reduce((a, b) => a + b, 0);
}

export const TERRAINS = ['hit', 'fatigue', 'silver', 'none'] as const;
export type Terrain = (typeof TERRAINS)[number];

/** Today's terrain: the same for every guild, seeded by the date string. */
export function terrainToday(dayIso: string): Terrain {
  return new PyRandom(`terrain:${dayIso}`).choice(TERRAINS);
}

export interface Ore {
  id: string;
  value: number;
  big: boolean;
  /** Probability of a worker find (`coal` is flat). */
  prob: number;
}

export const ORES: readonly Ore[] = [
  { id: 'copper', value: 60, big: false, prob: 0.06 },
  { id: 'silver', value: 240, big: false, prob: 0.015 },
  { id: 'gold', value: 1200, big: false, prob: 0.003 },
  { id: 'diamond', value: 9000, big: true, prob: 0.0004 },
  { id: 'legend', value: 90_000, big: true, prob: 0.00004 },
];
export const COAL: Ore = { id: 'coal', value: 3, big: false, prob: 0.4 };
const ORE_VALUE: Record<string, number> = Object.fromEntries(
  [...ORES, COAL].map((o) => [o.id, o.value]),
);

export const CRIT_ORES = [
  { id: 'coal', weight: 45, value: 3 },
  { id: 'copper', weight: 40, value: 60 },
  { id: 'silver', weight: 12, value: 240 },
  { id: 'gold', weight: 3, value: 1200 },
] as const;

export interface RelicDrop {
  item: RelicBase;
  prob: number;
  big: boolean;
}
export const RELIC_DROPS: readonly RelicDrop[] = [
  { item: 'relic_fossil', prob: 0.0033, big: false },
  { item: 'relic_bone', prob: 0.0017, big: false },
  { item: 'relic_meteor', prob: 0.00067, big: false },
  { item: 'relic_vase', prob: 0.00027, big: false },
  { item: 'relic_crown', prob: 0.000067, big: true },
  { item: 'relic_tear', prob: 0.000017, big: true },
];

export const WORKER_KINDS = ['apprentice', 'miner', 'craftsman', 'foreman'] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export interface WorkerSpec {
  /** Pelica per hour. */
  rate: number;
  fee: number;
  oreMultiplier: number;
  relicMultiplier: number;
}

export const WORKERS: Record<WorkerKind, WorkerSpec> = {
  apprentice: { rate: 1.8, fee: 150, oreMultiplier: 0.12, relicMultiplier: 0.5 },
  miner: { rate: 10.05, fee: 520, oreMultiplier: 0.415, relicMultiplier: 0.8 },
  craftsman: { rate: 23.55, fee: 1160, oreMultiplier: 0.95, relicMultiplier: 1.0 },
  foreman: { rate: 0, fee: 640, oreMultiplier: 0, relicMultiplier: 0 },
};

export function oreValue(id: string): number {
  return ORE_VALUE[id] ?? 0;
}

export function oreGain(ores: Readonly<Record<string, number>>): number {
  return Object.entries(ores).reduce((sum, [id, n]) => sum + oreValue(id) * n, 0);
}

export function idleHours(idleAtMs: number, nowMs: number): number {
  if (idleAtMs <= 0) return 0;
  return Math.max(0, Math.min(STOCK_HOURS, (nowMs - idleAtMs) / MS_HOUR));
}

export function idleRate(kinds: readonly WorkerKind[]): number {
  return Math.round(kinds.reduce((sum, k) => sum + WORKERS[k].rate, 0) * 1e6) / 1e6;
}

// ----------------------------------------------------------------------------- clicking

export function critChance(pick: number, activeWorkers: number, terrain: Terrain): number {
  return Math.min(
    CRIT_MAX,
    CRIT_BASE +
      CRIT_PER_LEVEL * clampLevel(pick) +
      CRIT_WORKER_BONUS * activeWorkers +
      (terrain === 'hit' ? TERRAIN_HIT_BONUS : 0),
  );
}

/** Pay and fatigue of one plain click (no crit, combo or relic): the legacy `click_outcome`. */
export function clickOutcome(
  pick: number,
  glove: number,
  fatigue: number,
  terrain: Terrain = 'none',
): { fatigue: number; pay: number } {
  const gain = fatigueGain(glove) * (terrain === 'fatigue' ? 1 - TERRAIN_FATIGUE_CUT : 1);
  return {
    fatigue: Math.min(FATIGUE_MAX, Math.round((fatigue + gain) * 1e9) / 1e9),
    pay: clickPay(pick, fatigue),
  };
}

export interface ClickInput {
  pick: number;
  glove: number;
  fatigue: number;
  /** Lifetime clicks before this one. */
  clicks: number;
  /** Clicks already made today. */
  dayClicks: number;
  activeWorkers: number;
  terrain: Terrain;
  /** `relic_fossil` buff. */
  clickBuff: number;
  /** Too regular for a human for three hours: pay is capped like the daily cap. */
  autoSuspected: boolean;
}

export interface ClickResult {
  pay: number;
  fatigue: number;
  crit: boolean;
  combo: boolean;
  /** Ore found on a vein hit. */
  ore: string | null;
  capped: boolean;
}

export function click(input: ClickInput, rng: Rng): ClickResult {
  const gain =
    fatigueGain(input.glove) * (input.terrain === 'fatigue' ? 1 - TERRAIN_FATIGUE_CUT : 1);
  const fatigue = Math.min(FATIGUE_MAX, Math.round((input.fatigue + gain) * 1e9) / 1e9);
  if (input.dayClicks >= MAX_CLICKS_PER_DAY || input.autoSuspected) {
    return { pay: OVER_CAP_PAY, fatigue, crit: false, combo: false, ore: null, capped: true };
  }
  let pay = clickPay(input.pick, input.fatigue);
  if (input.clickBuff > 0) pay = Math.max(1, chanceRound(pay * (1 + input.clickBuff), rng));
  const crit = rng.float() < critChance(input.pick, input.activeWorkers, input.terrain);
  let ore: string | null = null;
  if (crit) {
    pay *= CRIT_MULT;
    if (rng.float() < CRIT_ORE_CHANCE) {
      const weights = CRIT_ORES.map((o) =>
        o.id === 'silver' && input.terrain === 'silver' ? o.weight * TERRAIN_SILVER_MULT : o.weight,
      );
      let x = rng.float() * weights.reduce((a, b) => a + b, 0);
      let pickIdx = weights.length - 1;
      for (let i = 0; i < weights.length; i++) {
        if (x < (weights[i] as number)) {
          pickIdx = i;
          break;
        }
        x -= weights[i] as number;
      }
      const found = CRIT_ORES[pickIdx];
      if (found) {
        ore = found.id;
        pay += found.value;
      }
    }
  }
  const combo = (input.clicks + 1) % COMBO_SIZE === 0;
  if (combo) pay = roundHalfEven(pay * (1 + COMBO_BONUS));
  return { pay, fatigue, crit, combo, ore, capped: false };
}

// ----------------------------------------------------------------------------- anti-macro

export interface ClickHour {
  clicks: number;
  pay: number;
  gaps: number;
  sumGap: number;
  sumGap2: number;
  minGap: number;
}

/** Add one click to its hour's aggregate; `gapSec` is the time since the previous click. */
export function addClickToHour(
  hour: ClickHour | undefined,
  pay: number,
  gapSec: number | null,
): ClickHour {
  const h: ClickHour = hour
    ? { ...hour }
    : { clicks: 0, pay: 0, gaps: 0, sumGap: 0, sumGap2: 0, minGap: Number.POSITIVE_INFINITY };
  h.clicks += 1;
  h.pay += pay;
  if (gapSec !== null && gapSec > 0 && gapSec <= CLICK_GAP_MAX) {
    h.gaps += 1;
    h.sumGap += gapSec;
    h.sumGap2 += gapSec * gapSec;
    h.minGap = Math.min(h.minGap, gapSec);
  }
  return h;
}

/** Many clicks at almost the same interval (stddev/mean below 10 %). */
export function isMechanicalHour(h: ClickHour): boolean {
  if (h.gaps < 2 || h.clicks < MECH_MIN_CLICKS) return false;
  const mean = h.sumGap / h.gaps;
  if (mean <= 0) return false;
  const variance = Math.max(0, h.sumGap2 / h.gaps - mean * mean);
  return Math.sqrt(variance) / mean < MECH_CV_MAX;
}

/** All of the three completed hours before `currentHour` look mechanical. */
export function autoClickSuspected(
  hours: ReadonlyMap<number, ClickHour>,
  currentHour: number,
): boolean {
  for (let k = 1; k <= SUSPECT_HOURS; k++) {
    const h = hours.get(currentHour - k);
    if (!h || !isMechanicalHour(h)) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------- idle settlement

export interface WorkerRow {
  id: number;
  kind: WorkerKind;
  expiresAt: number;
  renew: boolean;
}

export interface Find {
  /** Time of the roll (UTC ms). */
  at: number;
  worker: WorkerKind;
  item: string;
  qty: number;
  kind: 'ore' | 'relic';
}

export interface SettlePlan {
  hours: number;
  /** Pelica gained: wages plus the value of ores. */
  gain: number;
  wage: number;
  ores: Record<string, number>;
  relics: Record<string, number>;
  finds: Find[];
  renewed: number[];
  removed: number[];
  potSpent: number;
  balanceSpent: number;
}

/**
 * Settle the idle time since the last visit: renew or drop expired contracts, pay wages and roll
 * ores and relics for each worker-hour. `renewCost` is the contract fee of a worker, `balance`
 * the wallet and `pot` the pot already in the stock.
 */
export function settlePlan(input: {
  nowMs: number;
  idleAtMs: number;
  pot: number;
  balance: number;
  workers: readonly WorkerRow[];
  wageBuff: number;
  luckBuff: number;
  rng: Rng;
}): SettlePlan {
  const { nowMs, rng } = input;
  const hours = idleHours(input.idleAtMs, nowMs);
  const startMs = nowMs - hours * MS_HOUR;
  const active = input.workers.filter((w) => w.expiresAt > nowMs);
  const expired = input.workers
    .filter((w) => w.expiresAt <= nowMs)
    .sort((a, b) => WORKERS[b.kind].fee - WORKERS[a.kind].fee);

  const provisional = Math.floor(
    idleRate(active.map((w) => w.kind)) * (1 + input.wageBuff) * hours,
  );
  let availPot = input.pot + provisional;
  let potSpent = 0;
  let balanceSpent = 0;
  const renewed: number[] = [];
  const removed: number[] = [];
  const removedWorked: { worker: WorkerRow; worked: number }[] = [];
  for (const w of expired) {
    const fee = WORKERS[w.kind].fee;
    if (w.renew && availPot + (input.balance - balanceSpent) >= fee) {
      const fromPot = Math.min(availPot, fee);
      availPot -= fromPot;
      potSpent += fromPot;
      balanceSpent += fee - fromPot;
      renewed.push(w.id);
    } else {
      removed.push(w.id);
      removedWorked.push({
        worker: w,
        worked: Math.max(0, Math.min(nowMs, w.expiresAt) - startMs) / MS_HOUR,
      });
    }
  }

  const staying = [...active, ...input.workers.filter((w) => renewed.includes(w.id))];
  const foremen = staying.filter((w) => w.kind === 'foreman').length;
  const luck = FOREMAN_LUCK * foremen + input.luckBuff;

  const finds: Find[] = [];
  const ores: Record<string, number> = {};
  const relics: Record<string, number> = {};
  let totalWage = 0;
  const work = (w: WorkerRow, h: number): void => {
    const spec = WORKERS[w.kind];
    totalWage += spec.rate * (1 + input.wageBuff) * h;
    if (spec.oreMultiplier <= 0) return;
    const whole = Math.floor(h);
    const n = whole + (rng.float() < h - whole ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const at = Math.round(startMs + (k + 1) * MS_HOUR);
      let x = rng.float();
      let ore: Ore | null = null;
      for (const o of ORES) {
        const p = o.prob * spec.oreMultiplier * (1 + luck);
        if (x < p) {
          ore = o;
          break;
        }
        x -= p;
      }
      if (!ore && x < COAL.prob) ore = COAL;
      if (ore) {
        ores[ore.id] = (ores[ore.id] ?? 0) + 1;
        finds.push({ at, worker: w.kind, item: ore.id, qty: 1, kind: 'ore' });
      }
      let y = rng.float();
      for (const r of RELIC_DROPS) {
        const p = r.prob * spec.relicMultiplier * (1 + luck);
        if (y < p) {
          relics[r.item] = (relics[r.item] ?? 0) + 1;
          finds.push({ at, worker: w.kind, item: r.item, qty: 1, kind: 'relic' });
          break;
        }
        y -= p;
      }
    }
  };
  for (const w of staying) work(w, hours);
  for (const { worker, worked } of removedWorked) work(worker, worked);

  const wage = Math.floor(totalWage);
  return {
    hours,
    gain: wage + oreGain(ores),
    wage,
    ores,
    relics,
    finds,
    renewed,
    removed,
    potSpent,
    balanceSpent,
  };
}

export const CONTRACT_MS = CONTRACT_DAYS * MS_DAY;

export const BIG_ORES: ReadonlySet<string> = new Set(['diamond', 'legend']);
export const BIG_RELICS: ReadonlySet<string> = new Set(['relic_crown', 'relic_tear']);
