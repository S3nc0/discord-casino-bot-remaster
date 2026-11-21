import { PyRandom } from '../../progression/py-random.ts';
import { JST_OFFSET_HOURS, MS_HOUR, isoDate, localDayNumber } from '../../progression/time.ts';
import { EVENT_BONUS_CAP, type CasinoGame } from './constants.ts';
import { bestBoost } from './settlement.ts';

// The casino event boost calendar: one sudden event per guild and day (a pure function of the
// guild id and the date, so every process agrees without storing it), plus owner-started
// manual events. Spec: docs/spec/casino-common.md, "Sudden Events & Manual Special Events".

/** The five games' legacy names, as the daily draw lists them. */
export const EVENT_GAME_NAMES: Readonly<Record<string, CasinoGame>> = {
  チンチロ: 'chinchiro',
  パチンコ: 'pachinko',
  スロット: 'slots',
  ブラックジャック: 'blackjack',
  ルーレット: 'roulette',
};

/** The draw picks from this list in code-point order (`sorted([...])`). */
const EVENT_GAME_POOL: readonly string[] = Object.keys(EVENT_GAME_NAMES).sort();

/** Earliest and latest start minute (JST): 12:00 up to and including 23:30, in 5-minute steps. */
export const EVENT_START_MIN = 720;
export const EVENT_START_MAX = 1410;
export const EVENT_START_STEP = 5;
export const EVENT_DURATION_MIN = 30;
/** +50 % of the profit while a sudden event runs. */
export const SUDDEN_EVENT_BOOST = 0.5;
export { EVENT_BONUS_CAP };

export interface SuddenEvent {
  /** JST calendar day, `YYYY-MM-DD`. */
  day: string;
  /** The legacy game name the draw returned. */
  gameName: string;
  game: CasinoGame;
  /** Minutes after local midnight. */
  startMin: number;
  endMin: number;
}

/** The sudden event of a guild on a local day (days since 1970-01-01 in the game's timezone). */
export function suddenEventOn(guildId: string, dayNumber: number): SuddenEvent {
  const day = isoDate(dayNumber);
  const rng = new PyRandom(`event:${guildId}:${day}`);
  const gameName = rng.choice(EVENT_GAME_POOL);
  const steps = Math.floor((EVENT_START_MAX - EVENT_START_MIN) / EVENT_START_STEP) + 1;
  const startMin = EVENT_START_MIN + EVENT_START_STEP * rng.randBelow(steps);
  return {
    day,
    gameName,
    game: EVENT_GAME_NAMES[gameName] as CasinoGame,
    startMin,
    endMin: startMin + EVENT_DURATION_MIN,
  };
}

/** Minutes since local midnight at `nowMs`. */
export function minuteOfDay(nowMs: number, offsetHours: number = JST_OFFSET_HOURS): number {
  const local = nowMs + offsetHours * MS_HOUR;
  const dayMs = 24 * MS_HOUR;
  return Math.floor((((local % dayMs) + dayMs) % dayMs) / 60_000);
}

/** The sudden event running at `nowMs` (`start <= now < end`), or null. */
export function activeSuddenEvent(
  guildId: string,
  nowMs: number,
  offsetHours: number = JST_OFFSET_HOURS,
): SuddenEvent | null {
  const event = suddenEventOn(guildId, localDayNumber(nowMs, offsetHours));
  const now = minuteOfDay(nowMs, offsetHours);
  return event.startMin <= now && now < event.endMin ? event : null;
}

/** Boost the sudden event gives `game` at `nowMs`: 0.5 while it runs on that game, else 0. */
export function scheduledBoost(
  guildId: string,
  game: CasinoGame,
  nowMs: number,
  offsetHours: number = JST_OFFSET_HOURS,
): number {
  const event = activeSuddenEvent(guildId, nowMs, offsetHours);
  return event !== null && event.game === game ? SUDDEN_EVENT_BOOST : 0;
}

// ---- manual special events (owner command) ---------------------------------------------------

export const MANUAL_BOOST_PCT = { min: 1, max: 300, default: 50 } as const;
export const MANUAL_MINUTES = { min: 1, max: 180, default: 30 } as const;

export interface ManualEvent {
  game: CasinoGame;
  /** 1..300 (percent of the profit). */
  boostPct: number;
  startsAt: number;
  endsAt: number;
}

/** Validate and build a manual event; it replaces any running one. Null when out of range. */
export function makeManualEvent(input: {
  game: CasinoGame;
  boostPct?: number;
  minutes?: number;
  nowMs: number;
}): ManualEvent | null {
  const boostPct = input.boostPct ?? MANUAL_BOOST_PCT.default;
  const minutes = input.minutes ?? MANUAL_MINUTES.default;
  if (
    !Number.isInteger(boostPct) ||
    boostPct < MANUAL_BOOST_PCT.min ||
    boostPct > MANUAL_BOOST_PCT.max ||
    !Number.isInteger(minutes) ||
    minutes < MANUAL_MINUTES.min ||
    minutes > MANUAL_MINUTES.max
  ) {
    return null;
  }
  return {
    game: input.game,
    boostPct,
    startsAt: input.nowMs,
    endsAt: input.nowMs + minutes * 60_000,
  };
}

export function manualBoost(event: ManualEvent | null, game: CasinoGame, nowMs: number): number {
  if (event === null || event.game !== game) return 0;
  return nowMs >= event.startsAt && nowMs < event.endsAt ? event.boostPct / 100 : 0;
}

/** What a settlement uses: the better of the scheduled and the manual boost, never summed. */
export function eventBoostFor(
  guildId: string,
  game: CasinoGame,
  nowMs: number,
  manual: ManualEvent | null = null,
  offsetHours: number = JST_OFFSET_HOURS,
): number {
  return bestBoost(
    scheduledBoost(guildId, game, nowMs, offsetHours),
    manualBoost(manual, game, nowMs),
  );
}

// ---- announcement loop -----------------------------------------------------------------------

/** 0: nothing posted, 1: the start was announced, 2: the end was announced. */
export type AnnouncePhase = 0 | 1 | 2;

export interface AnnounceStep {
  phase: AnnouncePhase;
  /** What to post now; null for nothing (including the silent catch-up after a missed window). */
  post: 'start' | 'end' | null;
}

/**
 * One tick of the minute loop. Phase 0 at or after the start posts the start (and moves to 1);
 * phase 1 at or after the end posts the end (2). A bot that was down for the whole window
 * (phase 0 and `now >= end`) moves to 2 without posting anything.
 */
export function announceStep(
  event: Pick<SuddenEvent, 'startMin' | 'endMin'>,
  phase: AnnouncePhase,
  nowMin: number,
): AnnounceStep {
  if (phase === 0) {
    if (nowMin >= event.endMin) return { phase: 2, post: null };
    if (nowMin >= event.startMin) return { phase: 1, post: 'start' };
    return { phase, post: null };
  }
  if (phase === 1 && nowMin >= event.endMin) return { phase: 2, post: 'end' };
  return { phase, post: null };
}
