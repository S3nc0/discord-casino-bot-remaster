export const WEEKLY_MIN_PLAYS = 5;
export const WEEKLY_ANNOUNCE_TOP = 5;
export const WEEKLY_CHECK_MINUTES = 5;
export const WEEKLY_TITLE_ID = 'title_weekly_king';

export interface WeeklyRow {
  userId: string;
  net: number;
  plays: number;
}

function compareId(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `ORDER BY net DESC, plays ASC, user_id ASC`. */
export function sortStandings(rows: readonly WeeklyRow[]): WeeklyRow[] {
  return [...rows].sort(
    (a, b) => b.net - a.net || a.plays - b.plays || compareId(a.userId, b.userId),
  );
}

export function weeklyTop(
  rows: readonly WeeklyRow[],
  n: number = WEEKLY_ANNOUNCE_TOP,
): WeeklyRow[] {
  return sortStandings(rows).slice(0, n);
}

/** 1-based rank with the player's row and the field size, or null when they have no row. */
export function weeklyRank(
  rows: readonly WeeklyRow[],
  userId: string,
): { rank: number; net: number; plays: number; total: number } | null {
  const sorted = sortStandings(rows);
  const index = sorted.findIndex((r) => r.userId === userId);
  const row = sorted[index];
  if (!row) return null;
  return { rank: index + 1, net: row.net, plays: row.plays, total: sorted.length };
}

/** Top profitable player with at least 5 plays, same order as the standings. */
export function pickChampion(rows: readonly WeeklyRow[]): WeeklyRow | null {
  return sortStandings(rows).find((r) => r.net > 0 && r.plays >= WEEKLY_MIN_PLAYS) ?? null;
}

export interface WeeklyAward {
  week: string;
  champion: WeeklyRow | null;
  /** Holders whose title was stripped and who did not win again. */
  previous: string[];
  /** Title wins of the champion including this one. */
  wins: number;
  standings: WeeklyRow[];
}

/**
 * Settle one finished week. Returns null when `lastWeek` is already this week or later (the
 * guard against announcing twice). The title is always stripped from every holder first, so a
 * repeating champion gets it again but has to re-equip it (legacy behaviour).
 */
export function settleWeek(input: {
  week: string;
  lastWeek: string | null;
  rows: readonly WeeklyRow[];
  holders: readonly string[];
  /** Weeks this guild's champion had already won before this one, keyed by user. */
  priorWins: ReadonlyMap<string, number>;
}): WeeklyAward | null {
  if (input.lastWeek !== null && input.lastWeek >= input.week) return null;
  const champion = pickChampion(input.rows);
  return {
    week: input.week,
    champion,
    previous: input.holders.filter((u) => champion === null || u !== champion.userId),
    wins: champion ? (input.priorWins.get(champion.userId) ?? 0) + 1 : 0,
    standings: weeklyTop(input.rows),
  };
}
