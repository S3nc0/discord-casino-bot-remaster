import { describe, expect, it } from 'vitest';
import { manualClock } from '@casino/shared';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { GUILD, START_MS, USER, memoryStore } from '../../runtime/test-kit.ts';
import { Inventory } from './inventory.ts';

describe('Inventory', () => {
  it('R-17: take refuses a quantity that is not a positive integer and changes nothing', () => {
    const store = memoryStore();
    const clock = manualClock(START_MS);
    const identity = new IdentityRepo(store, () => clock.now());
    new EconomyService({ store, identity, clock }).ensureMember(GUILD, USER);
    const inventory = new Inventory(store);
    inventory.add(GUILD, USER, 'carrot', 2);
    for (const qty of [-5, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => inventory.take(GUILD, USER, 'carrot', qty), String(qty)).toThrow(
        /invalid_payload/,
      );
    }
    expect(inventory.qty(GUILD, USER, 'carrot')).toBe(2);
    expect(inventory.take(GUILD, USER, 'carrot', 3)).toBe(false);
    expect(inventory.take(GUILD, USER, 'carrot', 2)).toBe(true);
    expect(inventory.qty(GUILD, USER, 'carrot')).toBe(0);
  });
});
