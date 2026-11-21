import { randomInt } from 'node:crypto';
import { assertRange, type Rng } from '@casino/shared';

/** Production RNG: every game outcome on the server comes from here. */
export const cryptoRng: Rng = {
  int(min, max) {
    assertRange(min, max);
    return randomInt(min, max);
  },
  float() {
    // 53 random bits, the full precision of a double.
    return (randomInt(0, 2 ** 26) * 2 ** 27 + randomInt(0, 2 ** 27)) / 2 ** 53;
  },
};
