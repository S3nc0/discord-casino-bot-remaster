/** Injected time source. Domain code never reads the system clock directly. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** A clock that only moves when told to. For tests and replays. */
export interface ManualClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

export function manualClock(startMs: number): ManualClock {
  let current = startMs;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
