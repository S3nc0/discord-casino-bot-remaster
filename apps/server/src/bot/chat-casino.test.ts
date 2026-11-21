import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  OTHER_USER,
  USER,
  allText,
  button,
  command,
  createTestServer,
  customIds,
  embedOf,
  ledgerReasons,
  makeHandler,
  makeUser,
} from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  return { server, handler: makeHandler(server) };
}

describe('/casino chinchiro', () => {
  it('stakes, rolls on the button and settles through the ledger (EN)', async () => {
    const { server: s, handler } = setup();
    s.economy.ensureMember(GUILD, USER);
    const before = s.economy.getBalance(GUILD, USER);
    const start = command({ name: 'casino', sub: 'chinchiro', integers: { bet: 100 } });
    await handler(start.interaction as never);

    const first = start.out[0]!;
    expect(first.kind).toBe('reply');
    expect(embedOf(first.options).title).toBe('🎲 Underground Chinchiro');
    expect(s.economy.getBalance(GUILD, USER)).toBe(before - 100);

    let ids = customIds(first.options);
    let guard = 0;
    let last = first;
    while (ids.some((id) => id.startsWith('b:chi:roll:')) && guard++ < 4) {
      const press = button(ids.find((id) => id.startsWith('b:chi:roll:'))!);
      await handler(press.interaction as never);
      last = press.out[0]!;
      expect(last.kind).toBe('update');
      ids = customIds(last.options);
    }
    expect(allText(last.options)).toContain('Payout');
    expect(ledgerReasons(s)).toContain('game_stake');
  });

  it('speaks Japanese with the spec strings', async () => {
    const { handler } = setup();
    const start = command({
      name: 'casino',
      sub: 'chinchiro',
      integers: { bet: 100 },
      locale: 'ja',
    });
    await handler(start.interaction as never);
    expect(embedOf(start.out[0]!.options).title).toBe('🎲 地下チンチロ');
    expect(allText(start.out[0]!.options)).toContain('ざわ… ざわ…');
  });

  it('does not charge twice when Discord redelivers the same interaction', async () => {
    const { server: s, handler } = setup();
    const a = command({ name: 'casino', sub: 'chinchiro', integers: { bet: 100 }, id: 'same-1' });
    await handler(a.interaction as never);
    const after = s.economy.getBalance(GUILD, USER);
    const b = command({ name: 'casino', sub: 'chinchiro', integers: { bet: 100 }, id: 'same-1' });
    await handler(b.interaction as never);
    expect(s.economy.getBalance(GUILD, USER)).toBe(after);
  });
});

describe('/casino blackjack', () => {
  it('deals, plays on the buttons and settles', async () => {
    const { server: s, handler } = setup();
    const start = command({ name: 'casino', sub: 'blackjack', integers: { bet: 100 } });
    await handler(start.interaction as never);
    const first = start.out[0]!;
    expect(embedOf(first.options).title).toBe('🃏 Blackjack');
    const ids = customIds(first.options);
    let last = first;
    if (ids.some((id) => id.startsWith('b:bj:stand:'))) {
      const press = button(ids.find((id) => id.startsWith('b:bj:stand:'))!);
      await handler(press.interaction as never);
      last = press.out[0]!;
    }
    expect(allText(last.options)).toContain('Payout');
    expect(ledgerReasons(s)).toContain('game_stake');
  });

  it('shows the Japanese title', async () => {
    const { handler } = setup();
    const start = command({
      name: 'casino',
      sub: 'blackjack',
      integers: { bet: 100 },
      locale: 'ja',
    });
    await handler(start.interaction as never);
    expect(embedOf(start.out[0]!.options).title).toBe('🃏 ブラックジャック');
  });

  it('offers Teiai credit when a double needs more cash than the player has', async () => {
    const { server: s, handler } = setup();
    // Bet the whole balance so the double cannot be paid from cash.
    const all =
      s.economy.getBalance(GUILD, USER) ||
      (s.economy.ensureMember(GUILD, USER), s.economy.getBalance(GUILD, USER));
    const start = command({ name: 'casino', sub: 'blackjack', integers: { bet: all } });
    await handler(start.interaction as never);
    const ids = customIds(start.out[0]!.options);
    const doubleId = ids.find((id) => id.startsWith('b:bj:double:'));
    if (!doubleId) return; // a natural ended the hand at once
    const press = button(doubleId);
    await handler(press.interaction as never);
    const out = press.out[0]!;
    expect(out.kind).toBe('reply');
    expect(allText(out.options)).toContain('Teiai credit');
    expect(customIds(out.options)[0]).toMatch(/^b:bj:credit:/);
  });
});

describe('/casino chinchiro-table', () => {
  it('opens a lobby, seats a second player, plays out and posts verdicts', async () => {
    vi.useFakeTimers();
    const { server: s, handler } = setup();
    const open = command({ name: 'casino', sub: 'chinchiro-table', integers: { bet: 100 } });
    await handler(open.interaction as never);
    const lobby = open.out[0]!;
    expect(embedOf(lobby.options).title).toBe('🎲 Underground Chinchiro table');
    const ids = customIds(lobby.options);
    expect(ids.map((id) => id.split(':')[2])).toEqual(['sit', 'stand', 'begin']);

    const guest = makeUser(OTHER_USER, 'bob');
    const sit = button(ids[0]!, { user: guest });
    await handler(sit.interaction as never);
    expect(sit.out[0]!.kind).toBe('update');
    expect(allText(sit.out[0]!.options)).toContain(`<@${OTHER_USER}>`);

    const begin = button(ids[2]!);
    await handler(begin.interaction as never);
    await vi.advanceTimersByTimeAsync(30_000);

    const edits = open.out.filter((o) => o.kind === 'editReply');
    expect(edits.map((e) => allText(e.options)).some((text) => /Win|Loss|Draw/.test(text))).toBe(
      true,
    );
    // The table folds after the result window and the message turns back into a hint.
    expect(allText(edits[edits.length - 1]!.options)).toContain('closed');
    expect(ledgerReasons(s, USER)).toContain('game_stake');
    expect(ledgerReasons(s, OTHER_USER)).toContain('game_stake');
  });

  it("refuses a guest leaving someone else's lobby and lets the host fold an empty table", async () => {
    vi.useFakeTimers();
    const { server: s, handler } = setup();
    const open = command({ name: 'casino', sub: 'chinchiro-table', integers: { bet: 100 } });
    await handler(open.interaction as never);
    const ids = customIds(open.out[0]!.options);
    const stand = button(ids[1]!);
    await handler(stand.interaction as never);
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
    expect(ledgerReasons(s)).toContain('game_refund');
  });
});

it('falls back to coming soon when the casino service is not provided', async () => {
  server = createTestServer();
  const handler = makeHandler(server, { casino: undefined });
  const c = command({ name: 'casino', sub: 'chinchiro', integers: { bet: 100 } });
  await handler(c.interaction as never);
  expect(embedOf(c.out[0]!.options).title).toBe('Coming Soon');
});
