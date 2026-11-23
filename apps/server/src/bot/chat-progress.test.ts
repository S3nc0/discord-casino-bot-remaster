import { afterEach, describe, expect, it } from 'vitest';
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
  fakeChannel,
  fakeClient,
  ledgerReasons,
  makeHandler,
  makeUser,
  modalSubmit,
  select,
} from './chat-test-kit.ts';
import { parseDurationMinutes } from './progress-chat.ts';
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

describe('/labor ranking', () => {
  it('ranks by earnings, in both periods and both languages', async () => {
    const { s, handler } = setup();
    for (let i = 0; i < 3; i++) {
      s.clock.advance(1500);
      s.games.work.click(GUILD, USER);
    }
    const total = command({ name: 'labor', sub: 'ranking' });
    await handler(total.interaction as never);
    expect(embedOf(total.out[0]!.options).title).toBe('⛏ Mining ranking (all time)');
    expect(allText(total.out[0]!.options)).toContain(`<@${USER}>`);

    const today = command({
      name: 'labor',
      sub: 'ranking',
      strings: { period: 'today' },
      locale: 'ja',
    });
    await handler(today.interaction as never);
    expect(embedOf(today.out[0]!.options).title).toBe('⛏ 採掘ランキング（今日）');
    expect(allText(today.out[0]!.options)).toContain(`<@${USER}>`);

    // Tomorrow nobody has earned anything "today".
    s.clock.advance(2 * 86_400_000);
    const later = command({ name: 'labor', sub: 'ranking', strings: { period: 'today' } });
    await handler(later.interaction as never);
    expect(allText(later.out[0]!.options)).toContain('Nobody has earned');
  });
});

describe('/pelica leaderboard', () => {
  it('posts the live ranking, stores it, and stops it again', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('chan-9');
    const client = fakeClient([channel]);
    const post = command({
      name: 'pelica',
      sub: 'leaderboard',
      channels: { channel: { id: 'chan-9' } },
      client,
    });
    await handler(post.interaction as never);
    expect(channel.sent).toHaveLength(1);
    expect(allText(channel.sent[0] as never)).toContain(`<@${USER}>`);
    expect(
      s.store.stmt('SELECT channel_id FROM leaderboards WHERE guild_id = ?').get(GUILD),
    ).toEqual({ channel_id: 'chan-9' });
    expect(embedOf(post.out[0]!.options).title).toBe('Leaderboard posted');

    const stop = command({ name: 'pelica', sub: 'leaderboard', booleans: { stop: true }, client });
    await handler(stop.interaction as never);
    expect(
      s.store.stmt('SELECT 1 FROM leaderboards WHERE guild_id = ?').get(GUILD),
    ).toBeUndefined();
    const again = command({
      name: 'pelica',
      sub: 'leaderboard',
      booleans: { stop: true },
      client,
      locale: 'ja',
    });
    await handler(again.interaction as never);
    expect(embedOf(again.out[0]!.options).title).toBe('掲示していません');
  });

  it('is limited to Manage Server members and owners', async () => {
    const { handler } = setup();
    const denied = command({
      name: 'pelica',
      sub: 'leaderboard',
      user: makeUser(OTHER_USER, 'bob'),
      manageGuild: false,
    });
    await handler(denied.interaction as never);
    expect(allText(denied.out[0]!.options)).toBeTruthy();
    expect(denied.out[0]!.options.flags).toBeDefined();
    expect(denied.out[0]!.options.embeds).toHaveLength(1);
  });

  it('R-5: an ordinary member can neither post nor stop the board', async () => {
    const { s, handler } = setup();
    const channel = fakeChannel('chan-9');
    const client = fakeClient([channel]);
    const member = makeUser(OTHER_USER, 'bob');
    const post = command({
      name: 'pelica',
      sub: 'leaderboard',
      user: member,
      manageGuild: false,
      channels: { channel: { id: 'chan-9' } },
      client,
    });
    await handler(post.interaction as never);
    expect(channel.sent).toHaveLength(0);
    expect(
      s.store.stmt('SELECT 1 FROM leaderboards WHERE guild_id = ?').get(GUILD),
    ).toBeUndefined();

    const owner = command({
      name: 'pelica',
      sub: 'leaderboard',
      channels: { channel: { id: 'chan-9' } },
      client,
    });
    await handler(owner.interaction as never);
    const stop = command({
      name: 'pelica',
      sub: 'leaderboard',
      user: member,
      manageGuild: false,
      booleans: { stop: true },
      client,
    });
    await handler(stop.interaction as never);
    expect(s.store.stmt('SELECT 1 FROM leaderboards WHERE guild_id = ?').get(GUILD)).toBeDefined();

    const manager = command({
      name: 'pelica',
      sub: 'leaderboard',
      user: member,
      manageGuild: true,
      booleans: { stop: true },
      client,
    });
    await handler(manager.interaction as never);
    expect(
      s.store.stmt('SELECT 1 FROM leaderboards WHERE guild_id = ?').get(GUILD),
    ).toBeUndefined();
  });

  it('R-5: refuses a channel of another guild and never allows mentions', async () => {
    const { s, handler } = setup();
    const foreign = fakeChannel('chan-foreign', [], 'other-guild');
    const own = fakeChannel('chan-own');
    const client = fakeClient([foreign, own]);
    const bad = command({
      name: 'pelica',
      sub: 'leaderboard',
      channels: { channel: { id: 'chan-foreign' } },
      client,
    });
    await handler(bad.interaction as never);
    expect(foreign.sent).toHaveLength(0);
    expect(
      s.store.stmt('SELECT 1 FROM leaderboards WHERE guild_id = ?').get(GUILD),
    ).toBeUndefined();

    const good = command({
      name: 'pelica',
      sub: 'leaderboard',
      channels: { channel: { id: 'chan-own' } },
      client,
    });
    await handler(good.interaction as never);
    expect(own.sent).toHaveLength(1);
    expect(own.sent[0]).toMatchObject({ allowedMentions: { parse: [] } });
  });
});

