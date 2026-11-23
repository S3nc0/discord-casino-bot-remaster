import { afterEach, describe, expect, it } from 'vitest';
import {
  GUILD,
  OTHER_USER,
  USER,
  allText,
  autocomplete,
  button,
  command,
  createTestServer,
  customIds,
  embedOf,
  fakeChannel,
  fakeClient,
  ledgerReasons,
  makeHandler,
  makeUser,
  modalSubmit,
} from './chat-test-kit.ts';
import { pendingFormCount, setAdminFetch } from './admin-tools.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.economy.ensureMember(GUILD, OTHER_USER);
  return { s: server, handler: makeHandler(server) };
}

/** An owner command in a DM with the bot. */
function admin(group: string | undefined, sub: string, spec: Record<string, unknown> = {}) {
  return command({
    name: 'admin',
    ...(group === undefined ? {} : { group }),
    sub,
    guildId: null,
    channelId: null,
    ...spec,
  });
}

describe('owner gate', () => {
  it('refuses non-owners for every admin tool', async () => {
    const { handler } = setup();
    for (const [group, sub] of [
      [undefined, 'grant'],
      [undefined, 'server-list'],
      ['rtp', 'list'],
    ] as const) {
      const c = admin(group, sub, { user: makeUser(OTHER_USER, 'bob') });
      await handler(c.interaction as never);
      expect(allText(c.out[0]!.options).trim()).toBe('Only bot owners can use this command.');
    }
  });
});

