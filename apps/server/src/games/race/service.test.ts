import { createSeededRng, manualClock } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { GUILD, OTHER_GUILD, USER, memoryStore } from '../../runtime/test-kit.ts';
import { createMemoryTeiai } from '../progression/ports.ts';
import { createNonCasinoGames } from '../progression/register.ts';

/** Monday 2025-01-06 07:30 JST (entries of the 09:00 race are open). */
const MONDAY_0730 = 1_736_116_200_000;

function harness() {
  const store = memoryStore();
  const clock = manualClock(MONDAY_0730);
  const bus = new EventBus((e) => {
    throw e;
  });
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const games = createNonCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng: createSeededRng(7),
    teiai: createMemoryTeiai(),
    offsetHours: 9,
  });
  const horseIn = (guildId: string) => {
    identity.ensureGuild(guildId, 'approved');
    economy.ensureMember(guildId, USER);
    games.shop.inventory.add(guildId, USER, 'horse_voucher', 1);
    const horse = games.race.createHorse(guildId, USER, { name: '馬', coat: '鹿毛', silks: '🟥' });
    const [raceId] = games.race.ensureDay(guildId) as [number];
    return { horseId: horse.id, raceId };
  };
  const fees = (guildId: string) =>
    economy
      .history(guildId, USER, 100)
      .filter((e) => e.reason === 'race_entry_fee' || e.reason === 'race_refund')
      .map((e) => e.delta)
      .reverse();
  return { store, economy, games, horseIn, fees };
}

describe('race entries', () => {
  it('R-2: entering again after a withdraw charges the entry fee again', () => {
    const { economy, games, horseIn, fees } = harness();
    const { horseId, raceId } = horseIn(GUILD);
    games.race.register(GUILD, USER, raceId, horseId);
    expect(economy.getBalance(GUILD, USER)).toBe(2000);
    games.race.withdraw(GUILD, USER, raceId, horseId);
    expect(economy.getBalance(GUILD, USER)).toBe(3000);

    games.race.register(GUILD, USER, raceId, horseId);
    expect(economy.getBalance(GUILD, USER)).toBe(2000);
    games.race.withdraw(GUILD, USER, raceId, horseId);
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(fees(GUILD)).toEqual([-1000, 1000, -1000, 1000]);
  });

  it('R-14: withdraw refuses a race of another guild and refunds nothing', () => {
    const { store, economy, games, horseIn } = harness();
    horseIn(GUILD);
    const other = horseIn(OTHER_GUILD);
    games.race.register(OTHER_GUILD, USER, other.raceId, other.horseId);

    expect(() => games.race.withdraw(GUILD, USER, other.raceId, other.horseId)).toThrow(
      /entry_closed/,
    );
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(economy.getBalance(OTHER_GUILD, USER)).toBe(2000);
    expect(
      store
        .stmt('SELECT COUNT(*) AS n FROM horse_entries WHERE race_id = ? AND horse_id = ?')
        .get(other.raceId, other.horseId),
    ).toEqual({ n: 1 });
  });
});
