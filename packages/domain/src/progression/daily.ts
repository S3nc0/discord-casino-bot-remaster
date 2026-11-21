import { debtorSkim, withholdIncome } from './economy-core.ts';
import {
  dayStartMs,
  localDayNumber,
  localHour,
  MS_HOUR,
  ordinalOf,
  roundHalfEven,
} from './time.ts';

export const DAILY_BASE = 1000;
export const DAILY_STREAK_BONUS = 100;
export const DAILY_STREAK_CAP = 20;
export const DAILY_SLOT_HOURS = 6;
export const SLOTS_PER_DAY = 24 / DAILY_SLOT_HOURS;

/** Claim slot of a moment: `ordinal(day) * 4 + hour / 6`. */
export function dailySlot(ms: number, offsetHours: number): number {
  return (
    ordinalOf(localDayNumber(ms, offsetHours)) * SLOTS_PER_DAY +
    Math.floor(localHour(ms, offsetHours) / DAILY_SLOT_HOURS)
  );
}

/** When the next slot opens (UTC ms). */
export function nextDailySlotMs(ms: number, offsetHours: number): number {
  const day = localDayNumber(ms, offsetHours);
  const next = (Math.floor(localHour(ms, offsetHours) / DAILY_SLOT_HOURS) + 1) * DAILY_SLOT_HOURS;
  return dayStartMs(day, offsetHours) + next * MS_HOUR;
}

/** Payout before multipliers for the n-th consecutive day. */
export function dailyBase(streak: number): number {
  return DAILY_BASE + DAILY_STREAK_BONUS * Math.min(Math.max(streak - 1, 0), DAILY_STREAK_CAP);
}

export interface DailyState {
  /** Consecutive calendar days claimed. */
  streak: number;
  /** Local day number of the last claim, or null. */
  lastDay: number | null;
  /** Slot of the last claim, or null (legacy rows: derived from `lastDay`). */
  lastSlot: number | null;
}

export interface DailyInput {
  state: DailyState;
  nowMs: number;
  offsetHours: number;
  /** Streak guard tickets held. */
  streakGuards: number;
  /** Armed daily_double charges. */
  dailyBoost: number;
  /** `relic_crown` buff (0.01 per relic, stacked). */
  relicBuff: number;
  /** Teiai debt of the claimant (after interest). */
  debt: number;
}

export interface DailyResult {
  ok: boolean;
  /** Why it was refused: `already_claimed` or `clock_rollback`. */
  reason?: 'already_claimed' | 'clock_rollback';
  /** Gross amount after double and relic. */
  amount: number;
  /** Cut kept by Teiai (debtors only). */
  skimmed: number;
  /** Amount credited to the wallet before debt withholding. */
  credit: number;
  /** Part of `credit` withheld toward the debt. */
  repaid: number;
  streak: number;
  boosted: boolean;
  guarded: number;
  /** Items to consume. */
  consume: { streakGuard: number; dailyBoost: number };
  state: DailyState;
}

const REFUSED = (state: DailyState, reason: 'already_claimed' | 'clock_rollback'): DailyResult => ({
  ok: false,
  reason,
  amount: 0,
  skimmed: 0,
  credit: 0,
  repaid: 0,
  streak: Math.max(1, state.streak),
  boosted: false,
  guarded: 0,
  consume: { streakGuard: 0, dailyBoost: 0 },
  state,
});

/** One daily claim, exactly as the legacy wallet did it. Pure: the caller applies `consume`. */
export function claimDaily(input: DailyInput): DailyResult {
  const { state, nowMs, offsetHours } = input;
  const today = localDayNumber(nowMs, offsetHours);
  const slot = dailySlot(nowMs, offsetHours);
  const last = state.lastDay;
  const lastSlot = state.lastSlot === null && last !== null ? ordinalOf(last) : state.lastSlot;

  if (last !== null && last > today) return REFUSED(state, 'clock_rollback');
  if (lastSlot !== null && slot <= lastSlot) return REFUSED(state, 'already_claimed');

  let streak: number;
  let guarded = 0;
  if (last === today) {
    streak = Math.max(1, state.streak);
  } else if (last === today - 1) {
    streak = state.streak + 1;
  } else {
    streak = 1;
    const missed = last === null ? 0 : today - last - 1;
    if (missed > 0 && state.streak > 0 && input.streakGuards >= missed) {
      streak = state.streak + 1;
      guarded = missed;
    }
  }

  let amount = dailyBase(streak);
  let boosted = false;
  if (input.dailyBoost > 0) {
    amount *= 2;
    boosted = true;
  }
  amount = roundHalfEven(amount * (1 + input.relicBuff));

  const skimmed = input.debt > 0 ? debtorSkim(amount) : 0;
  const credit = amount - skimmed;
  const repaid = withholdIncome(credit, input.debt);

  return {
    ok: true,
    amount,
    skimmed,
    credit,
    repaid,
    streak,
    boosted,
    guarded,
    consume: { streakGuard: guarded, dailyBoost: boosted ? 1 : 0 },
    state: { streak, lastDay: today, lastSlot: slot },
  };
}
