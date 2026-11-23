import { createSeededRng, manualClock } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { GUILD, OTHER_GUILD, USER, memoryStore } from '../../runtime/test-kit.ts';
import { GameRuleError } from '../progression/context.ts';
import { createMemoryTeiai } from '../progression/ports.ts';
import { createNonCasinoGames } from '../progression/register.ts';

const H = 3_600_000;

describe('arena', () => {
  it('R-14: board and bets of a tournament are only read for its own guild', () => {
    const store = memoryStore();
    const clock = manualClock(1_736_121_600_000 - 9 * H + 60_000); // 2025-01-06 00:01 JST
    const identity = new IdentityRepo(store, () => clock.now());
    const economy = new EconomyService({ store, identity, clock });
    const teiai = createMemoryTeiai();
    const games = createNonCasinoGames({
      store,
      economy,
      bus: new EventBus(),
      clock,
      rng: createSeededRng(5),
      teiai,
      offsetHours: 9,
    });
    identity.ensureGuild(OTHER_GUILD, 'approved');
    economy.ensureMember(OTHER_GUILD, USER);
    teiai.setBank(OTHER_GUILD, 100_000);
    const [theirs] = games.arena.ensureToday(OTHER_GUILD) as [number];
    const board = games.arena.board(OTHER_GUILD, theirs);
    games.arena.bet({
      guildId: OTHER_GUILD,
      userId: USER,
      tournamentId: theirs,
      fighterId: board.fighters[0]!.id,
      amount: 1000,
      idempotencyKey: 'arena-bet-1',
    });
    expect(games.arena.betsOf(OTHER_GUILD, theirs, USER)).toHaveLength(1);

    expect(() => games.arena.board(GUILD, theirs)).toThrow(GameRuleError);
    expect(games.arena.betsOf(GUILD, theirs, USER)).toEqual([]);
  });
});
