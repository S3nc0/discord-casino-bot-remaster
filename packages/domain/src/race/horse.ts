export const STAT_KEYS = ['speed', 'stamina', 'power', 'guts'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_MIN = 20;
export const STAT_MAX = 80;
export const STAT_TOTAL = 200;
export const CARROT_POINTS = 5;
export const GOLD_CARROT_POINTS = 5;
export const GOLD_CARROT_MAX = 1;
export const MAX_HORSES = 3;
export const NAME_MAX = 12;
export const MAX_RACES = 32;
export const HORSE_VOUCHER_PRICE = 30_000;

export const RETIRE_WIN = 5000;
export const RETIRE_PLACE = 2000;
export const RETIRE_LOSS = 2000;
export const RETIRE_MAX = 60_000;
export const RETIRE_FEE_MAX = 20_000;

export const COATS = ['栗毛', '鹿毛', '黒鹿毛', '青毛', '芦毛', '白毛', '栃栗毛', '月毛'] as const;
export const SILKS = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫'] as const;

export const RUNNING_STYLES = ['nige', 'senko', 'sashi', 'oikomi'] as const;
export type RunningStyle = (typeof RUNNING_STYLES)[number];

const STYLE_OF_STAT: Record<StatKey, RunningStyle> = {
  speed: 'nige',
  power: 'senko',
  stamina: 'sashi',
  guts: 'oikomi',
};

export const DEFAULT_STATS: Readonly<Stats> = { speed: 50, stamina: 50, power: 50, guts: 50 };

export function statSum(stats: Stats): number {
  return stats.speed + stats.stamina + stats.power + stats.guts;
}

/** Automatic running style: highest stat, ties broken speed → stamina → power → guts. */
export function styleOf(stats: Stats): RunningStyle {
  let best: StatKey = 'speed';
  for (const key of STAT_KEYS) if (stats[key] > stats[best]) best = key;
  return STYLE_OF_STAT[best];
}

export type StatError = 'select_distinct_stats' | 'stat_at_min' | 'stat_at_max';

/** Carrot: move 5 points from `src` to `dst`. The total stays the same. */
export function moveCarrot(
  stats: Stats,
  src: StatKey,
  dst: StatKey,
): { ok: true; stats: Stats } | { ok: false; error: StatError; stat?: StatKey } {
  if (src === dst) return { ok: false, error: 'select_distinct_stats' };
  if (stats[src] - CARROT_POINTS < STAT_MIN) return { ok: false, error: 'stat_at_min', stat: src };
  if (stats[dst] + CARROT_POINTS > STAT_MAX) return { ok: false, error: 'stat_at_max', stat: dst };
  return {
    ok: true,
    stats: { ...stats, [src]: stats[src] - CARROT_POINTS, [dst]: stats[dst] + CARROT_POINTS },
  };
}

/** Gold carrot: +5 to two chosen stats (may be the same one for +10). One per horse. */
export function addGoldCarrot(
  stats: Stats,
  first: StatKey,
  second: StatKey,
): { ok: true; stats: Stats } | { ok: false; error: StatError; stat?: StatKey } {
  const next: Stats = { ...stats };
  next[first] += GOLD_CARROT_POINTS;
  next[second] += GOLD_CARROT_POINTS;
  for (const key of STAT_KEYS) {
    if (next[key] > STAT_MAX) return { ok: false, error: 'stat_at_max', stat: key };
  }
  return { ok: true, stats: next };
}

/** Retirement value: positive pays the owner, negative is a fee. Clamped to -20,000..60,000. */
export function retireValue(races: number, wins: number, places: number): number {
  const value =
    wins * RETIRE_WIN +
    Math.max(0, places - wins) * RETIRE_PLACE -
    Math.max(0, races - places) * RETIRE_LOSS;
  return Math.max(-RETIRE_FEE_MAX, Math.min(RETIRE_MAX, value));
}

/** What a horse counts for in net worth. */
export function horseWorth(races: number, wins: number, places: number): number {
  return Math.max(0, HORSE_VOUCHER_PRICE + retireValue(races, wins, places));
}

const BANNED_NAME_CHARS = '@<>`*_~|\\\n\r\t#:/';

export type NameError = 'name_empty' | 'name_too_long' | 'name_invalid_chars';

export function validateHorseName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: NameError } {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: 'name_empty' };
  if ([...name].length > NAME_MAX) return { ok: false, error: 'name_too_long' };
  for (const ch of name) {
    if (BANNED_NAME_CHARS.includes(ch)) return { ok: false, error: 'name_invalid_chars' };
  }
  if (name.toLowerCase().includes('http')) return { ok: false, error: 'name_invalid_chars' };
  return { ok: true, name };
}

export function isValidLook(coat: string, silks: string): boolean {
  return (
    (COATS as readonly string[]).includes(coat) && (SILKS as readonly string[]).includes(silks)
  );
}
