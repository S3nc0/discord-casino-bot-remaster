import { Cron } from 'croner';
import type { Logger } from 'pino';
import type { Clock } from '@casino/shared';

/** One scheduled job as data. `cron` has five fields, or six when it runs every few seconds. */
export interface JobSpec {
  /** Unique, `module:name`. */
  id: string;
  cron: string;
  description?: string;
  /** Called with the clock's `now()`. May be async; a throw or rejection is logged, never rethrown. */
  run(nowMs: number): unknown;
}

/** A started cron schedule. */
export interface CronHandle {
  stop(): void;
}

/**
 * What the scheduler needs from a cron library. The default uses `croner`; tests pass a driver
 * they fire by hand so no real timer is involved.
 */
export interface CronDriver {
  schedule(cron: string, options: { utcOffsetMinutes: number }, fire: () => void): CronHandle;
}

export const cronerDriver: CronDriver = {
  schedule(cron, { utcOffsetMinutes }, fire) {
    const job = new Cron(cron, { utcOffset: utcOffsetMinutes, unref: true }, fire);
    return { stop: () => job.stop() };
  },
};

export interface SchedulerOptions {
  clock: Clock;
  logger: Logger;
  /** The game's UTC offset in hours (`UTC_OFFSET_HOURS`, 9 for JST). Cron fields are read in it. */
  utcOffsetHours: number;
  jobs: readonly JobSpec[];
  driver?: CronDriver;
}

export interface JobStatus {
  id: string;
  cron: string;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
}

interface JobState {
  spec: JobSpec;
  handle: CronHandle | null;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
}

/**
 * Runs every job of one manifest on its cron schedule. A job that throws is logged and the
 * others carry on; a job still running when its next tick comes is skipped (no overlap);
 * `stop()` cancels the schedules and `drain()` waits for runs already in flight.
 */
export class Scheduler {
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly utcOffsetMinutes: number;
  private readonly driver: CronDriver;
  private readonly jobs = new Map<string, JobState>();
  private readonly inFlight = new Set<Promise<void>>();
  private started = false;

  constructor(options: SchedulerOptions) {
    this.clock = options.clock;
    this.logger = options.logger;
    this.utcOffsetMinutes = Math.round(options.utcOffsetHours * 60);
    this.driver = options.driver ?? cronerDriver;
    for (const spec of options.jobs) {
      if (this.jobs.has(spec.id)) throw new Error(`duplicate job id: ${spec.id}`);
      this.jobs.set(spec.id, {
        spec,
        handle: null,
        running: false,
        runs: 0,
        failures: 0,
        skipped: 0,
      });
    }
  }

  get jobIds(): string[] {
    return [...this.jobs.keys()];
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({
      id: j.spec.id,
      cron: j.spec.cron,
      running: j.running,
      runs: j.runs,
      failures: j.failures,
      skipped: j.skipped,
    }));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const state of this.jobs.values()) {
      state.handle = this.driver.schedule(
        state.spec.cron,
        { utcOffsetMinutes: this.utcOffsetMinutes },
        () => void this.fire(state),
      );
    }
    this.logger.info({ jobs: this.jobs.size }, 'scheduler started');
  }

  /** Cancel every schedule. A run already in flight finishes; see `drain()`. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const state of this.jobs.values()) {
      state.handle?.stop();
      state.handle = null;
    }
    this.logger.info('scheduler stopped');
  }

  /** Resolves when every run in flight has settled. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Run one job now, as its schedule would. Returns false when it was skipped (overlap). */
  runNow(id: string): Promise<boolean> {
    const state = this.jobs.get(id);
    if (!state) return Promise.reject(new Error(`unknown job: ${id}`));
    return this.fire(state);
  }

  private fire(state: JobState): Promise<boolean> {
    if (state.running) {
      state.skipped += 1;
      this.logger.warn({ job: state.spec.id }, 'job still running, tick skipped');
      return Promise.resolve(false);
    }
    state.running = true;
    const run = (async (): Promise<boolean> => {
      try {
        await state.spec.run(this.clock.now());
      } catch (error) {
        state.failures += 1;
        this.logger.error({ err: error, job: state.spec.id }, 'job failed');
      } finally {
        state.runs += 1;
        state.running = false;
      }
      return true;
    })();
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.add(tracked);
    void tracked.then(() => this.inFlight.delete(tracked));
    return run;
  }
}
