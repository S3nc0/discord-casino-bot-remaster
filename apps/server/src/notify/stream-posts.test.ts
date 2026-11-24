import { afterEach, describe, expect, it } from 'vitest';
import { createTestServer, GUILD, OTHER_USER, USER, type TestServer } from '../runtime/test-kit.ts';
import { attachNotify, type NotifyHandle } from './index.ts';
import { createFakeDiscordPort, type FakeDiscordPort } from './ports.ts';

const PANEL = '666666666666666666';
const C = '123456789012345670';
let srv: TestServer;
let notify: NotifyHandle;
let port: FakeDiscordPort;

afterEach(async () => {
  notify.stop();
  await srv.close();
});

function setup(locale = 'en', perMinute?: number) {
  srv = createTestServer();
  port = createFakeDiscordPort({ guildLocales: { [GUILD]: locale } });
  notify = attachNotify({
    bus: srv.bus,
    store: srv.store,
    clock: srv.clock,
    logger: srv.logger,
    defaultAnnounceChannelId: '',
    port,
    batchWindowMs: 0,
    pollIntervalMs: 0,
  });
  if (perMinute !== undefined) notify.config.setAnnounceRateLimit(GUILD, perMinute);
  let n = 0;
  const key = () => `k${++n}`;
  const who = (userId: string) => ({ guildId: GUILD, userId });
  const s = srv.stream.start(who(USER), {
    title: 'Boss',
    channelId: PANEL,
    idempotencyKey: key(),
  }).stream;
  return { key, who, s };
}

const posts = () => port.channelPosts.filter((p) => p.channelId === PANEL);

describe('stream posts', () => {
  it('posts the tip card, the round notices and the result in the panel channel', async () => {
    const { key, who, s } = setup('ja');
    srv.economy.ensureMember(GUILD, OTHER_USER);
    srv.store
      .stmt(`INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, 3)`)
      .run(GUILD, OTHER_USER);
    srv.stream.tip(who(OTHER_USER), {
      streamId: s.id,
      amount: 2000,
      message: '@everyone gl',
      idempotencyKey: key(),
    });
    const roundId = srv.stream.openRound(who(USER), { streamId: s.id, idempotencyKey: key() })
      .stream.round!.id;
    srv.stream.bet(who(OTHER_USER), {
      streamId: s.id,
      roundId,
      side: 'win',
      amount: 500,
      idempotencyKey: key(),
    });
    srv.economy.ensureMember(GUILD, C);
    srv.stream.bet(who(C), {
      streamId: s.id,
      roundId,
      side: 'lose',
      amount: 500,
      idempotencyKey: key(),
    });
    srv.clock.advance(10 * 60_000);
    srv.stream.lockDue(GUILD);
    srv.stream.settle(who(USER), { streamId: s.id, roundId, winner: 'win', idempotencyKey: key() });
    await notify.flush();
    const all = posts();
    expect(all).toHaveLength(4);
    const [tip, opened, locked, result] = all.map((p) => p.message);
    expect(tip?.embeds?.[0]).toMatchObject({
      title: `…${OTHER_USER.slice(-4)}　💸 2,000ペリカ`,
      description: '@everyone gl',
      color: 0xffca28,
    });
    expect(opened?.embeds?.[0]?.title).toBe('🎲 勝負「次の勝負」の賭けを受け付けます');
    expect(locked?.content).toContain('次の勝負');
    expect(result?.embeds?.[0]?.title).toBe('🏁 Boss の勝負の結果');
    const body = result?.embeds?.[0]?.description ?? '';
    expect(body).toContain(`<@${OTHER_USER}> **975ペリカ**`);
    expect(body).toContain('帝愛の控除: 25ペリカ');
  });

  it("adds the owner's reason to a voided round", async () => {
    const { key, who, s } = setup('en');
    const roundId = srv.stream.openRound(who(USER), { streamId: s.id, idempotencyKey: key() })
      .stream.round!.id;
    srv.stream.ownerVoid({
      guildId: GUILD,
      ownerId: USER,
      target: String(roundId),
      reason: 'rigged',
    });
    await notify.flush();
    const result = posts().at(-1)?.message.embeds?.[0]?.description ?? '';
    expect(result).toContain('Voided by the server owner. Reason: rigged');
  });

  it('waits for the guild budget instead of dropping posts', async () => {
    const { key, who, s } = setup('en', 1);
    srv.stream.openRound(who(USER), { streamId: s.id, label: 'A', idempotencyKey: key() });
    const r = srv.stream.view(who(USER), s.id).round!.id;
    srv.stream.voidRound(who(USER), { streamId: s.id, roundId: r, idempotencyKey: key() });
    await notify.flush();
    expect(posts()).toHaveLength(1);
    expect(notify.streamPosts.pending(GUILD)).toBe(1);
    srv.clock.advance(60_001);
    await notify.flush();
    expect(posts()).toHaveLength(2);
  });

  it('posts nothing for a stream without a chat channel', async () => {
    const { key, who } = setup('en');
    const s2 = srv.stream.start(who(OTHER_USER), {
      title: 'Activity only',
      idempotencyKey: key(),
    }).stream;
    srv.stream.openRound(who(OTHER_USER), { streamId: s2.id, idempotencyKey: key() });
    await notify.flush();
    expect(port.channelPosts).toHaveLength(0);
  });
});
