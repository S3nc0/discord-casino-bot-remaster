import { createSeededRng, manualClock } from '@casino/shared';
import { sortStandings, type WeeklyRow } from '@casino/domain/progression';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { GUILD, memoryStore } from '../../runtime/test-kit.ts';
import { createMemoryTeiai } from './ports.ts';
import { createNonCasinoGames } from './register.ts';

/** Monday 2025-01-06 07:30 JST. */
const MONDAY_0730 = 1_736_116_200_000;
const WEEK = '2025-01-06';

function harness() {
  const store = memoryStore();
  const clock = manualClock(MONDAY_0730);
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock });
  const games = createNonCasinoGames({
    store,
    economy,
    bus: new EventBus(),
    clock,
    rng: createSeededRng(3),
    teiai: createMemoryTeiai(),
    offsetHours: 9,
  });
  // Rows every SELECT ... .all() hands back to JavaScript.
  let loaded = 0;
  const stmt = store.stmt.bind(store);
  store.stmt = (sql: string) => {
    const statement = stmt(sql);
    return new Proxy(statement, {
      get(target, prop) {
        if (prop === 'all') {
          return (...args: unknown[]) => {
            const rows = (target.all as (...a: unknown[]) => unknown[])(...args);
            loaded += rows.length;
            return rows;
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    });
  };
  const rng = createSeededRng(11);
  // ids of 17 to 19 digits, so numeric and text order differ
  const users = Array.from(
    { length: 60 },
    (_, i) => `${i % 3 === 0 ? '9' : '1'}${String(i).padStart(16 + (i % 3), '0')}`,
  );
  for (const u of users) economy.ensureMember(GUILD, u);
  return { store, games, users, rng, loaded: () => loaded, reset: () => (loaded = 0) };
}

describe('rankings', () => {
  it('R-15: weekly standings and rank come from SQL in the same order, top N only', () => {
    const h = harness();
    const rows: WeeklyRow[] = h.users.map((userId) => ({
      userId,
      net: h.rng.int(-3, 4) * 100,
      plays: h.rng.int(0, 4),
    }));
    const insert = h.store.db.prepare(
      'INSERT INTO weekly_stats (guild_id, week, user_id, net, plays) VALUES (?, ?, ?, ?, ?)',
    );
    for (const r of rows) insert.run(GUILD, WEEK, r.userId, r.net, r.plays);
    const sorted = sortStandings(rows);

    h.reset();
    expect(h.games.progression.weeklyStandings(GUILD, WEEK, 10)).toEqual(sorted.slice(0, 10));
    for (const [i, r] of sorted.entries()) {
      expect(h.games.progression.weeklyRankOf(GUILD, r.userId, WEEK)).toEqual({
        rank: i + 1,
        net: r.net,
        plays: r.plays,
        total: rows.length,
      });
    }
    expect(h.games.progression.weeklyRankOf(GUILD, '123456789012345678', WEEK)).toBeNull();
    expect(h.loaded()).toBe(10);
  });

  it('R-15: labor ranking comes from SQL in the same order, top N plus the caller', () => {
    const h = harness();
    const update = h.store.db.prepare(
      'INSERT INTO work_state (guild_id, user_id, clicks, day, day_earned, earned_total) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const rows = h.users.map((userId, i) => ({
      userId,
      clicks: i % 7 === 0 ? 0 : h.rng.int(1, 4),
      day: i % 2 === 0 ? WEEK : '2025-01-05',
      dayEarned: h.rng.int(0, 3) * 50,
      total: h.rng.int(0, 4) * 100,
    }));
    for (const r of rows) update.run(GUILD, r.userId, r.clicks, r.day, r.dayEarned, r.total);
    for (const period of ['total', 'today'] as const) {
      const all = rows
        .filter((r) => r.clicks > 0)
        .map((r) => ({
          userId: r.userId,
          clicks: r.clicks,
          earned: period === 'today' ? (r.day === WEEK ? r.dayEarned : 0) : r.total,
        }))
        .filter((r) => r.earned > 0)
        .sort(
          (a, b) => b.earned - a.earned || a.clicks - b.clicks || (a.userId < b.userId ? -1 : 1),
        );
      for (const user of [...h.users, '123456789012345678']) {
        h.reset();
        const index = all.findIndex((r) => r.userId === user);
        expect(h.games.work.ranking(GUILD, user, period, 10), `${period} ${user}`).toEqual({
          rows: all.slice(0, 10),
          self: index < 0 ? null : { ...all[index], rank: index + 1 },
          total: all.length,
        });
        expect(h.loaded()).toBeLessThanOrEqual(10);
      }
    }
  });
});
