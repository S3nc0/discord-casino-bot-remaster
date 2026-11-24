import { describe, expect, it } from 'vitest';
import { audienceOf } from './domain-audience.ts';

describe('domain event audience', () => {
  it('shows the Teiai relic listing to the whole guild', () => {
    expect(
      audienceOf({
        type: 'TeiaiRelicListed',
        guildId: '234567890123456789',
        at: 1,
        listingId: 1,
        itemId: 'relic_fossil',
        startPrice: 1500,
        endAt: 2,
      }),
    ).toEqual({ scope: 'guild' });
  });
});