describe('quiz', () => {
  it('plays an official quiz: the right button pays the reward through the ledger', async () => {
    const { s, handler } = setup();
    const quiz = s.games.quiz.addOfficial({
      question: 'Capital of Japan?',
      choices: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'],
      explanation: 'It is Tokyo.',
      reward: 150,
    });
    const right = (
      s.store.stmt('SELECT answer FROM quiz_questions WHERE id = ?').get(quiz.id) as {
        answer: number;
      }
    ).answer;

    const play = command({ name: 'quiz', sub: 'play' });
    await handler(play.interaction as never);
    expect(play.out[0]!.options.flags).toBeDefined();
    const ids = customIds(play.out[0]!.options);
    expect(ids).toHaveLength(4);

    const wrongIdx = (right + 1) % 4;
    const press = button(`b:qz:ans:${quiz.id}:${right}`);
    await handler(press.interaction as never);
    expect(allText(press.out[0]!.options)).toContain('Correct!');
    expect(allText(press.out[0]!.options)).toContain('It is Tokyo.');
    expect(ledgerReasons(s)).toContain('quiz_reward');

    // One try per quiz, and nothing left to play.
    const second = button(`b:qz:ans:${quiz.id}:${wrongIdx}`);
    await handler(second.interaction as never);
    expect(allText(second.out[0]!.options)).toContain('already answered');
    const none = command({ name: 'quiz', sub: 'play', locale: 'ja' });
    await handler(none.interaction as never);
    expect(allText(none.out[0]!.options)).toContain('挑戦できる問題はありません');
  });

  it('opens a modal for /quiz post and posts the quiz publicly on submit', async () => {
    const { s, handler } = setup();
    const open = command({ name: 'quiz', sub: 'post' });
    await handler(open.interaction as never);
    expect(open.out[0]!.kind).toBe('modal');

    const submit = modalSubmit('b:qzp:submit', {
      question: 'Which is a fruit?',
      choices: 'Apple\nCarrot\nOnion\nLeek',
      explanation: '',
      reward: '200',
      duration: '2h',
    });
    await handler(submit.interaction as never);
    const posted = submit.out[0]!;
    expect(posted.options.flags).toBeUndefined();
    expect(customIds(posted.options)).toHaveLength(4);
    expect(allText(posted.options)).toContain('Which is a fruit?');
    const row = s.store.stmt('SELECT author_id, reward FROM quiz_questions').get() as {
      author_id: string;
      reward: number;
    };
    expect(row).toEqual({ author_id: USER, reward: 200 });

    // The author cannot answer their own quiz; a newcomer answers without a reward.
    const [, , , quizId] = customIds(posted.options)[0]!.split(':');
    const own = button(`b:qz:pub:${quizId}:0`);
    await handler(own.interaction as never);
    expect(allText(own.out[0]!.options)).toContain('cannot answer your own');
    const guest = button(`b:qz:pub:${quizId}:0`, { user: makeUser(OTHER_USER, 'bob') });
    await handler(guest.interaction as never);
    expect(guest.out[0]!.kind).toBe('reply');
    expect(guest.out[0]!.options.flags).toBeDefined();
  });

  it('parses Japanese and English durations', () => {
    expect(parseDurationMinutes('3d')).toBe(4320);
    expect(parseDurationMinutes('2時間')).toBe(120);
    expect(parseDurationMinutes('1日12時間')).toBe(2160);
    expect(parseDurationMinutes('90m')).toBe(90);
    expect(parseDurationMinutes('5')).toBe(300);
    expect(parseDurationMinutes('2h2h')).toBeNull();
    expect(parseDurationMinutes('abc')).toBeNull();
  });
});

