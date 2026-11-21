// Helpers for the casino tests. Not imported by production code.
import { createSeededRng, manualClock, type DomainEvent, type Rng } from '@casino/shared';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { createLogger } from '../../runtime/logger.ts';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  START_MS,
  USER,
  memoryStore,
} from '../../runtime/test-kit.ts';
import { createCasinoGames, type CasinoDeps, type CasinoGames } from '../index.ts';
import type { Caller, Scheduler } from './types.ts';

export { GUILD, INSTANCE, OTHER_USER, USER };

/** Hand-driven timers: `advance(ms)` moves the clock and fires what came due, in order. */
export function manualScheduler(clock: { now(): number; advance(ms: number): void }) {
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const scheduler: Scheduler = {
    after(ms, fn) {
      const timer = { at: clock.now() + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  return {
    scheduler,
    pending: () => timers.filter((t) => t.live).length,
    advance(ms: number) {
      const end = clock.now() + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.live = false;
        if (next.at > clock.now()) clock.advance(next.at - clock.now());
        next.fn();
      }
      if (end > clock.now()) clock.advance(end - clock.now());
    },
  };
}

/** An Rng that plays back scripted draws first, then falls back to a seeded stream. */
export function scriptedRng(script: { ints?: number[]; floats?: number[] }, seed = 1): Rng {
  const ints = [...(script.ints ?? [])];
  const floats = [...(script.floats ?? [])];
  const fallback = createSeededRng(seed);
  return {
    int(min, max) {
      const next = ints.shift();
      if (next === undefined) return fallback.int(min, max);
      if (next < min || next >= max) throw new Error(`scripted ${next} outside [${min}, ${max})`);
      return next;
    },
    float() {
      return floats.shift() ?? fallback.float();
    },
  };
}

export function setup(options: { rng?: Rng; ports?: CasinoDeps['ports'] } = {}) {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const bus = new EventBus();
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const timers = manualScheduler(clock);
  const events: DomainEvent[] = [];
  bus.onAnyDomain((e) => events.push(e));
  const snapshots: { instanceId: string; game: string; phase: string; seq: number }[] = [];
  const games: CasinoGames = createCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng: options.rng ?? createSeededRng(7),
    logger: createLogger({ level: 'silent' }),
    scheduler: timers.scheduler,
    ...(options.ports === undefined ? {} : { ports: options.ports }),
  });
  // A fake socket server that records what reaches the table room.
  games.attach({
    to: (room: string) => ({
      emit: (
        _event: string,
        snapshot: { instanceId: string; game: string; phase: string; seq: number },
      ) => {
        snapshots.push({ ...snapshot, instanceId: room });
      },
    }),
  } as never);
  economy.ensureMember(GUILD, USER);
  economy.ensureMember(GUILD, OTHER_USER);
  const caller = (userId = USER, instanceId: string | undefined = undefined): Caller => ({
    guildId: GUILD,
    userId,
    source: instanceId === undefined ? 'chat' : 'activity',
    ...(instanceId === undefined ? {} : { instanceId }),
  });
  return { store, clock, bus, economy, games, timers, events, snapshots, caller };
}

export const eventsOf = <T extends DomainEvent['type']>(events: DomainEvent[], type: T) =>
  events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
