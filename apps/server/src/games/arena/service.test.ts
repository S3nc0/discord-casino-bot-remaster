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

function setup(seed: number) {
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
    rng: createSeededRng(seed),
    teiai,
    offsetHours: 9,
  });
  identity.ensureGuild(GUILD, 'approved');
  teiai.setBank(GUILD, 100_000);
  return { store, clock, games };
}

describe('arena runner-up', () => {
  it('is empty while open and stored with the champion once the final settles', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { store, clock, games } = setup(seed);
      const ids = games.arena.ensureToday(GUILD);
      expect(ids).toHaveLength(2);
      const row = (id: number) =>
        store.stmt('SELECT * FROM arena_tournaments WHERE id = ?').get(id) as {
          status: string;
          champion_id: number | null;
          runner_up_id: number | null;
        };
      expect(ids.map((id) => row(id).runner_up_id)).toEqual([null, null]);

      clock.set(clock.now() + 9 * H);
      const semi = games.arena.advance(GUILD);
      expect(semi.every((r) => r.stage === 'semi' && r.runnerUpId === undefined)).toBe(true);
      expect(ids.map((id) => row(id).runner_up_id)).toEqual([null, null]);

      clock.set(clock.now() + 4 * H);
      const reports = games.arena.advance(GUILD);
      expect(reports).toHaveLength(2);
      for (const report of reports) {
        const t = row(report.tournamentId);
        expect(t.status).toBe('done');
        expect(t.champion_id).toBe(report.winnerIds[0]);
        expect(t.runner_up_id).toBe(report.runnerUpId);
        expect(t.runner_up_id).not.toBeNull();
        expect(t.runner_up_id).not.toBe(t.champion_id);
        // Both come from the final: the royale final has four fighters, the duel's two.
        const finalists = games.arena
          .fighters(report.tournamentId)
          .filter((f) => f.result !== null)
          .map((f) => f.id);
        expect(finalists).toContain(t.runner_up_id);
        expect(finalists).toContain(t.champion_id);
      }
    }
  });

  it('is the other finalist of a duel and a different finalist of a royale', () => {
    const { store, clock, games } = setup(11);
    const [duel, royale] = games.arena.ensureToday(GUILD) as [number, number];
    clock.set(clock.now() + 9 * H);
    games.arena.advance(GUILD);
    const duelFinal = games.arena.fighters(duel).filter((f) => f.stage === 'final');
    const royaleFinal = games.arena.fighters(royale).filter((f) => f.stage === 'final');
    expect(duelFinal).toHaveLength(2);
    expect(royaleFinal).toHaveLength(4);
    clock.set(clock.now() + 4 * H);
    games.arena.advance(GUILD);
    const second = (id: number) =>
      (
        store.stmt('SELECT runner_up_id AS r FROM arena_tournaments WHERE id = ?').get(id) as {
          r: number;
        }
      ).r;
    const championOf = (id: number) =>
      games.arena.fighters(id).find((f) => f.result === 'won' && f.stage === 'out')!.id;
    expect(second(duel)).toBe(duelFinal.find((f) => f.id !== championOf(duel))!.id);
    const royaleSecond = second(royale);
    expect(royaleFinal.map((f) => f.id)).toContain(royaleSecond);
    expect(royaleSecond).not.toBe(championOf(royale));
  });

  it('owner "advance" settles the final with a runner-up too', () => {
    const { store, games } = setup(3);
    const [duel] = games.arena.ensureToday(GUILD) as [number];
    games.arena.advanceNow(GUILD, 'duel');
    const reports = games.arena.advanceNow(GUILD, 'duel');
    expect(reports[0]?.runnerUpId).toBeDefined();
    expect(
      (
        store.stmt('SELECT runner_up_id AS r FROM arena_tournaments WHERE id = ?').get(duel) as {
          r: number | null;
        }
      ).r,
    ).toBe(reports[0]?.runnerUpId);
  });
});

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