describe('money tools', () => {
  it('grants Pelica through the ledger and refuses non-members', async () => {
    const { s, handler } = setup();
    const before = s.economy.getBalance(GUILD, OTHER_USER);
    const grant = admin(undefined, 'grant', {
      strings: { guild_id: GUILD, user_id: `<@${OTHER_USER}>`, reason: 'contest' },
      integers: { amount: 1234 },
    });
    await handler(grant.interaction as never);
    expect(embedOf(grant.out[0]!.options).title).toBe('Granted');
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(before + 1234);
    expect(ledgerReasons(s, OTHER_USER)).toContain('admin_grant');
    const row = s.store
      .stmt(
        "SELECT meta FROM ledger WHERE reason = 'admin_grant' AND user_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(OTHER_USER) as { meta: string };
    expect(JSON.parse(row.meta)).toMatchObject({ note: '付与（管理）contest' });

    const stranger = admin(undefined, 'grant', {
      strings: { guild_id: GUILD, user_id: '777000111' },
      integers: { amount: 10 },
      locale: 'ja',
    });
    await handler(stranger.interaction as never);
    expect(embedOf(stranger.out[0]!.options).title).toBe('そのサーバーにいません');
  });

  it('sets a balance only after the confirm button, and a negative target becomes debt', async () => {
    const { s, handler } = setup();
    const set = admin(undefined, 'set-balance', {
      strings: { guild_id: GUILD, user_id: OTHER_USER },
      integers: { amount: 10_000 },
    });
    await handler(set.interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3000);
    const [ok] = customIds(set.out[0]!.options);

    const wrong = button(ok!, { user: makeUser(OTHER_USER, 'bob') });
    await handler(wrong.interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3000);

    const confirm = button(ok!);
    await handler(confirm.interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(10_000);
    expect(embedOf(confirm.out[0]!.options).title).toBe('Balance set');

    const debt = admin(undefined, 'set-balance', {
      strings: { guild_id: GUILD, user_id: OTHER_USER },
      integers: { amount: -5000 },
    });
    await handler(debt.interaction as never);
    const cancel = button(customIds(debt.out[0]!.options)[1]!);
    await handler(cancel.interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(10_000);

    const debt2 = admin(undefined, 'set-balance', {
      strings: { guild_id: GUILD, user_id: OTHER_USER },
      integers: { amount: -5000 },
    });
    await handler(debt2.interaction as never);
    await handler(button(customIds(debt2.out[0]!.options)[0]!).interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(0);
    expect(s.finance.teiai.getDebt(GUILD, OTHER_USER)).toBe(5000);
    expect(ledgerReasons(s, OTHER_USER)).toContain('admin_revoke');
  });
});

describe('casino controls', () => {
  it('starts and stops a manual event that changes the casino boost', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9001');
    const client = fakeClient([channel]);
    const start = admin('event', 'start', {
      strings: { game: 'slots', guild_id: GUILD, channel_id: '9001' },
      integers: { minutes: 10, boost: 100 },
      client,
    });
    await handler(start.interaction as never);
    expect(embedOf(start.out[0]!.options).title).toBe('Event started');
    expect(channel.sent).toHaveLength(1);
    const now = s.clock.now();
    expect(s.casino.core.ports.eventBoost(GUILD, 'slots', now)).toBe(1);
    expect(s.casino.core.ports.eventBoost(GUILD, 'roulette', now)).toBe(0);

    const stop = admin('event', 'stop', { strings: { guild_id: GUILD } });
    await handler(stop.interaction as never);
    expect(embedOf(stop.out[0]!.options).title).toBe('Event stopped');
    expect(s.casino.core.ports.eventBoost(GUILD, 'slots', now)).toBe(0);
    const again = admin('event', 'stop', { strings: { guild_id: GUILD }, locale: 'ja' });
    await handler(again.interaction as never);
    expect(embedOf(again.out[0]!.options).title).toBe('開催中の特別イベントはありません。');
  });

  it('sets and lists payout levels', async () => {
    const { s, handler } = setup();
    const set = admin('rtp', 'set', {
      strings: { guild_id: GUILD, game: '*' },
      integers: { level: 4 },
    });
    await handler(set.interaction as never);
    expect(embedOf(set.out[0]!.options).title).toBe('Payout level changed');
    expect(s.casino.core.rtpLevel(GUILD, 'blackjack')).toBe(4);
    expect(s.casino.core.rtpLevel(GUILD, 'slots')).toBe(4);
    const list = admin('rtp', 'list', { strings: { guild_id: GUILD }, locale: 'ja' });
    await handler(list.interaction as never);
    expect(allText(list.out[0]!.options)).toContain('4: 甘い');
    const reset = admin('rtp', 'set', {
      strings: { guild_id: GUILD, game: 'slots' },
      integers: { level: 3 },
    });
    await handler(reset.interaction as never);
    expect(s.casino.core.rtpLevel(GUILD, 'slots')).toBe(3);
  });

  it('pauses and resumes a feature; paused features stop new starts', async () => {
    const { s, handler } = setup();
    const off = admin('feature', 'off', { strings: { guild_id: GUILD, feature: 'slot' } });
    await handler(off.interaction as never);
    expect(embedOf(off.out[0]!.options).title).toBe('⏸️ Paused');
    const play = command({ name: 'casino', sub: 'slots', integers: { bet: 100 } });
    await handler(play.interaction as never);
    expect(play.out[0]!.options.flags).toBeDefined();
    expect(allText(play.out[0]!.options)).not.toContain('Payout');

    const list = admin('feature', 'list', { strings: { guild_id: GUILD } });
    await handler(list.interaction as never);
    expect(allText(list.out[0]!.options)).toContain('⏸️ Slots');

    const on = admin('feature', 'on', { strings: { guild_id: GUILD, feature: '*' } });
    await handler(on.interaction as never);
    expect(s.store.stmt('SELECT COUNT(*) AS n FROM guild_features_off').get()).toEqual({ n: 0 });
    const play2 = command({ name: 'casino', sub: 'slots', integers: { bet: 100 }, id: 'again' });
    await handler(play2.interaction as never);
    expect(allText(play2.out[0]!.options)).toContain('Payout');
  });

  it('reports pachinko statistics against the designed rates', async () => {
    const { s, handler } = setup();
    for (let i = 0; i < 3; i++) {
      s.clock.advance(2000);
      s.casino.pachinko.play(
        { guildId: GUILD, userId: USER, source: 'chat' },
        { stake: 10, sets: 2 },
      );
    }
    const stats = admin(undefined, 'pachinko-stats', {
      strings: { guild_id: GUILD },
      integers: { days: 30 },
    });
    await handler(stats.interaction as never);
    const text = allText(stats.out[0]!.options);
    expect(text).toContain('Start rate');
    expect(text).toContain('7.00%');
    expect(text).toContain('(reference)');
  });

  it('shows hourly labor clicks and flags nothing for ordinary play', async () => {
    const { s, handler } = setup();
    for (let i = 0; i < 4; i++) {
      s.clock.advance(1500);
      s.games.work.click(GUILD, OTHER_USER);
    }
    const hist = admin(undefined, 'click-history', {
      strings: { guild_id: GUILD, user_id: OTHER_USER },
      integers: { hours: 24 },
    });
    await handler(hist.interaction as never);
    const text = allText(hist.out[0]!.options);
    expect(text).toContain('4 clicks');
    expect(text).not.toContain('⚠️ ');
  });
});

describe('hosting', () => {
  it('opens a special race and posts it', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9002');
    const host = admin(undefined, 'host-race', {
      strings: { guild_id: GUILD, channel_id: '9002' },
      integers: { entry_min: 3, bet_min: 4 },
      client: fakeClient([channel]),
    });
    await handler(host.interaction as never);
    expect(embedOf(host.out[0]!.options).title).toMatch(/^Special race #\d+ opened$/);
    const race = s.store.stmt("SELECT kind, status FROM horse_races WHERE kind = 'special'").get();
    expect(race).toEqual({ kind: 'special', status: 'entry' });
    expect(channel.sent).toHaveLength(1);
  });

  it('opens the arena and can resolve the open stage at once', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9003');
    const host = admin(undefined, 'host-arena', {
      strings: { guild_id: GUILD, channel_id: '9003', fmt: 'duel' },
      booleans: { advance: true },
      client: fakeClient([channel]),
    });
    await handler(host.interaction as never);
    expect(embedOf(host.out[0]!.options).title).toMatch(/^Arena: \d+ created, 1 advanced$/);
    expect(
      s.store.stmt("SELECT status FROM arena_tournaments WHERE format = 'duel'").get(),
    ).toEqual({ status: 'final_betting' });
    expect(channel.sent).toHaveLength(1);
  });

  it('runs a raffle: start, join, repost and a confirmed cancel with refunds', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9004');
    const client = fakeClient([channel]);
    const start = admin('raffle', 'start', {
      strings: { guild_id: GUILD, channel_id: '9004' },
      integers: { fee: 500, minutes: 30 },
      client,
    });
    await handler(start.interaction as never);
    const raffle = s.games.lottery.current(GUILD)!;
    expect(raffle.fee).toBe(500);
    expect(channel.sent).toHaveLength(1);

    const join = button(`b:raf:join:${raffle.id}`, { user: makeUser(OTHER_USER, 'bob') });
    await handler(join.interaction as never);
    expect(s.games.lottery.current(GUILD)!.entrants).toContain(OTHER_USER);
    const afterJoin = s.economy.getBalance(GUILD, OTHER_USER);

    const repost = admin('raffle', 'repost', {
      strings: { guild_id: GUILD, channel_id: '9004' },
      client,
    });
    await handler(repost.interaction as never);
    expect(channel.sent).toHaveLength(2);

    const cancel = admin('raffle', 'cancel', { strings: { guild_id: GUILD } });
    await handler(cancel.interaction as never);
    expect(s.games.lottery.current(GUILD)).not.toBeNull();
    await handler(button(customIds(cancel.out[0]!.options)[0]!).interaction as never);
    expect(s.games.lottery.current(GUILD)).toBeNull();
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(afterJoin + 500);
  });
});

describe('announcements and cleanup', () => {
  it('announces through a modal, a preview and the send button', async () => {
    const { handler } = setup();
    const channel = fakeChannel('9005');
    const client = fakeClient([channel]);
    const cmd = admin(undefined, 'announce', {
      id: 'ann-1',
      strings: { guild_id: GUILD, channel_id: '9005', title: 'Maintenance' },
      client,
    });
    await handler(cmd.interaction as never);
    expect(cmd.out[0]!.kind).toBe('modal');

    const submit = modalSubmit(
      'b:admn:announce:ann-1',
      { body: 'Back at noon.' },
      { guildId: null, client },
    );
    await handler(submit.interaction as never);
    expect(allText(submit.out[0]!.options)).toContain('Maintenance');
    expect(allText(submit.out[0]!.options)).toContain('Back at noon.');
    expect(channel.sent).toHaveLength(0);

    const send = button(customIds(submit.out[0]!.options)[0]!, { guildId: null, client });
    await handler(send.interaction as never);
    expect(channel.sent).toHaveLength(1);
    expect(embedOf(send.out[0]!.options).title).toBe('Announcement sent');
  });

  it("deletes only the bot's own messages after confirmation", async () => {
    const { handler } = setup();
    const channel = fakeChannel('9006', ['m1', 'm2', 'm3']);
    const client = fakeClient([channel]);
    const purge = admin(undefined, 'purge-messages', {
      strings: { guild_id: GUILD, channel_id: '9006' },
      client,
    });
    await handler(purge.interaction as never);
    expect(channel.deleted).toHaveLength(0);
    const ok = button(customIds(purge.out[0]!.options)[0]!, { guildId: null, client });
    await handler(ok.interaction as never);
    expect(channel.deleted).toEqual(['m1', 'm2', 'm3']);
    const last = ok.out[ok.out.length - 1]!;
    expect(allText(last.options)).toContain('Deleted: **3**');
  });
});

describe('R-14 / R-15: channels of the right guild, bounded purge', () => {
  it('R-14: never posts or purges in a channel of another guild', async () => {
    const { handler } = setup();
    const foreign = fakeChannel('9101', ['m1'], 'other-guild');
    const client = fakeClient([foreign]);

    const host = admin(undefined, 'host-race', {
      strings: { guild_id: GUILD, channel_id: '9101' },
      integers: { entry_min: 3, bet_min: 4 },
      client,
    });
    await handler(host.interaction as never);
    expect(foreign.sent).toHaveLength(0);

    const purge = admin(undefined, 'purge-messages', {
      strings: { guild_id: GUILD, channel_id: '9101' },
      client,
    });
    await handler(purge.interaction as never);
    expect(customIds(purge.out[0]!.options)).toHaveLength(0);
    expect(foreign.deleted).toHaveLength(0);
  });

  it('R-15: purge uses bulkDelete for recent bot messages and deletes older ones one by one', async () => {
    const { handler } = setup();
    const day = 86_400_000;
    const channel = fakeChannel('9102', [
      'new1',
      'new2',
      { id: 'old1', ageMs: 15 * day },
      { id: 'old2', ageMs: 20 * day },
    ]);
    const client = fakeClient([channel]);
    const purge = admin(undefined, 'purge-messages', {
      strings: { guild_id: GUILD, channel_id: '9102' },
      client,
    });
    await handler(purge.interaction as never);
    await handler(
      button(customIds(purge.out[0]!.options)[0]!, { guildId: null, client }).interaction as never,
    );
    expect(channel.bulkDeleted).toEqual([['new1', 'new2']]);
    expect([...channel.deleted].sort()).toEqual(['new1', 'new2', 'old1', 'old2']);
  });

  it('R-15: purge stops after a bounded number of pages', async () => {
    const { handler } = setup();
    let pages = 0;
    let serial = 0;
    const channel = {
      ...fakeChannel('9103'),
      messages: {
        fetch: async () => {
          pages += 1;
          return new Map(
            Array.from({ length: 100 }, () => {
              serial += 1;
              const id = String(1_000_000 - serial);
              return [
                id,
                {
                  id,
                  author: { id: 'someone-else' },
                  createdTimestamp: 0,
                  delete: async () => undefined,
                },
              ];
            }),
          );
        },
      },
    };
    const client = fakeClient([channel as never]);
    const purge = admin(undefined, 'purge-messages', {
      strings: { guild_id: GUILD, channel_id: '9103' },
      client,
    });
    await handler(purge.interaction as never);
    await handler(
      button(customIds(purge.out[0]!.options)[0]!, { guildId: null, client }).interaction as never,
    );
    expect(pages).toBeLessThanOrEqual(50);
  });
});

describe('R-15: abandoned modal parameters expire', () => {
  it('R-15: an announce modal submitted after its TTL is refused, and abandoned ones are swept', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9201');
    const client = fakeClient([channel]);
    const before = pendingFormCount();
    for (const id of ['abandon-1', 'abandon-2', 'abandon-3']) {
      const cmd = admin(undefined, 'announce', {
        id,
        strings: { guild_id: GUILD, channel_id: '9201', title: 'x' },
        client,
      });
      await handler(cmd.interaction as never);
    }
    expect(pendingFormCount()).toBe(before + 3);

    s.clock.advance(20 * 60_000);
    const late = modalSubmit(
      'b:admn:announce:abandon-1',
      { body: 'Hello' },
      { guildId: null, client },
    );
    await handler(late.interaction as never);
    expect(allText(late.out[0]!.options)).not.toContain('Hello');
    expect(channel.sent).toHaveLength(0);

    const fresh = admin(undefined, 'announce', {
      id: 'fresh-1',
      strings: { guild_id: GUILD, channel_id: '9201', title: 'y' },
      client,
    });
    await handler(fresh.interaction as never);
    expect(pendingFormCount()).toBe(before + 1);
  });
});

