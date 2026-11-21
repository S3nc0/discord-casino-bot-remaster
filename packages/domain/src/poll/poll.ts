export const RIG_COST = 500;
export const DEFAULT_MINUTES = 1440;
export const MAX_MINUTES = 43_200;
export const MAX_OPEN_PER_USER = 5;
export const TITLE_MAX = 200;
export const MAX_COUNT = 1_000_000;

export const POLL_STATUSES = ['open', 'closed'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

/** The count players see: real votes plus the rigged offset, never below 0. */
export function shown(real: number, adj: number): number {
  return Math.max(0, real + adj);
}

export interface Tally {
  realYes: number;
  realNo: number;
  adjYes: number;
  adjNo: number;
}

export function shownCounts(t: Tally): { yes: number; no: number } {
  return { yes: shown(t.realYes, t.adjYes), no: shown(t.realNo, t.adjNo) };
}

export type PollError =
  | 'poll_title_invalid'
  | 'poll_duration_invalid'
  | 'poll_open_limit'
  | 'poll_closed'
  | 'poll_creator_only'
  | 'poll_count_range'
  | 'insufficient_balance';

export function validateNewPoll(
  title: string,
  minutes: number,
  openCount: number,
): PollError | null {
  const t = title.trim();
  if (t.length === 0 || [...t].length > TITLE_MAX) return 'poll_title_invalid';
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)
    return 'poll_duration_invalid';
  if (openCount >= MAX_OPEN_PER_USER) return 'poll_open_limit';
  return null;
}

/**
 * Rig the displayed counts to `yes`/`no`: stored as offsets from the real votes so later real
 * votes keep adding to (or removing from) the rigged totals.
 */
export function planRig(
  t: Pick<Tally, 'realYes' | 'realNo'>,
  yes: number,
  no: number,
): { ok: true; adjYes: number; adjNo: number } | { ok: false; error: PollError } {
  const bad = (n: number): boolean => !Number.isInteger(n) || n < 0 || n > MAX_COUNT;
  if (bad(yes) || bad(no)) return { ok: false, error: 'poll_count_range' };
  return { ok: true, adjYes: yes - t.realYes, adjNo: no - t.realNo };
}

export type Verdict = 'yes' | 'no' | 'tie';

export function verdict(counts: { yes: number; no: number }): Verdict {
  return counts.yes > counts.no ? 'yes' : counts.no > counts.yes ? 'no' : 'tie';
}
