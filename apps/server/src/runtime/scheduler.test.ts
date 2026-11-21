import { afterEach, describe, expect, it, vi } from 'vitest';
import { manualClock } from '@casino/shared';
import { createLogger } from './logger.ts';
import { Scheduler, type CronDriver, type JobSpec } from './scheduler.ts';

const logger = createLogger({ level: 'silent' });

/** A driver that records schedules and fires them when the test says so. */
function fakeDriver() {
  const schedules: { cron: string; utcOffsetMinutes: number; fire: () => void; live: boolean }[] =
    [];
  const driver: CronDriver = {
    schedule(cron, { utcOffsetMinutes }, fire) {
      const entry = { cron, utcOffsetMinutes, fire, live: true };
      schedules.push(entry);
      return {
        stop: () => {
          entry.live = false;
        },
      };
    },
  };
  return { driver, schedules };
}

const job = (id: string, run: JobSpec['run'], cron = '* * * * *'): JobSpec => ({ id, cron, run });

describe('Scheduler', () => {
  it('schedules every job in the manifest in the game offset, and nothing before start()', () => {
    const { driver, schedules } = fakeDriver();
    const scheduler = new Scheduler({
      clock: manualClock(0),
      logger,
      utcOffsetHours: 9,
      driver,
      jobs: [job('a:one', () => {}), job('a:two', () => {}, '*/5 * * * * *')],
    });
    expect(scheduler.jobIds).toEqual(['a:one', 'a:two']);
    expect(schedules).toHaveLength(0);
    scheduler.start();
    expect(schedules.map((s) => [s.cron, s.utcOffsetMinutes])).toEqual([
      ['* * * * *', 540],
      ['*/5 * * * * *', 540],
    ]);
    scheduler.start();
    expect(schedules).toHaveLength(2);
  });

  it('rejects a duplicate job id', () => {
    expect(
      () =>
        new Scheduler({
          clock: manualClock(0),
          logger,
          utcOffsetHours: 9,
          jobs: [job('x', () => {}), job('x', () => {})],
        }),
    ).toThrow(/duplicate job id/);
  });

  it('passes the clock time to the job', async () => {
    const clock = manualClock(1_000);
    const { driver, schedules } = fakeDriver();
    const seen: number[] = [];
    const scheduler = new Scheduler({
      clock,
      logger,
      utcOffsetHours: 9,
      driver,
      jobs: [job('a', (now) => void seen.push(now))],
    });
    scheduler.start();
    schedules[0]!.fire();
    await scheduler.drain();
    clock.advance(60_000);
    schedules[0]!.fire();
    await scheduler.drain();
    expect(seen).toEqual([1_000, 61_000]);
  });

  it('logs a failing job (sync throw or rejection) and still runs the others', async () => {
    const { driver, schedules } = fakeDriver();
    const ran: string[] = [];
    const scheduler = new Scheduler({
      clock: manualClock(0),
      logger,
      utcOffsetHours: 9,
      driver,
      jobs: [
        job('boom', () => {
          throw new Error('sync');
        }),
        job('reject', () => Promise.reject(new Error('async'))),
        job('fine', () => void ran.push('fine')),
      ],
    });
    scheduler.start();
    for (const s of schedules) s.fire();
    await scheduler.drain();
    expect(ran).toEqual(['fine']);
    const byId = Object.fromEntries(scheduler.status().map((s) => [s.id, s]));
    expect(byId.boom).toMatchObject({ runs: 1, failures: 1, running: false });
    expect(byId.reject).toMatchObject({ runs: 1, failures: 1 });
    expect(byId.fine).toMatchObject({ runs: 1, failures: 0 });

    // A failure does not disable the job: the next tick runs it again.
    schedules[0]!.fire();
    await scheduler.drain();
    expect(scheduler.status()[0]).toMatchObject({ runs: 2, failures: 2 });
  });

  it('never overlaps a job with itself, and counts the skipped tick', async () => {
    const { driver, schedules } = fakeDriver();
    let release: () => void = () => {};
    let starts = 0;
    const scheduler = new Scheduler({
      clock: manualClock(0),
      logger,
      utcOffsetHours: 9,
      driver,
      jobs: [
        job('slow', () => {
          starts += 1;
          return new Promise<void>((resolve) => (release = resolve));
        }),
      ],
    });
    scheduler.start();
    schedules[0]!.fire();
    schedules[0]!.fire();
    schedules[0]!.fire();
    expect(starts).toBe(1);
    expect(scheduler.status()[0]).toMatchObject({ running: true, skipped: 2 });
    release();
    await scheduler.drain();
    expect(scheduler.status()[0]).toMatchObject({ running: false, runs: 1 });
    schedules[0]!.fire();
    expect(starts).toBe(2);
    release();
    await scheduler.drain();
  });

  it('stop() cancels every schedule, drain() waits for a run in flight, and start() works again', async () => {
    const { driver, schedules } = fakeDriver();
    let release: () => void = () => {};
    let finished = false;
    const scheduler = new Scheduler({
      clock: manualClock(0),
      logger,
      utcOffsetHours: 9,
      driver,
      jobs: [
        job('a', () =>
          new Promise<void>((resolve) => (release = resolve)).then(() => void (finished = true)),
        ),
        job('b', () => {}),
      ],
    });
    scheduler.start();
    schedules[0]!.fire();
    scheduler.stop();
    expect(schedules.every((s) => !s.live)).toBe(true);
    let drained = false;
    const waiting = scheduler.drain().then(() => void (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await waiting;
    expect(finished).toBe(true);
    scheduler.start();
    expect(schedules.filter((s) => s.live)).toHaveLength(2);
    scheduler.stop();
  });

  it('runNow() runs a job once and reports a skipped overlap; unknown ids reject', async () => {
    const scheduler = new Scheduler({
      clock: manualClock(0),
      logger,
      utcOffsetHours: 9,
      driver: fakeDriver().driver,
      jobs: [job('a', () => {})],
    });
    await expect(scheduler.runNow('a')).resolves.toBe(true);
    await expect(scheduler.runNow('nope')).rejects.toThrow(/unknown job/);
  });
});

describe('Scheduler on croner', () => {
  afterEach(() => vi.useRealTimers());

  it('reads cron fields in the game offset (0:00 JST = 15:00 UTC) on a fake clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-22T14:58:00Z'));
    const fired: string[] = [];
    const scheduler = new Scheduler({
      clock: { now: () => Date.now() },
      logger,
      utcOffsetHours: 9,
      jobs: [
        job('midnight', () => void fired.push(new Date().toISOString()), '0 0 * * *'),
        job('hourly-9', () => void fired.push('h9'), '0 9 * * *'),
      ],
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fired).toEqual(['2026-11-22T15:00:00.000Z']);
    // 9:00 JST is 00:00 UTC, nine hours later.
    await vi.advanceTimersByTimeAsync(9 * 3_600_000);
    expect(fired).toEqual(['2026-11-22T15:00:00.000Z', 'h9']);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(fired).toHaveLength(2);
  });

  it('fires six-field (seconds) schedules', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-22T00:00:00Z'));
    let count = 0;
    const scheduler = new Scheduler({
      clock: { now: () => Date.now() },
      logger,
      utcOffsetHours: 9,
      jobs: [job('tick', () => void (count += 1), '*/5 * * * * *')],
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(count).toBe(6);
    scheduler.stop();
  });
});