describe('/shop', () => {
  it('browses a category and buys a cheap item straight away', async () => {
    const { s, handler } = setup();
    const open = command({ name: 'shop' });
    await handler(open.interaction as never);
    expect(open.out[0]!.options.flags).toBeDefined();
    const ids = customIds(open.out[0]!.options);
    expect(ids).toContain('b:shop:cat:title');
    expect(ids).toContain('b:shop:mkt');

    const cat = button('b:shop:cat:title');
    await handler(cat.interaction as never);
    expect(allText(cat.out[0]!.options)).toContain('Rookie Gambler');
    expect(customIds(cat.out[0]!.options)).toContain('b:shop:pick');

    const before = s.economy.getBalance(GUILD, USER);
    const pick = select('b:shop:pick', ['title_rookie']);
    await handler(pick.interaction as never);
    expect(embedOf(pick.out[0]!.options).title).toBe('Purchased');
    expect(s.economy.getBalance(GUILD, USER)).toBe(before - 2000);
    expect(ledgerReasons(s)).toContain('shop_buy');
    expect(s.games.shop.inventory.qty(GUILD, USER, 'title_rookie')).toBe(1);

    // Owning a unique item blocks a second purchase with its own message.
    const again = select('b:shop:pick', ['title_rookie']);
    await handler(again.interaction as never);
    expect(allText(again.out[0]!.options)).toContain('already own');
  });

  it('asks to confirm expensive items and refuses when the money is short (JA)', async () => {
    const { s, handler } = setup();
    const pick = select('b:shop:pick', ['title_emperor'], { locale: 'ja' });
    await handler(pick.interaction as never);
    expect(embedOf(pick.out[0]!.options).title).toBe('購入しますか？');
    const ok = customIds(pick.out[0]!.options)[0]!;
    expect(ok).toBe('b:shop:ok:title_emperor');
    const confirm = button(ok, { locale: 'ja' });
    await handler(confirm.interaction as never);
    expect(s.games.shop.inventory.qty(GUILD, USER, 'title_emperor')).toBe(0);
    expect(confirm.out[0]!.options.flags).toBeDefined();
  });

  it('shows the Teiai market and reveals a black-market lot only after the confirmed purchase', async () => {
    const { s, handler } = setup();
    const now = s.clock.now();
    const day = Math.floor(now / 86_400_000);
    s.store.stmt('INSERT INTO teiai_market_days (guild_id, day) VALUES (?, ?)').run(GUILD, day);
    s.store
      .stmt(
        'INSERT INTO teiai_market (guild_id, item_id, mode, black, qty, start_price, end_price, listed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(GUILD, 'cardcolor_red', 'fixed', 1, 1, 2000, 2000, now - 1000, now + 3_600_000);

    const view = button('b:shop:mkt');
    await handler(view.interaction as never);
    const text = allText(view.out[0]!.options);
    expect(text).toContain('Black-market item');
    expect(text).not.toContain('Red');

    const lotId = (s.store.stmt('SELECT id FROM teiai_market').get() as { id: number }).id;
    const pick = select('b:shop:mpick', [String(lotId)]);
    await handler(pick.interaction as never);
    expect(allText(pick.out[0]!.options)).toContain('black-market item');
    const before = s.economy.getBalance(GUILD, USER);
    const ok = button(customIds(pick.out[0]!.options)[0]!);
    await handler(ok.interaction as never);
    expect(embedOf(ok.out[0]!.options).title).toBe('Purchased');
    expect(allText(ok.out[0]!.options)).toMatch(/Appraisal/);
    expect(s.economy.getBalance(GUILD, USER)).toBe(before - 2000);
    expect(ledgerReasons(s)).toContain('teiai_market_buy');
  });
});
