import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso, dayStartMs } from '../../progression/time.ts';
import {
  EVENT_GAME_NAMES,
  activeSuddenEvent,
  announceStep,
  eventBoostFor,
  makeManualEvent,
  manualBoost,
  minuteOfDay,
  scheduledBoost,
  suddenEventOn,
} from './events.ts';

interface Fixture {
  events: {
    weekly_schedule: { day: string; event: { day: string; game: string; start_min: number } }[];
    active_during_hour: { day: string; game: string; start_min: number };
    active_outside_hour: unknown;
  };
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/casino-common/formulas.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

// The fixture's guild id is above 2^53; the JSON parse rounds it, so use the exact snowflake.
const GUILD = '100000000000000001';

describe('daily event schedule parity with the legacy fixtures', () => {
  it('draws the same game and start minute for each day of the week', () => {
    expect(fixture.events.weekly_schedule).toHaveLength(7);
    for (const entry of fixture.events.weekly_schedule) {
      const event = suddenEventOn(GUILD, dayFromIso(entry.day));
      expect(event.day).toBe(entry.event.day);
      expect(event.gameName).toBe(entry.event.game);
      expect(event.startMin).toBe(entry.event.start_min);
      expect(event.endMin).toBe(entry.event.start_min + 30);
      expect(event.game).toBe(EVENT_GAME_NAMES[entry.event.game]);
    }
  });

  it('is active five minutes into the window and not three hours later', () => {
    const day = dayFromIso(fixture.events.active_during_hour.day);
    const start = fixture.events.active_during_hour.start_min;
    const at = (min: number) => dayStartMs(day) + min * 60_000;
    expect(activeSuddenEvent(GUILD, at(start + 5))?.startMin).toBe(start);
    // legacy: three hours after the start hour, on the hour
    const outside = (Math.floor(start / 60) + 3) % 24;
    expect(activeSuddenEvent(GUILD, at(outside * 60))).toBe(fixture.events.active_outside_hour);
  });

  it('keeps every start inside 12:00-23:30 on a five-minute step', () => {
    const first = dayFromIso('2025-01-01');
    for (let i = 0; i < 400; i++) {
      const event = suddenEventOn(GUILD, first + i);
      expect(event.startMin).toBeGreaterThanOrEqual(720);
      expect(event.startMin).toBeLessThanOrEqual(1410);
      expect(event.startMin % 5).toBe(0);
      expect(event.endMin).toBeLessThanOrEqual(1440);
    }
  });
});

describe('event window and boost', () => {
  const day = dayFromIso('2025-01-06'); // chinchiro from 13:25 for the fixture guild
  const at = (min: number) => dayStartMs(day) + min * 60_000;

  it('runs from the start minute up to, not including, the end minute', () => {
    expect(activeSuddenEvent(GUILD, at(804))).toBeNull();
    expect(activeSuddenEvent(GUILD, at(805))).not.toBeNull();
    expect(activeSuddenEvent(GUILD, at(834))).not.toBeNull();
    expect(activeSuddenEvent(GUILD, at(835))).toBeNull();
    expect(minuteOfDay(at(805))).toBe(805);
  });

  it('boosts only the drawn game, by 50 %', () => {
    expect(scheduledBoost(GUILD, 'chinchiro', at(810))).toBe(0.5);
    expect(scheduledBoost(GUILD, 'slots', at(810))).toBe(0);
    expect(scheduledBoost(GUILD, 'chinchiro', at(900))).toBe(0);
  });

  it('never stacks a manual event with the scheduled one', () => {
    const manual = makeManualEvent({ game: 'chinchiro', boostPct: 30, nowMs: at(800) });
    expect(eventBoostFor(GUILD, 'chinchiro', at(810), manual)).toBe(0.5);
    const big = makeManualEvent({ game: 'chinchiro', boostPct: 200, nowMs: at(800) });
    expect(eventBoostFor(GUILD, 'chinchiro', at(810), big)).toBe(2);
    expect(eventBoostFor(GUILD, 'slots', at(810), big)).toBe(0);
  });

  it('validates a manual event and expires it', () => {
    expect(makeManualEvent({ game: 'slots', nowMs: 0 })).toEqual({
      game: 'slots',
      boostPct: 50,
      startsAt: 0,
      endsAt: 30 * 60_000,
    });
    expect(makeManualEvent({ game: 'slots', boostPct: 0, nowMs: 0 })).toBeNull();
    expect(makeManualEvent({ game: 'slots', boostPct: 301, nowMs: 0 })).toBeNull();
    expect(makeManualEvent({ game: 'slots', minutes: 181, nowMs: 0 })).toBeNull();
    const e = makeManualEvent({ game: 'slots', minutes: 1, nowMs: 1000 });
    expect(manualBoost(e, 'slots', 60_999)).toBe(0.5);
    expect(manualBoost(e, 'slots', 61_000)).toBe(0);
    expect(manualBoost(null, 'slots', 0)).toBe(0);
  });
});

describe('announcement loop', () => {
  const event = { startMin: 805, endMin: 835 };
  it('announces the start, then the end, once each', () => {
    expect(announceStep(event, 0, 804)).toEqual({ phase: 0, post: null });
    expect(announceStep(event, 0, 805)).toEqual({ phase: 1, post: 'start' });
    expect(announceStep(event, 1, 820)).toEqual({ phase: 1, post: null });
    expect(announceStep(event, 1, 835)).toEqual({ phase: 2, post: 'end' });
    expect(announceStep(event, 2, 900)).toEqual({ phase: 2, post: null });
  });
  it('skips a window that passed while the bot was down, without posting', () => {
    expect(announceStep(event, 0, 835)).toEqual({ phase: 2, post: null });
    expect(announceStep(event, 0, 1000)).toEqual({ phase: 2, post: null });
  });
});
