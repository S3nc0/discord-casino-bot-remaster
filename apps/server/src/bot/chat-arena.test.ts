import { afterEach, describe, expect, it } from 'vitest';
import {
  GUILD,
  USER,
  allText,
  command,
  createTestServer,
  embedOf,
  makeHandler,
} from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  return { s: server, handler: makeHandler(server) };
}

const show = (format: 'duel' | 'royale', locale?: 'ja') =>
  command({
    name: 'arena',
    sub: 'tournament',
    strings: { format },
    ...(locale ? { locale } : {}),
  });

describe('/arena tournament result', () => {
  it('lists the fighters while the tournament is open, with no result lines', async () => {
    const { handler } = setup();
    const open = show('duel');
    await handler(open.interaction as never);
    const text = allText(open.out[0]!.options);
    expect(text).toContain('semi_betting');
    expect(text).not.toContain('Champion');
    expect(text).not.toContain('Runner-up');
  });

  it('names the champion and the runner-up once the final is settled', async () => {
    const { s, handler } = setup();
    s.games.arena.ensureToday(GUILD);
    s.games.arena.advanceNow(GUILD, 'duel');
    s.games.arena.advanceNow(GUILD, 'duel');
    const row = s.store
      .stmt(
        `SELECT champion_id AS c, runner_up_id AS r FROM arena_tournaments WHERE format = 'duel'`,
      )
      .get() as { c: number; r: number };
    const nameOf = (id: number) =>
      (s.store.stmt('SELECT name FROM arena_fighters WHERE id = ?').get(id) as { name: string })
        .name;

    const en = show('duel');
    await handler(en.interaction as never);
    const text = allText(en.out[0]!.options);
    expect(text).toContain(`👑 Champion: **${nameOf(row.c)}**`);
    expect(text).toContain(`🥈 Runner-up: **${nameOf(row.r)}**`);
    expect(row.c).not.toBe(row.r);

    const ja = show('duel', 'ja');
    await handler(ja.interaction as never);
    const jaText = allText(ja.out[0]!.options);
    expect(jaText).toContain(`👑 優勝: **${nameOf(row.c)}**`);
    expect(jaText).toContain(`🥈 準優勝: **${nameOf(row.r)}**`);
    expect(embedOf(ja.out[0]!.options).title).toBeDefined();
  });

  it('shows only the champion for a tournament finished before the runner-up was stored', async () => {
    const { s, handler } = setup();
    s.games.arena.ensureToday(GUILD);
    s.games.arena.advanceNow(GUILD, 'duel');
    s.games.arena.advanceNow(GUILD, 'duel');
    s.store.stmt(`UPDATE arena_tournaments SET runner_up_id = NULL WHERE format = 'duel'`).run();
    const view = show('duel');
    await handler(view.interaction as never);
    const text = allText(view.out[0]!.options);
    expect(text).toContain('Champion');
    expect(text).not.toContain('Runner-up');
  });
});
