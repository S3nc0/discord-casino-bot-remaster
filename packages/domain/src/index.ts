import type { Clock, DomainEvent, Rng } from '@casino/shared';

/**
 * Everything a domain function may use besides its own inputs. Passed in by the caller
 * (the server in production, a seeded RNG and manual clock in tests).
 */
export interface DomainContext {
  readonly rng: Rng;
  readonly clock: Clock;
}

/**
 * What a domain function returns: the next state and the events it implies.
 * The server persists `state` and publishes `events` after the transaction commits.
 */
export interface Outcome<S> {
  readonly state: S;
  readonly events: readonly DomainEvent[];
}

/** Game modules live in sibling folders (casino/, race/, finance/, ...) added by their owners. */
export type { Clock, Rng } from '@casino/shared';