describe('server approval', () => {
  it('lists, allows and revokes servers (the config-allowed one cannot be revoked)', async () => {
    const { s, handler } = setup();
    const list = admin(undefined, 'server-list');
    await handler(list.interaction as never);
    expect(allText(list.out[0]!.options)).toContain(GUILD);

    const allow = admin(undefined, 'server-allow', { strings: { guild_id: '555000111' } });
    await handler(allow.interaction as never);
    expect(s.identity.getGuildStatus('555000111')).toBe('approved');

    const bad = admin(undefined, 'server-allow', { strings: { guild_id: 'abc' }, locale: 'ja' });
    await handler(bad.interaction as never);
    expect(embedOf(bad.out[0]!.options).title).toBe('入力エラー');

    const leave = { name: 'Other', leave: async () => undefined };
    const client = fakeClient([], { '555000111': leave });
    const revoke = admin(undefined, 'server-revoke', {
      strings: { guild_id: '555000111' },
      client,
    });
    await handler(revoke.interaction as never);
    expect(s.identity.getGuildStatus('555000111')).toBe('approved');
    await handler(
      button(customIds(revoke.out[0]!.options)[0]!, { guildId: null, client }).interaction as never,
    );
    expect(s.identity.getGuildStatus('555000111')).toBe('denied');

    const pre = admin(undefined, 'server-revoke', { strings: { guild_id: GUILD } });
    await handler(pre.interaction as never);
    expect(embedOf(pre.out[0]!.options).title).toBe("Can't revoke");
  });
});

