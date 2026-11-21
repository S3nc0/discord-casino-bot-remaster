import { dayStartMs, localDayNumber, localHour, MS_HOUR, weekdayOf } from '../progression/time.ts';

export const WEEKDAY_HOURS = [9, 12, 15, 18, 21] as const;
export const WEEKEND_HOURS = [9, 13, 17, 21] as const;
export const MAJOR_HOUR = 21;
export const ENTRY_OPEN_MIN = 120;
export const ENTRY_LEAD_MIN = 60;
export const BET_LEAD_SEC = 120;
export const ENTRY_FEE = 1000;
export const FIELD_SIZE = 8;

export const RACE_STATUSES = ['entry', 'betting', 'done'] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];
export type RaceKind = 'regular' | 'special';

/** Local start hours of a day's regular races: 5 on weekdays, 4 on weekends. */
export function raceHours(dayNumber: number): readonly number[] {
  return weekdayOf(dayNumber) >= 5 ? WEEKEND_HOURS : WEEKDAY_HOURS;
}

/** Start times (UTC ms) of the regular races of a local day. */
export function dailyRaceStarts(dayNumber: number, offsetHours: number): number[] {
  return raceHours(dayNumber).map((h) => dayStartMs(dayNumber, offsetHours) + h * MS_HOUR);
}

export interface RaceTimes {
  startAt: number;
  entryOpen: number;
  entryClose: number;
  betClose: number;
}

export function regularRaceTimes(startAt: number): RaceTimes {
  return {
    startAt,
    entryOpen: startAt - ENTRY_OPEN_MIN * 60_000,
    entryClose: startAt - ENTRY_LEAD_MIN * 60_000,
    betClose: startAt - BET_LEAD_SEC * 1000,
  };
}

/** Admin-created race: entries close after `entryMin`, betting runs `betMin`, start 2 min later. */
export function specialRaceTimes(nowMs: number, entryMin: number, betMin: number): RaceTimes {
  const entryClose = nowMs + entryMin * 60_000;
  const betClose = entryClose + betMin * 60_000;
  return { startAt: betClose + BET_LEAD_SEC * 1000, entryOpen: nowMs, entryClose, betClose };
}

/** A regular race starting at 21:00 local is the major race with doubled prizes. */
export function isMajorRace(kind: RaceKind, startAt: number, offsetHours: number): boolean {
  return kind === 'regular' && localHour(startAt, offsetHours) === MAJOR_HOUR;
}

/** Which phase a race is in at `nowMs` (by the clock only; the service stores the real status). */
export function phaseAt(times: RaceTimes, nowMs: number): RaceStatus | 'closed' {
  if (nowMs < times.entryClose) return 'entry';
  if (nowMs < times.startAt) return nowMs < times.betClose ? 'betting' : 'closed';
  return 'done';
}

export function raceDayOf(startAt: number, offsetHours: number): number {
  return localDayNumber(startAt, offsetHours);
}
