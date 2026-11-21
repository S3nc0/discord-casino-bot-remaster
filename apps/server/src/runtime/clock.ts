import type { Clock } from '@casino/shared';

/** Production clock. Domain code receives it through DomainContext, never imports it. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
