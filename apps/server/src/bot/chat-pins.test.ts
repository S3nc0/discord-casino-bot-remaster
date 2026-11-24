import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  USER,
  command,
  createTestServer,
  embedOf,
  fakeChannel,
  fakeClient,
  makeHandler,
} from './chat-test-kit.ts';
import type { PostPinPort } from '../notify/post-pins.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup(port: Partial<PostPinPort> = {}) {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  const pin = vi.fn(async () => ({ ok: true }) as const);
  const unpin = vi.fn(async () => ({ ok: true }) as const);
  server.postPins.attach({ pin, unpin, ...port });
  return { s: server, handler: makeHandler(server), pin, unpin };
}

const pinned = (s: TestServer) =>
  s.store.stmt('SELECT kind, ref_id, channel_id, message_id FROM pinned_posts').all();

describe('poll create', () => {
  it('pins the public reply, and unpins it when the poll closes', async () => {
    const { s, handler, pin, unpin } = setup();
    const cmd = command({
      name: 'poll',
      sub: 'create',
      id: 'p1',
      strings: { title: 'Pizza or sushi?', duration: '5m' },
    });
    await handler(cmd.interaction as never);
    expect(embedOf(cmd.out[0]!.options).title).toContain('#');
    expect(pin).toHaveBeenCalledWith('chan-1', 'reply-p1');
    const poll = s.games.poll.list(GUILD)[0]!;
    expect(pinned(s)).toEqual([
      { kind: 'poll', ref_id: poll.id, channel_id: 'chan-1', message_id: 'reply-p1' },
    ]);

    s.clock.advance(6 * 60_000);
    s.games.poll.closeDue(GUILD);
    await s.postPins.sweep();
    expect(unpin).toHaveBeenCalledWith('chan-1', 'reply-p1');
    expect(pinned(s)).toEqual([]);
  });

  it('still creates the poll when the pin is refused', async () => {
    const { s, handler } = setup({
      pin: async () => ({ ok: false, reason: 'missing_permissions' }),
    });
    const cmd = command({ name: 'poll', sub: 'create', strings: { title: 'Tea or coffee?' } });
    await handler(cmd.interaction as never);
    expect(s.games.poll.list(GUILD)).toHaveLength(1);
    expect(cmd.out).toHaveLength(1);
    expect(pinned(s)).toEqual([]);
  });

  it('still creates the poll when the reply cannot be fetched', async () => {
    const { s, handler, pin } = setup();
    const cmd = command({ name: 'poll', sub: 'create', strings: { title: 'Cats or dogs?' } });
    (cmd.interaction as unknown as { fetchReply: unknown }).fetchReply = async () => {
      throw new Error('Unknown Webhook');
    };
    await handler(cmd.interaction as never);
    expect(s.games.poll.list(GUILD)).toHaveLength(1);
    expect(pin).not.toHaveBeenCalled();
  });
});

describe('kyosai propose', () => {
  it('pins the motion post, and unpins it when the motion closes', async () => {
    const { s, handler, pin, unpin } = setup();
    s.finance.kyosai.ensureSupply(GUILD);
    s.store
      .stmt(
        'INSERT INTO kyosai_units (guild_id, holder_key, user_id, is_house, units) VALUES (?, ?, ?, 0, 100)',
      )
      .run(GUILD, USER, USER);
    const cmd = command({ name: 'kyosai', sub: 'propose', id: 'k1', numbers: { premium: 0.2 } });
    await handler(cmd.interaction as never);
    expect(pin).toHaveBeenCalledWith('chan-1', 'reply-k1');
    expect(pinned(s)).toHaveLength(1);

    s.clock.advance(25 * 3_600_000);
    s.finance.kyosai.closeExpiredMotions(GUILD);
    await s.postPins.sweep();
    expect(unpin).toHaveBeenCalledWith('chan-1', 'reply-k1');
    expect(pinned(s)).toEqual([]);
  });
});

describe('admin raffle', () => {
  const admin = (sub: string, spec: Record<string, unknown>) =>
    command({ name: 'admin', group: 'raffle', sub, guildId: null, channelId: null, ...spec });

  it('pins the start post and the repost, and unpins them on cancel', async () => {
    const { s, handler, pin, unpin } = setup();
    const channel = fakeChannel('9004');
    const client = fakeClient([channel]);
    const start = admin('start', {
      strings: { guild_id: GUILD, channel_id: '9004' },
      integers: { fee: 500, minutes: 30 },
      client,
    });
    await handler(start.interaction as never);
    expect(pin).toHaveBeenCalledWith('9004', 'msg-1');

    const repost = admin('repost', { strings: { guild_id: GUILD, channel_id: '9004' }, client });
    await handler(repost.interaction as never);
    expect(unpin).toHaveBeenCalledWith('9004', 'msg-1');
    expect(pin).toHaveBeenLastCalledWith('9004', 'msg-2');
    const raffle = s.games.lottery.current(GUILD)!;
    expect(pinned(s)).toEqual([
      { kind: 'raffle', ref_id: raffle.id, channel_id: '9004', message_id: 'msg-2' },
    ]);

    s.games.lottery.cancel(GUILD);
    await s.postPins.sweep();
    expect(unpin).toHaveBeenLastCalledWith('9004', 'msg-2');
    expect(pinned(s)).toEqual([]);
  });

  it('tells the owner when the pin was refused, and still starts the raffle', async () => {
    const { s, handler } = setup({
      pin: async () => ({ ok: false, reason: 'missing_permissions' }),
    });
    const channel = fakeChannel('9004');
    const start = admin('start', {
      strings: { guild_id: GUILD, channel_id: '9004' },
      integers: { fee: 500, minutes: 30 },
      client: fakeClient([channel]),
    });
    await handler(start.interaction as never);
    expect(s.games.lottery.current(GUILD)).not.toBeNull();
    expect(channel.sent).toHaveLength(1);
    expect(embedOf(start.out[0]!.options).description).toContain('Pin Messages');
  });
});