describe('quiz admin', () => {
  it('adds, lists, bulk-imports and deletes official quizzes', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('9007');
    const client = fakeClient([channel]);
    const add = admin('quiz', 'add', {
      id: 'qa-1',
      integers: { announce: 1 },
      strings: { guild_id: GUILD, channel_id: '9007' },
      client,
    });
    await handler(add.interaction as never);
    expect(add.out[0]!.kind).toBe('modal');
    const submit = modalSubmit(
      'b:admq:add:qa-1',
      {
        question: 'Largest planet?',
        choices: 'Jupiter\nMars\nVenus\nEarth',
        explanation: '',
        reward: '120',
        duration: '',
      },
      { guildId: null, client },
    );
    await handler(submit.interaction as never);
    expect(embedOf(submit.out[0]!.options).title).toMatch(/^Quiz #\d+ added$/);
    expect(channel.sent).toHaveLength(1);

    setAdminFetch(async () =>
      [
        '問題: 日本の首都は？',
        '正解: 東京',
        '不正解: 大阪',
        '不正解: 京都',
        '不正解: 名古屋',
        '報酬: 80',
      ].join('\n'),
    );
    const bulk = admin('quiz', 'bulk', {
      attachments: {
        file: {
          name: 'quiz.txt',
          url: 'https://cdn.test/quiz.txt',
          size: 200,
          contentType: 'text/plain',
        },
      },
    });
    await handler(bulk.interaction as never);
    expect(embedOf(bulk.out[0]!.options).title).toBe('Import 1 quiz(zes)?');
    await handler(
      button(customIds(bulk.out[0]!.options)[0]!, { guildId: null }).interaction as never,
    );
    expect(
      (s.store.stmt('SELECT COUNT(*) AS n FROM quiz_questions').get() as { n: number }).n,
    ).toBe(2);

    const badFile = admin('quiz', 'bulk', {
      attachments: {
        file: {
          name: 'quiz.png',
          url: 'https://cdn.test/x.png',
          size: 10,
          contentType: 'image/png',
        },
      },
    });
    await handler(badFile.interaction as never);
    expect(embedOf(badFile.out[0]!.options).title).toBe("Can't use that file");

    const list = admin('quiz', 'list');
    await handler(list.interaction as never);
    expect(allText(list.out[0]!.options)).toContain('Largest planet?');
    expect(allText(list.out[0]!.options)).toContain('日本の首都は？');

    const id = (
      s.store.stmt('SELECT id FROM quiz_questions ORDER BY id LIMIT 1').get() as { id: number }
    ).id;
    const del = admin('quiz', 'delete', { integers: { quiz_id: id } });
    await handler(del.interaction as never);
    expect(
      (s.store.stmt('SELECT COUNT(*) AS n FROM quiz_questions').get() as { n: number }).n,
    ).toBe(2);
    await handler(
      button(customIds(del.out[0]!.options)[0]!, { guildId: null }).interaction as never,
    );
    expect(
      (s.store.stmt('SELECT COUNT(*) AS n FROM quiz_questions').get() as { n: number }).n,
    ).toBe(1);
  });
});

describe('admin autocomplete', () => {
  it('suggests servers and members to owners only', async () => {
    const { handler } = setup();
    const guilds = autocomplete('admin', { name: 'guild_id', value: '' }, {}, { guildId: null });
    await handler(guilds.interaction as never);
    expect(JSON.stringify(guilds.responses[0])).toContain(GUILD);
    const users = autocomplete(
      'admin',
      { name: 'user_id', value: '' },
      { guild_id: GUILD },
      { guildId: null },
    );
    await handler(users.interaction as never);
    expect(JSON.stringify(users.responses[0])).toContain(USER);
    const other = autocomplete(
      'admin',
      { name: 'guild_id', value: '' },
      {},
      { guildId: null, user: makeUser(OTHER_USER, 'bob') },
    );
    await handler(other.interaction as never);
    expect(other.responses[0]).toEqual([]);
  });
});
